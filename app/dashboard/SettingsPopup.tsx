"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { X, Settings, Play, Palette, Shield, HelpCircle, Loader2, FlaskConical, Volume2, Zap, GitBranch, Clock } from "lucide-react";
import { playSound, setVolume } from "@/lib/sounds";
import { useTheme } from "@/components/ThemeProvider";
import { useTradeStore } from "../store/TradeStore";

function ClampedNumericField({ value, onChange, min, max, ...props }: any) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={local}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/\D/g, "");
        setLocal(cleaned);
        if (cleaned !== "") {
          const val = parseInt(cleaned, 10);
          if (!isNaN(val) && val >= min && val <= max) onChange(val);
        }
      }}
      onBlur={(e: any) => {
        if (!e.target.value) { setLocal(String(min)); onChange(min); }
        else {
          const val = parseInt(e.target.value, 10);
          const clamped = Math.min(max, Math.max(min, val));
          setLocal(String(clamped));
          onChange(clamped);
        }
      }}
    />
  );
}

const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL || "http://localhost:4000";

// Friendly display names for strategy script names — edit these as needed
const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  evaluateEMACross: "EMA Crossover",
  surStrategy: "Suresh Strategy",
  chatGptStrategy: "ChatGPT Strategy",
  claudSurStrategy: "Claude Sur Strategy",
  utGptStrategy: "UT GPT",
  utGptStrategy1: "UT GPT v1",
  utGptStrategy2: "UT GPT v2",
  utGptStrategy3: "UT GPT v3",
  superDoubleUT: "Super Double UT",
  superUTBotStrategy: "Super UT Bot",
  VWAPUTBotStrategy: "VWAP Double UT Bot",
  sumeshStrategy: "Sumesh Strategy",
  utGptStrategy4: "UT GPT v4",
  utGptStrategy4X: "UT GPT v4X",
};

function getDisplayName(key: string) {
  return STRATEGY_DISPLAY_NAMES[key] || key;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function SettingsPopup({ open, onClose }: Props) {
  const [activeStrategy, setActiveStrategy] = useState<string>("");
  const [availableStrategies, setAvailableStrategies] = useState<string[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [volume, setVolumeState] = useState(0.5);
  const { theme, setTheme } = useTheme();
  const { forceBuyEnabled, setForceBuyEnabled } = useTradeStore();

  // Auto Cutoff settings
  const [autoCutoffEnabled, setAutoCutoffEnabled] = useState(false);
  const [autoCutoffHours, setAutoCutoffHours] = useState("03");
  const [autoCutoffMinutes, setAutoCutoffMinutes] = useState("05");
  const [autoCutoffAmpm, setAutoCutoffAmpm] = useState("pm");
  const autoCutoffLoadedRef = useRef(false);
  const autoCutoffDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI Guard settings
  const [aiGuardEnabled, setAiGuardEnabled] = useState(false);
  const [aiEntryGuardEnabled, setAiEntryGuardEnabled] = useState(false);
  const [aiAutoExitEnabled, setAiAutoExitEnabled] = useState(false);
  const [aiCandlesCount, setAiCandlesCount] = useState(120);
  const [aiRecentCandlesCount, setAiRecentCandlesCount] = useState(30);
  const [aiConsiderVolume, setAiConsiderVolume] = useState(false);
  const [aiUseHeikinAshi, setAiUseHeikinAshi] = useState(true);
  const [aiProvider, setAiProvider] = useState("groq");
  const [aiModel, setAiModel] = useState("openai/gpt-oss-120b");
  const [aiApiKey, setAiApiKey] = useState("");

  // AI Guard info tooltips
  const [isEntryGuardInfoOpen, setIsEntryGuardInfoOpen] = useState(false);
  const [isAutoExitInfoOpen, setIsAutoExitInfoOpen] = useState(false);
  const [isCandlesInfoOpen, setIsCandlesInfoOpen] = useState(false);
  const [isProviderInfoOpen, setIsProviderInfoOpen] = useState(false);
  const [isApiKeyInfoOpen, setIsApiKeyInfoOpen] = useState(false);

  // Close tooltips when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button[aria-label*="info"]') || target.closest('[data-tooltip]')) return;
      setIsEntryGuardInfoOpen(false);
      setIsAutoExitInfoOpen(false);
      setIsCandlesInfoOpen(false);
      setIsProviderInfoOpen(false);
      setIsApiKeyInfoOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // AI Guard test connection
  const [aiTestStatus, setAiTestStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [aiTestError, setAiTestError] = useState("");
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPrevKeyRef = useRef<string>("");
  const aiPrevProviderRef = useRef<string>("groq");
  const aiPrevModelRef = useRef<string>("openai/gpt-oss-120b");

  // TEMP AI Testing
  const [tempCandleText, setTempCandleText] = useState("");
  const [tempStatus, setTempStatus] = useState<"idle" | "testing" | "done" | "error">("idle");
  const [tempTestingEnabled, setTempTestingEnabled] = useState(false);
  const [tempResult, setTempResult] = useState<null | { parsed: { marketRegime?: string; blockEntry?: boolean; suggestExit?: boolean; confidence?: number; reason?: string; rangeHigh?: number; rangeLow?: number } | null; rawResponse: string; candleCount: number; usedCount: number; model?: string; promptSent?: string; error?: string }>(null);

  // Load AI Guard settings from server on mount (cross-device), fall back to localStorage
  const aiSettingsLoadedRef = useRef(false);
  useEffect(() => {
    const stored = localStorage.getItem("soundVolume");
    if (stored) setVolumeState(parseFloat(stored));

    // Fetch Auto Cutoff settings from server
    fetch("/next-api/settings/auto-cutoff")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          setAutoCutoffEnabled(Boolean(data.autoCutoffEnabled));
          if (typeof data.autoCutoffHours === "string") setAutoCutoffHours(data.autoCutoffHours);
          if (typeof data.autoCutoffMinutes === "string") setAutoCutoffMinutes(data.autoCutoffMinutes);
          if (typeof data.autoCutoffAmpm === "string") setAutoCutoffAmpm(data.autoCutoffAmpm);
          autoCutoffLoadedRef.current = true;
        }
      })
      .catch(() => {
        autoCutoffLoadedRef.current = true;
      });

    // Fetch AI Guard settings from server first (source of truth for cross-device)
    fetch("/next-api/ai/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          setAiGuardEnabled(Boolean(data.enabled));
          setAiEntryGuardEnabled(Boolean(data.entryGuardEnabled));
          setAiAutoExitEnabled(Boolean(data.autoExitEnabled));
          if (typeof data.candlesCount === "number") setAiCandlesCount(data.candlesCount);
          if (typeof data.recentCandlesCount === "number") setAiRecentCandlesCount(data.recentCandlesCount);
          if (typeof data.considerVolume === "boolean") setAiConsiderVolume(data.considerVolume);
          if (typeof data.useHeikinAshi === "boolean") setAiUseHeikinAshi(data.useHeikinAshi);
          if (typeof data.provider === "string") setAiProvider(data.provider);
          if (typeof data.model === "string") setAiModel(data.model);
          if (Array.isArray(data.apiKeys)) setAiApiKey(data.apiKeys.join("\n"));
          else if (typeof data.apiKey === "string") setAiApiKey(data.apiKey);
          // Sync to localStorage as cache
          localStorage.setItem("aiGuardEnabled", String(data.enabled));
          localStorage.setItem("aiEntryGuardEnabled", String(data.entryGuardEnabled));
          localStorage.setItem("aiAutoExitEnabled", String(data.autoExitEnabled));
          localStorage.setItem("aiCandlesCount", String(data.candlesCount));
          localStorage.setItem("aiRecentCandlesCount", String(data.recentCandlesCount));
          localStorage.setItem("aiConsiderVolume", String(data.considerVolume || false));
          localStorage.setItem("aiUseHeikinAshi", String(data.useHeikinAshi !== false));
          localStorage.setItem("aiProvider", data.provider);
          localStorage.setItem("aiModel", data.model || "openai/gpt-oss-120b");
          localStorage.setItem("aiApiKey", Array.isArray(data.apiKeys) ? data.apiKeys.join("\n") : (data.apiKey || ""));
        }
      })
      .catch(() => {
        // Server unreachable — fall back to localStorage
        const aiGuard = localStorage.getItem("aiGuardEnabled");
        if (aiGuard) setAiGuardEnabled(aiGuard === "true");
        const aiEntry = localStorage.getItem("aiEntryGuardEnabled");
        if (aiEntry) setAiEntryGuardEnabled(aiEntry === "true");
        const aiAutoExit = localStorage.getItem("aiAutoExitEnabled");
        if (aiAutoExit) setAiAutoExitEnabled(aiAutoExit === "true");
        const aiCandles = localStorage.getItem("aiCandlesCount");
        if (aiCandles) setAiCandlesCount(parseInt(aiCandles, 10));
        const aiRecentCandles = localStorage.getItem("aiRecentCandlesCount");
        if (aiRecentCandles) setAiRecentCandlesCount(parseInt(aiRecentCandles, 10));
        const aiVol = localStorage.getItem("aiConsiderVolume");
        if (aiVol) setAiConsiderVolume(aiVol === "true");
        const aiHA = localStorage.getItem("aiUseHeikinAshi");
        if (aiHA) setAiUseHeikinAshi(aiHA === "true");
        const aiProv = localStorage.getItem("aiProvider");
        if (aiProv) setAiProvider(aiProv);
        const aiMdl = localStorage.getItem("aiModel");
        if (aiMdl) setAiModel(aiMdl);
        const aiKey = localStorage.getItem("aiApiKey");
        if (aiKey) setAiApiKey(aiKey);
      })
      .finally(() => {
        aiSettingsLoadedRef.current = true;
      });
  }, []);

  // Persist AI Guard settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem("aiGuardEnabled", String(aiGuardEnabled));
    localStorage.setItem("aiEntryGuardEnabled", String(aiEntryGuardEnabled));
    localStorage.setItem("aiAutoExitEnabled", String(aiAutoExitEnabled));
    localStorage.setItem("aiCandlesCount", String(aiCandlesCount));
    localStorage.setItem("aiRecentCandlesCount", String(aiRecentCandlesCount));
    localStorage.setItem("aiConsiderVolume", String(aiConsiderVolume));
    localStorage.setItem("aiUseHeikinAshi", String(aiUseHeikinAshi));
    localStorage.setItem("aiProvider", aiProvider);
    localStorage.setItem("aiModel", aiModel);
    localStorage.setItem("aiApiKey", aiApiKey);
  }, [aiGuardEnabled, aiEntryGuardEnabled, aiAutoExitEnabled, aiCandlesCount, aiRecentCandlesCount, aiConsiderVolume, aiUseHeikinAshi, aiProvider, aiModel, aiApiKey]);

  // POST AI Guard settings to backend (debounced, only after initial server load)
  const postAiSettings = useCallback(() => {
    if (!aiSettingsLoadedRef.current) return;
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    aiDebounceRef.current = setTimeout(() => {
      fetch("/next-api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: aiGuardEnabled,
          entryGuardEnabled: aiEntryGuardEnabled,
          autoExitEnabled: aiAutoExitEnabled,
          candlesCount: aiCandlesCount,
          recentCandlesCount: aiRecentCandlesCount,
          considerVolume: aiConsiderVolume,
          useHeikinAshi: aiUseHeikinAshi,
          provider: aiProvider,
          model: aiModel,
          apiKeys: aiApiKey,
        }),
      }).catch(() => {});
    }, 500);
  }, [aiGuardEnabled, aiEntryGuardEnabled, aiAutoExitEnabled, aiCandlesCount, aiRecentCandlesCount, aiConsiderVolume, aiUseHeikinAshi, aiProvider, aiModel, aiApiKey]);

  useEffect(() => { postAiSettings(); }, [postAiSettings]);

  // Auto-save Auto Cutoff settings to server when changed
  useEffect(() => {
    if (!autoCutoffLoadedRef.current) return;
    if (autoCutoffDebounceRef.current) clearTimeout(autoCutoffDebounceRef.current);
    autoCutoffDebounceRef.current = setTimeout(() => {
      fetch("/next-api/settings/auto-cutoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoCutoffEnabled,
          autoCutoffHours,
          autoCutoffMinutes,
          autoCutoffAmpm,
        }),
      }).catch((err) => console.error("Failed to save auto cutoff settings:", err));
    }, 300);
    return () => {
      if (autoCutoffDebounceRef.current) clearTimeout(autoCutoffDebounceRef.current);
    };
  }, [autoCutoffEnabled, autoCutoffHours, autoCutoffMinutes, autoCutoffAmpm]);

  // Test API key when it changes (or provider changes)
  const testAiConnection = useCallback(async () => {
    if (!aiApiKey) {
      setAiTestStatus("idle");
      return;
    }
    setAiTestStatus("testing");
    setAiTestError("");
    try {
      const res = await fetch("/next-api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider, apiKeys: aiApiKey, model: aiModel }),
      });
      const data = await res.json();
      if (data.connected) {
        setAiTestStatus("connected");
      } else {
        setAiTestStatus("failed");
        setAiTestError(data.error || "Unknown error");
      }
    } catch {
      setAiTestStatus("failed");
      setAiTestError("Cannot reach server");
    }
  }, [aiApiKey, aiProvider, aiModel]);

  useEffect(() => {
    if (aiApiKey && (aiApiKey !== aiPrevKeyRef.current || aiProvider !== aiPrevProviderRef.current || aiModel !== aiPrevModelRef.current)) {
      aiPrevKeyRef.current = aiApiKey;
      aiPrevProviderRef.current = aiProvider;
      aiPrevModelRef.current = aiModel;
      const timer = setTimeout(() => { testAiConnection(); }, 800);
      return () => clearTimeout(timer);
    }
  }, [aiApiKey, aiProvider, aiModel, testAiConnection]);

  // Fetch current strategy info when popup opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMessage(null);
    fetch(`${STRATEGY_URL}/strategy`)
      .then((r) => r.json())
      .then((data) => {
        setActiveStrategy(data.activeStrategy || "");
        setSelectedStrategy(data.activeStrategy || "");
        setAvailableStrategies(data.availableStrategies || []);
      })
      .catch(() => {
        setMessage({ text: "Failed to fetch strategy info", type: "error" });
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleSave = async () => {
    if (!selectedStrategy || selectedStrategy === activeStrategy) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${STRATEGY_URL}/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy: selectedStrategy }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveStrategy(data.activeStrategy);
        setMessage({ text: `Switched to ${getDisplayName(data.activeStrategy)}`, type: "success" });
      } else {
        setMessage({ text: data.message || "Failed to switch", type: "error" });
      }
    } catch {
      setMessage({ text: "Failed to connect to strategy server", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--theme-popup-backdrop)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[380px] rounded-2xl flex flex-col overflow-hidden"
        style={{
          maxHeight: "90vh",
          maxWidth: "90%",
          background: "var(--theme-popup-bg)",
          color: "var(--theme-popup-text)",
          border: "3px solid var(--theme-popup-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - fixed */}
        <div className="flex items-center justify-between p-6 pb-5">
          <div className="flex items-center gap-2">
            <Settings size={20} style={{ color: "var(--theme-popup-border)" }} />
            <h2 className="text-lg font-bold" style={{ color: "var(--theme-popup-text)" }}>Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full transition"
            style={{ background: "var(--theme-popup-border)", color: "#fff" }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "thin" }}>
          {loading ? (
          <div className="text-sm py-4 text-center" style={{ color: "var(--theme-popup-label)" }}>Loading...</div>
        ) : (
          <>
            {/* Current strategy */}
            <div className="mb-5">
              <div className="text-xs font-medium mb-1" style={{ color: "var(--theme-popup-label)" }}>Current Running Strategy</div>
              <span
                className="text-xs px-2 py-0.5 rounded font-bold inline-block"
                style={{
                  background: "var(--theme-active-badge-bg, var(--theme-bg))",
                  color: "var(--theme-active-badge-text, #fff)",
                  fontSize: "10px",
                  letterSpacing: "0.5px",
                }}
              >
                {getDisplayName(activeStrategy)}
              </span>
            </div>

            {/* Strategy selector */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <GitBranch size={18} style={{ color: "var(--theme-popup-border)" }} />
                <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>Switch Strategy</h3>
              </div>
              <select
                value={selectedStrategy}
                onChange={(e) => {
                  setSelectedStrategy(e.target.value);
                  setMessage(null);
                }}
                className="w-full h-10 px-4 rounded-lg text-sm"
                style={{
                  background: "var(--theme-popup-field-bg)",
                  color: "var(--theme-popup-text)",
                  border: "1px solid var(--theme-popup-field-border)",
                  outline: "none",
                }}
              >
                {availableStrategies.map((s) => (
                  <option key={s} value={s} style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>
                    {getDisplayName(s)}
                  </option>
                ))}
              </select>
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || selectedStrategy === activeStrategy}
              className="w-full h-10 rounded-lg text-sm font-semibold transition"
              style={{
                background: selectedStrategy === activeStrategy
                  ? "var(--theme-popup-field-bg)"
                  : "var(--theme-popup-border)",
                color: selectedStrategy === activeStrategy
                  ? "var(--theme-popup-label)"
                  : "#fff",
                cursor: selectedStrategy === activeStrategy ? "not-allowed" : "pointer",
                border: selectedStrategy === activeStrategy
                  ? "1px solid var(--theme-popup-field-border)"
                  : "none",
              }}
            >
              {saving ? "Saving..." : selectedStrategy === activeStrategy ? "No Change" : "Save"}
            </button>

            {/* Status message */}
            {message && (
              <div
                className="mt-3 text-xs px-3 py-2 rounded-lg text-center font-medium"
                style={{
                  background: message.type === "success" ? "rgba(10,155,63,0.1)" : "rgba(209,43,43,0.1)",
                  color: message.type === "success" ? "var(--theme-status-success)" : "var(--theme-status-loss)",
                }}
              >
                {message.text}
              </div>
            )}

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* Theme selector */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <Palette size={18} style={{ color: "var(--theme-popup-border)" }} />
                <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>Color Theme</h3>
              </div>
              <div className="flex items-center gap-5" style={{ marginTop: 14 }}>
                {[
                  { value: "default" as const, label: "Default", color: "#323335" },
                  { value: "blue" as const, label: "Blue", color: "#164c8e" },
                  { value: "brown" as const, label: "Brown", color: "#570101" },
                  { value: "purple" as const, label: "Deep Purple", color: "#7c3aed" },
                ].map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTheme(t.value)}
                    title={t.label}
                    aria-label={`Select ${t.label} theme`}
                    className="cursor-pointer transition-transform hover:scale-110 active:scale-95 flex items-center justify-center p-0.5 rounded-full"
                    style={{
                      border: theme === t.value ? "2.5px solid var(--theme-popup-border)" : "2.5px solid transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: t.color,
                        border: "1.5px solid rgba(255, 255, 255, 0.25)",
                        boxShadow: theme === t.value ? "0 0 0 2px var(--theme-popup-bg), 0 0 8px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.2)",
                        display: "block",
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* Volume control */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Volume2 size={18} style={{ color: "var(--theme-popup-border)" }} />
                  <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>Sound Volume</h3>
                </div>
                <span className="text-xs font-bold" style={{ color: "var(--theme-accent-gold, var(--theme-popup-border))" }}>{Math.round(volume * 100)}%</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => {
                    const newVolume = parseFloat(e.target.value);
                    setVolumeState(newVolume);
                    setVolume(newVolume);
                  }}
                  className="flex-1 h-2 rounded-lg cursor-pointer appearance-auto"
                  style={{
                    accentColor: "var(--theme-accent-gold, var(--theme-popup-border))",
                  }}
                />
                <button
                  onClick={() => playSound("enter")}
                  className="p-2 rounded-lg transition hover:scale-105"
                  style={{ background: "var(--theme-popup-field-bg)", color: "var(--theme-accent-gold, var(--theme-popup-border))", border: "1px solid var(--theme-popup-field-border)" }}
                  aria-label="Test sound"
                >
                  <Play size={16} />
                </button>
              </div>
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* Auto Cutoff Time setting */}
            <div className="mb-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={18} style={{ color: "var(--theme-popup-border)" }} />
                  <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>Auto Cutoff Time</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoCutoffEnabled(!autoCutoffEnabled)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: autoCutoffEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                    boxShadow: autoCutoffEnabled ? "0 0 10px rgba(251, 191, 36, 0.45)" : "none",
                    position: "relative",
                    transition: "background 0.2s, box-shadow 0.2s",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: autoCutoffEnabled ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                    }}
                  />
                </button>
              </div>
              <div className="text-xs mt-1 font-medium" style={{ color: autoCutoffEnabled ? "var(--theme-status-success)" : "var(--theme-status-loss)" }}>
                {autoCutoffEnabled ? `Auto-sell active positions at ${autoCutoffHours}:${autoCutoffMinutes} ${autoCutoffAmpm.toUpperCase()}` : "Disabled"}
              </div>

              {/* Time inputs */}
              <div
                className={`mt-3 flex items-center gap-2 transition-opacity duration-200 ${
                  autoCutoffEnabled ? "opacity-100" : "opacity-35 pointer-events-none"
                }`}
              >
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={autoCutoffHours}
                    disabled={!autoCutoffEnabled}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                      setAutoCutoffHours(val);
                    }}
                    onBlur={() => {
                      let h = parseInt(autoCutoffHours, 10);
                      if (isNaN(h) || h < 1) h = 3;
                      if (h > 12) h = 12;
                      setAutoCutoffHours(String(h).padStart(2, "0"));
                    }}
                    className="w-12 h-8 px-1 border rounded text-center text-sm font-semibold focus:outline-none"
                    style={{
                      background: "var(--theme-popup-field-bg)",
                      color: "var(--theme-popup-text)",
                      borderColor: "var(--theme-popup-field-border)",
                    }}
                    placeholder="03"
                  />
                  <span className="font-bold text-sm" style={{ color: "var(--theme-popup-text)" }}>:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={autoCutoffMinutes}
                    disabled={!autoCutoffEnabled}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                      setAutoCutoffMinutes(val);
                    }}
                    onBlur={() => {
                      let m = parseInt(autoCutoffMinutes, 10);
                      if (isNaN(m) || m < 0) m = 5;
                      if (m > 59) m = 59;
                      setAutoCutoffMinutes(String(m).padStart(2, "0"));
                    }}
                    className="w-12 h-8 px-1 border rounded text-center text-sm font-semibold focus:outline-none"
                    style={{
                      background: "var(--theme-popup-field-bg)",
                      color: "var(--theme-popup-text)",
                      borderColor: "var(--theme-popup-field-border)",
                    }}
                    placeholder="05"
                  />
                </div>
                <select
                  value={autoCutoffAmpm}
                  disabled={!autoCutoffEnabled}
                  onChange={(e) => setAutoCutoffAmpm(e.target.value.toLowerCase())}
                  className="h-8 px-2 border rounded text-sm font-semibold focus:outline-none cursor-pointer"
                  style={{
                    background: "var(--theme-popup-field-bg)",
                    color: "var(--theme-popup-text)",
                    borderColor: "var(--theme-popup-field-border)",
                  }}
                >
                  <option value="pm">PM</option>
                  <option value="am">AM</option>
                </select>
              </div>
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* Force Buy toggle */}
            <div className="mb-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={18} style={{ color: "var(--theme-popup-border)" }} />
                  <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>Force Buy Button</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setForceBuyEnabled(!forceBuyEnabled)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: forceBuyEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                    boxShadow: forceBuyEnabled ? "0 0 10px rgba(251, 191, 36, 0.45)" : "none",
                    position: "relative",
                    transition: "background 0.2s, box-shadow 0.2s",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: forceBuyEnabled ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }}
                  />
                </button>
              </div>
              <div className="text-xs mt-1 font-medium" style={{ color: forceBuyEnabled ? "var(--theme-status-success)" : "var(--theme-status-loss)" }}>
                {forceBuyEnabled ? "Enabled" : "Disabled (self-control mode)"}
              </div>
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* AI Guard section */}
            <div className="mb-5">
              {/* Section header with master toggle */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield size={18} style={{ color: "var(--theme-popup-border)" }} />
                  <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>AI Guard</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setAiGuardEnabled(!aiGuardEnabled)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: aiGuardEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                    boxShadow: aiGuardEnabled ? "0 0 10px rgba(251, 191, 36, 0.45)" : "none",
                    position: "relative",
                    transition: "background 0.2s, box-shadow 0.2s",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: aiGuardEnabled ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }}
                  />
                </button>
              </div>

              <div className="text-xs mb-3 font-semibold" style={{ color: aiGuardEnabled ? "var(--theme-status-success)" : "var(--theme-popup-label)" }}>
                {aiGuardEnabled ? (aiApiKey ? (aiTestStatus === "connected" ? "Active" : aiTestStatus === "failed" ? "Enabled but API key invalid" : "Enabled — testing connection...") : "Enabled but no API keys — add keys to activate") : "Disabled"}
              </div>

              {aiGuardEnabled && (
                <div style={{ padding: 16, borderRadius: 14, background: "var(--theme-popup-subcard-bg)", border: "1px solid var(--theme-popup-subcard-border)", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
                  {/* Entry Guard toggle */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <div className="relative flex items-center gap-1.5">
                        <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Enable EntryGuard</label>
                        <button
                          type="button"
                          onClick={() => setIsEntryGuardInfoOpen((prev) => !prev)}
                          className="flex h-5 w-5 items-center justify-center rounded-full border text-gray-500 hover:text-gray-700"
                          style={{ borderColor: "var(--theme-popup-field-border)" }}
                          aria-label="EntryGuard info"
                        >
                          <HelpCircle className="h-3 w-3" />
                        </button>
                        {isEntryGuardInfoOpen && (
                          <div
                            data-tooltip
                            className="absolute left-0 top-7 w-60 rounded-md p-2 shadow-lg"
                            style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: "11px", lineHeight: "18px" }}
                          >
                            Blocks UT bot BUY when market is sideways. Prevents bad entries before they happen.
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAiEntryGuardEnabled(!aiEntryGuardEnabled)}
                        style={{
                          width: 36,
                          height: 20,
                          borderRadius: 10,
                          background: aiEntryGuardEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                          boxShadow: aiEntryGuardEnabled ? "0 0 8px rgba(251, 191, 36, 0.4)" : "none",
                          position: "relative",
                          transition: "background 0.2s, box-shadow 0.2s",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 2,
                            left: aiEntryGuardEnabled ? 19 : 2,
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: "#fff",
                            transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Auto-execute exits toggle */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <div className="relative flex items-center gap-1.5">
                        <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Auto-execute exits</label>
                        <button
                          type="button"
                          onClick={() => setIsAutoExitInfoOpen((prev) => !prev)}
                          className="flex h-5 w-5 items-center justify-center rounded-full border text-gray-500 hover:text-gray-700"
                          style={{ borderColor: "var(--theme-popup-field-border)" }}
                          aria-label="Auto-exit info"
                        >
                          <HelpCircle className="h-3 w-3" />
                        </button>
                        {isAutoExitInfoOpen && (
                          <div
                            data-tooltip
                            className="absolute left-0 top-7 w-60 rounded-md p-2 shadow-lg"
                            style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: "11px", lineHeight: "18px" }}
                          >
                            When OFF, AI only shows exit suggestions. When ON, AI exits the trade automatically when it detects sideways or reversal conditions. For sideways, it waits 30s (retrying every 10s) before exit.
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAiAutoExitEnabled(!aiAutoExitEnabled)}
                        style={{
                          width: 36,
                          height: 20,
                          borderRadius: 10,
                          background: aiAutoExitEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                          boxShadow: aiAutoExitEnabled ? "0 0 8px rgba(251, 191, 36, 0.4)" : "none",
                          position: "relative",
                          transition: "background 0.2s, box-shadow 0.2s",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 2,
                            left: aiAutoExitEnabled ? 19 : 2,
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: "#fff",
                            transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Candles count input */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="relative flex items-center gap-1.5">
                        <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Candles for analysis</label>
                        <button
                          type="button"
                          onClick={() => setIsCandlesInfoOpen((prev) => !prev)}
                          className="flex h-5 w-5 items-center justify-center rounded-full border text-gray-500 hover:text-gray-700"
                          style={{ borderColor: "var(--theme-popup-field-border)" }}
                          aria-label="Candles count info"
                        >
                          <HelpCircle className="h-3 w-3" />
                        </button>
                        {isCandlesInfoOpen && (
                          <div
                            data-tooltip
                            className="absolute left-0 top-7 w-60 rounded-md p-2 shadow-lg"
                            style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: "11px", lineHeight: "18px" }}
                          >
                            Number of 1-minute candles sent to AI for analysis. More candles = better context but slower response. 120 candles = 2 hours of price action.
                          </div>
                        )}
                      </div>
                      <ClampedNumericField
                        value={aiCandlesCount}
                        onChange={setAiCandlesCount}
                        min={60}
                        max={240}
                        className="w-16 h-7 px-2 rounded-lg text-xs text-center"
                        style={{
                          background: "var(--theme-popup-field-bg)",
                          color: "var(--theme-accent-gold, var(--theme-popup-text))",
                          border: "1px solid var(--theme-popup-field-border)",
                          fontWeight: 700,
                        }}
                      />
                    </div>
                  </div>

                  {/* Recent Candles Weight */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="relative flex items-center gap-1.5">
                        <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Recent Candles Weight</label>
                      </div>
                      <ClampedNumericField
                        value={aiRecentCandlesCount}
                        onChange={setAiRecentCandlesCount}
                        min={10}
                        max={60}
                        className="w-16 h-7 px-2 rounded-lg text-xs text-center"
                        style={{
                          background: "var(--theme-popup-field-bg)",
                          color: "var(--theme-accent-gold, var(--theme-popup-text))",
                          border: "1px solid var(--theme-popup-field-border)",
                          fontWeight: 700,
                        }}
                      />
                    </div>
                  </div>

                  {/* Consider Volume toggle */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Consider Volume</label>
                      <button
                        type="button"
                        onClick={() => setAiConsiderVolume(!aiConsiderVolume)}
                        style={{
                          width: 36,
                          height: 20,
                          borderRadius: 10,
                          background: aiConsiderVolume ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                          boxShadow: aiConsiderVolume ? "0 0 8px rgba(251, 191, 36, 0.4)" : "none",
                          position: "relative",
                          transition: "background 0.2s, box-shadow 0.2s",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 2,
                            left: aiConsiderVolume ? 19 : 2,
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: "#fff",
                            transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }}
                        />
                      </button>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--theme-popup-label)" }}>
                      Include volume data in AI prompt for analysis
                    </div>
                  </div>

                  {/* Heikin-Ashi Smoothing toggle */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Heikin-Ashi Smoothing</label>
                      <button
                        type="button"
                        onClick={() => setAiUseHeikinAshi(!aiUseHeikinAshi)}
                        style={{
                          width: 36,
                          height: 20,
                          borderRadius: 10,
                          background: aiUseHeikinAshi ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                          boxShadow: aiUseHeikinAshi ? "0 0 8px rgba(251, 191, 36, 0.4)" : "none",
                          position: "relative",
                          transition: "background 0.2s, box-shadow 0.2s",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 2,
                            left: aiUseHeikinAshi ? 19 : 2,
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: "#fff",
                            transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }}
                        />
                      </button>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--theme-popup-label)" }}>
                      Smooth candle data with Heikin-Ashi before AI analysis
                    </div>
                  </div>

                  {/* AI Provider dropdown */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="relative flex items-center gap-1.5">
                        <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>AI Provider</label>
                        <button
                          type="button"
                          onClick={() => setIsProviderInfoOpen((prev) => !prev)}
                          className="flex h-5 w-5 items-center justify-center rounded-full border text-gray-500 hover:text-gray-700"
                          style={{ borderColor: "var(--theme-popup-field-border)" }}
                          aria-label="AI Provider info"
                        >
                          <HelpCircle className="h-3 w-3" />
                        </button>
                        {isProviderInfoOpen && (
                          <div
                            data-tooltip
                            className="absolute left-0 top-7 w-60 rounded-md p-2 shadow-lg"
                            style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: "11px", lineHeight: "18px" }}
                          >
                            Groq is free and fast. Claude Haiku is paid but offers strong reasoning quality.
                          </div>
                        )}
                      </div>
                      <a
                        href={aiProvider === "claude" ? "https://console.anthropic.com/settings/keys" : "https://console.groq.com/keys"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline font-semibold"
                        style={{ color: "var(--theme-accent-gold, var(--theme-popup-border))" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Get API key ↗
                      </a>
                    </div>
                    <select
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg text-xs"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                        outline: "none",
                      }}
                    >
                      <option value="groq" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>Groq (free)</option>
                      <option value="claude" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>Claude Haiku 3.5 (paid)</option>
                    </select>
                  </div>

                  {/* Groq Model dropdown */}
                  {aiProvider === "groq" && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>Groq Model</label>
                    </div>
                    <select
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg text-xs"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                        outline: "none",
                      }}
                    >
                      <option value="openai/gpt-oss-20b" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>GPT OSS 20B — fast, low cost</option>
                      <option value="openai/gpt-oss-120b" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>GPT OSS 120B — highest quality (recommended)</option>
                      <option value="qwen/qwen3.6-27b" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>Qwen 3.6 27B — preview</option>
                    </select>
                  </div>
                  )}

                  {/* API Key input */}
                  <div>
                    <div className="relative flex items-center gap-1.5 mb-1.5">
                      <label className="text-xs font-semibold" style={{ color: "var(--theme-popup-text)" }}>AI API Keys</label>
                      <button
                        type="button"
                        onClick={() => setIsApiKeyInfoOpen((prev) => !prev)}
                        className="flex h-5 w-5 items-center justify-center rounded-full border text-gray-500 hover:text-gray-700"
                        style={{ borderColor: "var(--theme-popup-field-border)" }}
                        aria-label="API Key info"
                      >
                        <HelpCircle className="h-3 w-3" />
                      </button>
                      {isApiKeyInfoOpen && (
                        <div
                          data-tooltip
                          className="absolute left-0 top-7 w-60 rounded-md p-2 shadow-lg"
                          style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: "11px", lineHeight: "18px" }}
                        >
                          Your API keys are stored locally. One key per line. Get them from the provider console. Multiple keys are rotated automatically to increase rate limits.
                        </div>
                      )}
                    </div>
                    <textarea
                      value={aiApiKey}
                      onChange={(e) => setAiApiKey(e.target.value)}
                      placeholder={`Paste your ${aiProvider === "claude" ? "Claude" : "Groq"} API key(s) here — one per line`}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg text-xs resize-vertical"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                        outline: "none",
                        fontFamily: "monospace",
                      }}
                    />
                    {/* Test connection status */}
                    {aiTestStatus === "testing" && (
                      <div className="text-xs mt-1.5" style={{ color: "var(--theme-popup-label)" }}>
                        <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
                        Testing connection...
                      </div>
                    )}
                    {aiTestStatus === "connected" && (
                      <div className="text-xs mt-1.5" style={{ color: "var(--theme-status-success)" }}>
                        ✓ Connected
                      </div>
                    )}
                    {aiTestStatus === "failed" && (
                      <div className="text-xs mt-1.5" style={{ color: "#ef4444" }}>
                        ✗ {aiTestError}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* TEMP AI TESTING section */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FlaskConical size={18} style={{ color: "#a855f7" }} />
                  <h3 className="text-sm font-bold" style={{ color: "var(--theme-popup-text)" }}>TEMP AI Testing</h3>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7", fontSize: "10px" }}>TEMP</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTempTestingEnabled(!tempTestingEnabled)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: tempTestingEnabled ? "#a855f7" : "var(--theme-popup-field-border)",
                    position: "relative",
                    transition: "background 0.2s",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: tempTestingEnabled ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }}
                  />
                </button>
              </div>

              {tempTestingEnabled && (
                <>

              <div className="text-xs mb-3" style={{ color: "var(--theme-popup-label)" }}>
                Paste candle data (CSV format: time,open,high,low,close[,volume]) to test AI analysis without live market.
              </div>

              {/* Candle data textarea */}
              <div className="mb-3">
                <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--theme-popup-label)" }}>
                  Candle Data (paste from your OHLC file — last {aiCandlesCount} will be used)
                </label>
                <textarea
                  value={tempCandleText}
                  onChange={(e) => setTempCandleText(e.target.value)}
                  placeholder={"time,open,high,low,close,volume\n09:15,307.55,320.35,290,291.05,245\n09:16,286.6,287.75,275,275.4,256\n..."}
                  rows={8}
                  className="w-full p-3 rounded-lg text-xs font-mono"
                  style={{
                    background: "var(--theme-popup-field-bg)",
                    border: "1px solid var(--theme-popup-field-border)",
                    color: "var(--theme-popup-text)",
                    resize: "vertical",
                    minHeight: "120px",
                  }}
                />
                <div className="text-xs mt-1" style={{ color: "var(--theme-popup-label)" }}>
                  {tempCandleText.trim() ? `${tempCandleText.trim().split("\n").filter((l) => l.trim() && !l.toLowerCase().startsWith("time,") && !l.toLowerCase().startsWith("date,")).length} lines detected` : "No data pasted yet"}
                </div>
              </div>

              {/* Submit button */}
              <button
                type="button"
                disabled={tempStatus === "testing" || !tempCandleText.trim()}
                onClick={async () => {
                  setTempStatus("testing");
                  setTempResult(null);
                  try {
                    const res = await fetch("/next-api/ai/TEMP_analyze-test", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ candleText: tempCandleText, apiKey: aiApiKey.split("\n").map((k) => k.trim()).filter(Boolean)[0] || aiApiKey }),
                    });
                    const data = await res.json();
                    if (data.error) {
                      setTempStatus("error");
                      setTempResult({ parsed: null, rawResponse: "", candleCount: 0, usedCount: 0, error: data.error });
                    } else {
                      setTempStatus("done");
                      setTempResult(data);
                    }
                  } catch {
                    setTempStatus("error");
                    setTempResult({ parsed: null, rawResponse: "", candleCount: 0, usedCount: 0, error: "Cannot reach server" });
                  }
                }}
                className="w-full h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-2"
                style={{
                  background: tempStatus === "testing" ? "var(--theme-popup-field-border)" : "#a855f7",
                  color: "#fff",
                  border: "none",
                  cursor: tempStatus === "testing" || !tempCandleText.trim() ? "not-allowed" : "pointer",
                  opacity: tempStatus === "testing" || !tempCandleText.trim() ? 0.6 : 1,
                }}
              >
                {tempStatus === "testing" ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing...</>
                ) : (
                  <><FlaskConical className="w-3.5 h-3.5" /> Send to AI</>
                )}
              </button>

              {/* Results */}
              {tempStatus === "error" && tempResult?.error && (
                <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
                  {tempResult.error}
                </div>
              )}

              {tempStatus === "done" && tempResult && (
                <div className="mt-3 space-y-3">
                  {/* Parsed result */}
                  {tempResult.parsed && (
                    <div className="p-3 rounded-lg" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}>
                      <div className="text-xs font-bold mb-2" style={{ color: "#a855f7" }}>AI Response</div>
                      <div className="space-y-1 text-xs" style={{ color: "var(--theme-popup-text)" }}>
                        <div><span style={{ color: "var(--theme-popup-label)" }}>Regime:</span> <span style={{ fontWeight: 600, color: tempResult.parsed.marketRegime === "UPWARDS" ? "#22c55e" : tempResult.parsed.marketRegime === "SIDEWAYS" ? "#f59e0b" : "#ef4444" }}>{tempResult.parsed.marketRegime}</span></div>
                        <div><span style={{ color: "var(--theme-popup-label)" }}>Block Entry:</span> {String(tempResult.parsed.blockEntry)}</div>
                        <div><span style={{ color: "var(--theme-popup-label)" }}>Suggest Exit:</span> {String(tempResult.parsed.suggestExit)}</div>
                        <div><span style={{ color: "var(--theme-popup-label)" }}>Confidence:</span> <span style={{ fontWeight: 600 }}>{tempResult.parsed.confidence}%</span></div>
                        <div><span style={{ color: "var(--theme-popup-label)" }}>Reason:</span> {tempResult.parsed.reason}</div>
                        {tempResult.parsed.rangeHigh != null && <div><span style={{ color: "var(--theme-popup-label)" }}>Range High:</span> {tempResult.parsed.rangeHigh}</div>}
                        {tempResult.parsed.rangeLow != null && <div><span style={{ color: "var(--theme-popup-label)" }}>Range Low:</span> {tempResult.parsed.rangeLow}</div>}
                      </div>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="text-xs" style={{ color: "var(--theme-popup-label)" }}>
                    Candles parsed: {tempResult.candleCount} | Used: {tempResult.usedCount} | Model: {tempResult.model || "openai/gpt-oss-120b"}
                  </div>


                  {/* Raw response */}
                  <details>
                    <summary className="text-xs cursor-pointer" style={{ color: "var(--theme-popup-label)" }}>Raw AI response</summary>
                    <pre className="mt-2 p-2 rounded text-xs overflow-auto" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)", maxHeight: "200px" }}>
{tempResult.rawResponse}
                    </pre>
                  </details>

                  {/* Prompt sent */}
                  <details>
                    <summary className="text-xs cursor-pointer" style={{ color: "var(--theme-popup-label)" }}>Prompt sent to AI</summary>
                    <pre className="mt-2 p-2 rounded text-xs overflow-auto" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)", maxHeight: "200px" }}>
{tempResult.promptSent || "(not available)"}
                    </pre>
                  </details>
                </div>
              )}
                </>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
