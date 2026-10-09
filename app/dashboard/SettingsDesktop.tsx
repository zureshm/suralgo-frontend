"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { FocusEvent, InputHTMLAttributes } from "react";
import { Settings, Play, Palette, Shield, HelpCircle, Loader2, FlaskConical, Volume2, Zap, GitBranch, Clock, Monitor, Dog } from "lucide-react";
import { playSound, setVolume } from "@/lib/sounds";
import { useTheme } from "@/components/ThemeProvider";
import { useTradeStore } from "../store/TradeStore";
import { useSharedAiSettings } from "@/lib/useSharedAiSettings";

interface ClampedNumericFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
}

function ClampedNumericField({ value, onChange, min, max, ...props }: ClampedNumericFieldProps) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : "");
  const [prevValue, setPrevValue] = useState<number>(value);

  if (value !== prevValue) {
    setPrevValue(value);
    setLocal(value != null ? String(value) : "");
  }

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
      onBlur={(e: FocusEvent<HTMLInputElement>) => {
        if (!e.target.value) {
          setLocal(String(min));
          onChange(min);
        } else {
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

export default function SettingsDesktop() {
  const [activeStrategy, setActiveStrategy] = useState<string>("");
  const [availableStrategies, setAvailableStrategies] = useState<string[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [volume, setVolumeState] = useState(0.5);
  const { theme, setTheme } = useTheme();
  const { forceBuyEnabled, setForceBuyEnabled, desktopViewEnabled, setDesktopViewEnabled } = useTradeStore();

  const [autoCutoffEnabled, setAutoCutoffEnabled] = useState(false);
  const [autoCutoffHours, setAutoCutoffHours] = useState("03");
  const [autoCutoffMinutes, setAutoCutoffMinutes] = useState("05");
  const [autoCutoffAmpm, setAutoCutoffAmpm] = useState("pm");
  const autoCutoffLoadedRef = useRef(false);
  const autoCutoffDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [watchdogEnabled, setWatchdogEnabled] = useState(false);
  const [watchdogCheckpoints, setWatchdogCheckpoints] = useState([
    { points: 16, breakBelow: 10 },
    { points: 25, breakBelow: 15 },
    { points: 40, breakBelow: 25 },
    { points: 60, breakBelow: 40 },
    { points: 100, breakBelow: 80 },
    { points: 130, breakBelow: 105 },
    { points: 150, breakBelow: 125 },
    { points: 170, breakBelow: 145 },
    { points: 190, breakBelow: 160 },
    { points: 210, breakBelow: 180 },
  ]);
  const watchdogLoadedRef = useRef(false);
  const watchdogDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use shared AI settings across all components
  const { settings: aiSettings, updateSettings: updateAiSettings } = useSharedAiSettings();
  
  // Convenience getters
  const aiGuardEnabled = aiSettings.enabled;
  const aiEntryGuardEnabled = aiSettings.entryGuardEnabled;
  const aiReEntryGuardEnabled = aiSettings.reEntryGuardEnabled;
  const aiAutoExitEnabled = aiSettings.autoExitEnabled;
  const aiCandlesCount = aiSettings.candlesCount;
  const aiRecentCandlesCount = aiSettings.recentCandlesCount;
  const aiEntryBufferMaxCandles = aiSettings.entryBufferMaxCandles;
  const aiExitBufferCandles = aiSettings.exitBufferCandles;
  const aiConsiderVolume = aiSettings.considerVolume;
  const aiUseHeikinAshi = aiSettings.useHeikinAshi;
  const aiProvider = aiSettings.provider;
  const aiModel = aiSettings.model;
  const aiApiKey = aiSettings.apiKey;

  const aiSettingsLoadedRef = useRef(false);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI Guard info tooltips
  const [isProviderInfoOpen, setIsProviderInfoOpen] = useState(false);
  const [isApiKeyInfoOpen, setIsApiKeyInfoOpen] = useState(false);

  // AI Guard test connection
  const [aiTestStatus, setAiTestStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [aiTestError, setAiTestError] = useState("");
  const aiPrevKeyRef = useRef<string>("");
  const aiPrevProviderRef = useRef<string>("local");
  const aiPrevModelRef = useRef<string>("openai/gpt-oss-120b");

  // TEMP AI Testing
  const [tempCandleText, setTempCandleText] = useState("");
  const [tempStatus, setTempStatus] = useState<"idle" | "testing" | "done" | "error">("idle");
  const [tempTestingEnabled, setTempTestingEnabled] = useState(false);
  const [tempResult, setTempResult] = useState<null | { parsed: { marketRegime?: string; blockEntry?: boolean; suggestExit?: boolean; confidence?: number; reason?: string; rangeHigh?: number; rangeLow?: number } | null; rawResponse: string; candleCount: number; usedCount: number; model?: string; promptSent?: string; error?: string; ruleBreakdown?: { name: string; value: string; triggered: boolean }[] }>(null);

  // Close tooltips when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button[aria-label*="info"]') || target.closest('[data-tooltip]')) return;
      setIsProviderInfoOpen(false);
      setIsApiKeyInfoOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("soundVolume");
    if (stored) {
        const v = parseFloat(stored);
        setVolumeState(v);
        setVolume(v);
    }

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

    fetch("/next-api/settings/watchdog")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          if (typeof data.watchdogEnabled === "boolean") setWatchdogEnabled(data.watchdogEnabled);
          if (Array.isArray(data.watchdogCheckpoints)) {
            setWatchdogCheckpoints(data.watchdogCheckpoints);
          }
          watchdogLoadedRef.current = true;
        }
      })
      .catch(() => {
        watchdogLoadedRef.current = true;
      });

    fetch("/next-api/ai/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          updateAiSettings({
            enabled: Boolean(data.enabled),
            entryGuardEnabled: Boolean(data.entryGuardEnabled),
            reEntryGuardEnabled: Boolean(data.reEntryGuardEnabled),
            autoExitEnabled: Boolean(data.autoExitEnabled),
            candlesCount: typeof data.candlesCount === "number" ? data.candlesCount : 120,
            recentCandlesCount: typeof data.recentCandlesCount === "number" ? data.recentCandlesCount : 30,
            entryBufferMaxCandles: typeof data.entryBufferMaxCandles === "number" ? data.entryBufferMaxCandles : 1,
            exitBufferCandles: typeof data.exitBufferCandles === "number" ? data.exitBufferCandles : 3,
            considerVolume: typeof data.considerVolume === "boolean" ? data.considerVolume : false,
            useHeikinAshi: typeof data.useHeikinAshi === "boolean" ? data.useHeikinAshi : true,
            provider: typeof data.provider === "string" ? data.provider : "local",
            model: typeof data.model === "string" ? data.model : "openai/gpt-oss-120b",
            apiKey: Array.isArray(data.apiKeys) ? data.apiKeys.join("\n") : (typeof data.apiKey === "string" ? data.apiKey : ""),
          });
          // Sync to localStorage as cache
          localStorage.setItem("aiGuardEnabled", String(data.enabled));
          localStorage.setItem("aiEntryGuardEnabled", String(data.entryGuardEnabled));
          localStorage.setItem("aiReEntryGuardEnabled", String(data.reEntryGuardEnabled));
          localStorage.setItem("aiAutoExitEnabled", String(data.autoExitEnabled));
          localStorage.setItem("aiCandlesCount", String(data.candlesCount));
          localStorage.setItem("aiRecentCandlesCount", String(data.recentCandlesCount));
          localStorage.setItem("aiEntryBufferMaxCandles", String(data.entryBufferMaxCandles || 1));
          localStorage.setItem("aiExitBufferCandles", String(data.exitBufferCandles || 3));
          localStorage.setItem("aiConsiderVolume", String(data.considerVolume || false));
          localStorage.setItem("aiUseHeikinAshi", String(data.useHeikinAshi !== false));
          localStorage.setItem("aiProvider", data.provider);
          localStorage.setItem("aiModel", data.model || "openai/gpt-oss-120b");
          localStorage.setItem("aiApiKey", Array.isArray(data.apiKeys) ? data.apiKeys.join("\n") : (data.apiKey || ""));
        }
      })
      .catch(() => {
        // Server unreachable — fall back to localStorage
        const updates: any = {};
        const aiGuard = localStorage.getItem("aiGuardEnabled");
        if (aiGuard) updates.enabled = aiGuard === "true";
        const aiEntry = localStorage.getItem("aiEntryGuardEnabled");
        if (aiEntry) updates.entryGuardEnabled = aiEntry === "true";
        const aiReEntry = localStorage.getItem("aiReEntryGuardEnabled");
        if (aiReEntry) updates.reEntryGuardEnabled = aiReEntry === "true";
        const aiAutoExit = localStorage.getItem("aiAutoExitEnabled");
        if (aiAutoExit) updates.autoExitEnabled = aiAutoExit === "true";
        const aiCandles = localStorage.getItem("aiCandlesCount");
        if (aiCandles) updates.candlesCount = parseInt(aiCandles, 10);
        const aiRecentCandles = localStorage.getItem("aiRecentCandlesCount");
        if (aiRecentCandles) updates.recentCandlesCount = parseInt(aiRecentCandles, 10);
        const aiEntryBuffer = localStorage.getItem("aiEntryBufferMaxCandles");
        if (aiEntryBuffer) updates.entryBufferMaxCandles = parseInt(aiEntryBuffer, 10);
        const aiExitBuffer = localStorage.getItem("aiExitBufferCandles");
        if (aiExitBuffer) updates.exitBufferCandles = parseInt(aiExitBuffer, 10);
        const aiVol = localStorage.getItem("aiConsiderVolume");
        if (aiVol) updates.considerVolume = aiVol === "true";
        const aiHA = localStorage.getItem("aiUseHeikinAshi");
        if (aiHA) updates.useHeikinAshi = aiHA === "true";
        const aiProv = localStorage.getItem("aiProvider");
        if (aiProv) updates.provider = aiProv;
        const aiMdl = localStorage.getItem("aiModel");
        if (aiMdl) updates.model = aiMdl;
        const aiKey = localStorage.getItem("aiApiKey");
        if (aiKey) updates.apiKey = aiKey;
        if (Object.keys(updates).length > 0) updateAiSettings(updates);
      })
      .finally(() => {
        aiSettingsLoadedRef.current = true;
      });

      setLoading(true);
      fetch(`${STRATEGY_URL}/strategy`)
        .then((r) => r.json())
        .then((data) => {
          setActiveStrategy(data.activeStrategy || "");
          setSelectedStrategy(data.activeStrategy || "");
          setAvailableStrategies(data.availableStrategies || []);
        })
        .finally(() => setLoading(false));
  }, []);

  // Persist AI Guard settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem("aiGuardEnabled", String(aiGuardEnabled));
    localStorage.setItem("aiEntryGuardEnabled", String(aiEntryGuardEnabled));
    localStorage.setItem("aiReEntryGuardEnabled", String(aiReEntryGuardEnabled));
    localStorage.setItem("aiAutoExitEnabled", String(aiAutoExitEnabled));
    localStorage.setItem("aiCandlesCount", String(aiCandlesCount));
    localStorage.setItem("aiRecentCandlesCount", String(aiRecentCandlesCount));
    localStorage.setItem("aiEntryBufferMaxCandles", String(aiEntryBufferMaxCandles));
    localStorage.setItem("aiExitBufferCandles", String(aiExitBufferCandles));
    localStorage.setItem("aiConsiderVolume", String(aiConsiderVolume));
    localStorage.setItem("aiUseHeikinAshi", String(aiUseHeikinAshi));
    localStorage.setItem("aiProvider", aiProvider);
    localStorage.setItem("aiModel", aiModel);
    localStorage.setItem("aiApiKey", aiApiKey);
  }, [aiGuardEnabled, aiEntryGuardEnabled, aiReEntryGuardEnabled, aiAutoExitEnabled, aiCandlesCount, aiRecentCandlesCount, aiEntryBufferMaxCandles, aiExitBufferCandles, aiConsiderVolume, aiUseHeikinAshi, aiProvider, aiModel, aiApiKey]);

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
          reEntryGuardEnabled: aiReEntryGuardEnabled,
          autoExitEnabled: aiAutoExitEnabled,
          candlesCount: aiCandlesCount,
          recentCandlesCount: aiRecentCandlesCount,
          entryBufferMaxCandles: aiEntryBufferMaxCandles,
          exitBufferCandles: aiExitBufferCandles,
          considerVolume: aiConsiderVolume,
          useHeikinAshi: aiUseHeikinAshi,
          provider: aiProvider,
          model: aiModel,
          apiKeys: aiApiKey,
        }),
      }).catch(() => {});
    }, 500);
  }, [aiGuardEnabled, aiEntryGuardEnabled, aiReEntryGuardEnabled, aiAutoExitEnabled, aiCandlesCount, aiRecentCandlesCount, aiEntryBufferMaxCandles, aiExitBufferCandles, aiConsiderVolume, aiUseHeikinAshi, aiProvider, aiModel, aiApiKey]);

  useEffect(() => { postAiSettings(); }, [postAiSettings]);

  // Auto-save Watchdog settings to server when changed
  useEffect(() => {
    if (!watchdogLoadedRef.current) return;
    if (watchdogDebounceRef.current) clearTimeout(watchdogDebounceRef.current);
    watchdogDebounceRef.current = setTimeout(() => {
      fetch("/next-api/settings/watchdog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watchdogEnabled,
          watchdogCheckpoints,
        }),
      }).catch((err) => console.error("Failed to save watchdog settings:", err));
    }, 400);
    return () => {
      if (watchdogDebounceRef.current) clearTimeout(watchdogDebounceRef.current);
    };
  }, [watchdogEnabled, watchdogCheckpoints]);

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
    if (aiProvider === "local" || aiProvider === "local_v2" || aiProvider === "local_v3" || aiProvider === "local_v4") {
      setAiTestStatus("idle");
      return;
    }
    if (aiApiKey && (aiApiKey !== aiPrevKeyRef.current || aiProvider !== aiPrevProviderRef.current || aiModel !== aiPrevModelRef.current)) {
      aiPrevKeyRef.current = aiApiKey;
      aiPrevProviderRef.current = aiProvider;
      aiPrevModelRef.current = aiModel;
      const timer = setTimeout(() => { testAiConnection(); }, 800);
      return () => clearTimeout(timer);
    }
  }, [aiApiKey, aiProvider, aiModel, testAiConnection]);

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

  const labelStyle = { color: "var(--theme-popup-label)", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase" as const, letterSpacing: "0.5px" };
  const sectionTitleStyle = { color: "var(--theme-popup-text)", fontSize: "14px", fontWeight: "bold" };
  const iconStyle = { color: "var(--theme-popup-border)" };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ padding: 16, color: "var(--theme-popup-text)" }}>
      <div className="flex items-center gap-2 mb-6">
        <Settings size={24} style={iconStyle} />
        <h2 className="text-xl font-bold">Application Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-6" style={{ scrollbarWidth: "thin" }}>
        {loading ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-popup-label)" }}>
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 opacity-50" />
            Loading settings...
          </div>
        ) : (
          <div className="space-y-8">
            {/* Strategy Section */}
            <section>
              <div className="mb-4" style={labelStyle}>Strategy Engine</div>
              <div className="p-4 rounded-xl border space-y-4" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                <div>
                  <div className="mb-1 opacity-60" style={labelStyle}>Current Strategy</div>
                  <span
                    className="text-xs px-2 py-0.5 rounded font-bold inline-block"
                    style={{ background: "var(--theme-active-badge-bg, var(--theme-bg))", color: "var(--theme-active-badge-text, #fff)", fontSize: "10px", letterSpacing: "0.5px" }}
                  >
                    {getDisplayName(activeStrategy)}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <GitBranch size={18} style={iconStyle} />
                    <h3 style={sectionTitleStyle}>Switch Running Strategy</h3>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={selectedStrategy}
                      onChange={(e) => {
                        setSelectedStrategy(e.target.value);
                        setMessage(null);
                      }}
                      className="flex-1 h-10 px-4 rounded-lg text-sm font-semibold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                        outline: "none",
                      }}
                    >
                      {availableStrategies.map((s) => (
                        <option key={s} value={s} style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>{getDisplayName(s)}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleSave}
                      disabled={saving || selectedStrategy === activeStrategy}
                      className="px-6 h-10 rounded-lg text-sm font-black transition active:scale-95"
                      style={{
                        background: selectedStrategy === activeStrategy ? "var(--theme-popup-field-border)" : "var(--theme-btn-enter-bg, var(--theme-popup-border))",
                        color: "var(--theme-btn-enter-text, #fff)",
                        cursor: selectedStrategy === activeStrategy ? "not-allowed" : "pointer",
                        opacity: selectedStrategy === activeStrategy ? 0.5 : 1
                      }}
                    >
                      {saving ? "..." : "Apply"}
                    </button>
                  </div>
                  {message && (
                    <div className="text-xs p-2 rounded text-center font-bold" style={{ background: message.type === "success" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: message.type === "success" ? "var(--theme-status-success)" : "var(--theme-status-loss)" }}>
                      {message.text}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Appearance Section */}
            <section>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Theme */}
                <div className="p-4 rounded-xl border" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Palette size={18} style={iconStyle} />
                    <h3 style={sectionTitleStyle}>Color Theme</h3>
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
                        className="cursor-pointer transition-transform hover:scale-110 active:scale-95 flex items-center justify-center p-0.5 rounded-full"
                        style={{ border: theme === t.value ? "2.5px solid var(--theme-popup-border)" : "2.5px solid transparent" }}
                      >
                        <span style={{ width: 24, height: 24, borderRadius: "50%", background: t.color, border: "1.5px solid rgba(255, 255, 255, 0.25)", boxShadow: theme === t.value ? "0 0 0 2px var(--theme-popup-bg), 0 0 8px rgba(0,0,0,0.3)" : "0 1px 3px rgba(0,0,0,0.2)", display: "block" }} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Volume */}
                <div className="p-4 rounded-xl border" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Volume2 size={18} style={iconStyle} />
                      <h3 style={sectionTitleStyle}>Sound Volume</h3>
                    </div>
                    <span className="text-xs font-bold" style={{ color: "var(--theme-accent-gold, var(--theme-popup-border))" }}>{Math.round(volume * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range" min="0" max="1" step="0.05" value={volume}
                      onChange={(e) => { const v = parseFloat(e.target.value); setVolumeState(v); setVolume(v); }}
                      className="flex-1 h-2 rounded-lg cursor-pointer appearance-auto"
                      style={{ accentColor: "var(--theme-accent-gold, var(--theme-popup-border))" }}
                    />
                    <button onClick={() => playSound("enter")} className="p-2 rounded-lg border transition hover:scale-105 active:scale-95" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-border))", borderColor: "var(--theme-popup-field-border)" }}><Play size={16} /></button>
                  </div>
                </div>
              </div>
            </section>

            {/* Core Settings Section */}
            <section>
              <div className="space-y-4">
                {/* Auto Cutoff */}
                <div className="p-4 rounded-xl border" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Clock size={18} style={iconStyle} />
                      <h3 style={sectionTitleStyle}>Auto Cutoff Time</h3>
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
                          background: "var(--theme-toggle-dot, #fff)",
                          transition: "left 0.2s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        }}
                      />
                    </button>
                  </div>
                  <div className={`flex items-center gap-3 transition-opacity duration-200 ${autoCutoffEnabled ? "opacity-100" : "opacity-35 pointer-events-none"}`}>
                    <input
                      type="text" maxLength={2} value={autoCutoffHours}
                      disabled={!autoCutoffEnabled}
                      onChange={(e) => setAutoCutoffHours(e.target.value.replace(/\D/g, ""))}
                      className="w-12 h-8 px-1 border rounded text-center text-sm font-semibold focus:outline-none"
                      style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    />
                    <span className="font-bold">:</span>
                    <input
                      type="text" maxLength={2} value={autoCutoffMinutes}
                      disabled={!autoCutoffEnabled}
                      onChange={(e) => setAutoCutoffMinutes(e.target.value.replace(/\D/g, ""))}
                      className="w-12 h-8 px-1 border rounded text-center text-sm font-semibold focus:outline-none"
                      style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    />
                    <select
                      value={autoCutoffAmpm}
                      disabled={!autoCutoffEnabled}
                      onChange={(e) => setAutoCutoffAmpm(e.target.value)}
                      className="h-8 px-2 border rounded text-sm font-semibold focus:outline-none cursor-pointer"
                      style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    >
                      <option value="pm" style={{ background: "var(--theme-popup-bg)" }}>PM</option>
                      <option value="am" style={{ background: "var(--theme-popup-bg)" }}>AM</option>
                    </select>
                  </div>
                </div>

                {/* Watchdog Section */}
                <div className="p-4 rounded-xl border" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Dog size={18} style={iconStyle} />
                      <h3 style={sectionTitleStyle}>Watchdog</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWatchdogEnabled(!watchdogEnabled)}
                      style={{
                        width: 44,
                        height: 24,
                        borderRadius: 12,
                        background: watchdogEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                        boxShadow: watchdogEnabled ? "0 0 10px rgba(251, 191, 36, 0.45)" : "none",
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
                          left: watchdogEnabled ? 23 : 3,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "var(--theme-toggle-dot, #fff)",
                          transition: "left 0.2s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        }}
                      />
                    </button>
                  </div>

                  {watchdogEnabled && (
                  <>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--theme-popup-text)" }}>Checkpoints</span>
                    <span className="text-[11px]" style={{ color: "var(--theme-popup-label)" }}>Based on current trade points achieved</span>
                  </div>

                  <div className="space-y-2.5">
                    {watchdogCheckpoints.map((cp, idx) => (
                      <div key={idx} className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg border border-white/5" style={{ background: "var(--theme-popup-bg)" }}>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold" style={{ color: "var(--theme-popup-text)", minWidth: "140px" }}>
                            Checkpoint {idx + 1} Points
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-emerald-400">+</span>
                            <input
                              type="number"
                              min={0}
                              max={999}
                              value={cp.points}
                              disabled={!watchdogEnabled}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setWatchdogCheckpoints((prev) => {
                                  const updated = [...prev];
                                  updated[idx] = { ...updated[idx], points: val };
                                  return updated;
                                });
                              }}
                              className="w-16 h-8 px-2 border rounded text-center text-sm font-semibold focus:outline-none"
                              style={{ background: "var(--theme-popup-field-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                            />
                            <span className="text-[11px] font-medium" style={{ color: "var(--theme-popup-label)" }}>pts</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium" style={{ color: "var(--theme-popup-label)", minWidth: "170px" }}>
                            Break when reach below point
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-amber-400">+</span>
                            <input
                              type="number"
                              min={0}
                              max={999}
                              value={cp.breakBelow}
                              disabled={!watchdogEnabled}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setWatchdogCheckpoints((prev) => {
                                  const updated = [...prev];
                                  updated[idx] = { ...updated[idx], breakBelow: val };
                                  return updated;
                                });
                              }}
                              className="w-16 h-8 px-2 border rounded text-center text-sm font-semibold focus:outline-none"
                              style={{ background: "var(--theme-popup-field-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                            />
                            <span className="text-[11px] font-medium" style={{ color: "var(--theme-popup-label)" }}>pts</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                  )}
                </div>

                {/* Force Buy & Desktop Toggle */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border flex items-center justify-between" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                    <div className="flex items-center gap-2">
                      <Zap size={18} style={iconStyle} />
                      <h3 style={sectionTitleStyle}>Force Buy Button</h3>
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
                          background: "var(--theme-toggle-dot, #fff)",
                          transition: "left 0.2s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        }}
                      />
                    </button>
                  </div>
                  <div className="p-4 rounded-xl border flex items-center justify-between" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                    <div className="flex items-center gap-2">
                      <Monitor size={18} style={iconStyle} />
                      <h3 style={sectionTitleStyle}>Desktop View</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDesktopViewEnabled(!desktopViewEnabled)}
                      style={{
                        width: 44,
                        height: 24,
                        borderRadius: 12,
                        background: desktopViewEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                        boxShadow: desktopViewEnabled ? "0 0 10px rgba(251, 191, 36, 0.45)" : "none",
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
                          left: desktopViewEnabled ? 23 : 3,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "var(--theme-toggle-dot, #fff)",
                          transition: "left 0.2s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        }}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* AI Guard Section */}
            <section>
              <div className="space-y-4">
                <div className="p-4 rounded-xl border" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Shield size={18} style={{ color: "var(--theme-popup-border)" }} />
                    <h3 style={sectionTitleStyle}>Enable AI Guard</h3>
                  </div>
                  <button
                  type="button"
                  onClick={() => updateAiSettings({ enabled: !aiGuardEnabled })}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: aiGuardEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                    boxShadow: aiGuardEnabled ? "0 0 10px rgba(251, 191, 36, 0.45)" : "none",
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
                      left: aiGuardEnabled ? 23 : 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "var(--theme-toggle-dot, #fff)",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                    }}
                  />
                  </button>
                </div>

                {aiGuardEnabled && (
                  <div className="space-y-6 pt-4 border-t border-black/5">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Primary AI Switches */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold" style={{ color: "var(--theme-popup-text)" }}>Enable EntryGuard</label>
                        <button
                          type="button"
                          onClick={() => updateAiSettings({ entryGuardEnabled: !aiEntryGuardEnabled })}
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
                              background: "var(--theme-toggle-dot, #fff)",
                              transition: "left 0.2s",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            }}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold" style={{ color: "var(--theme-popup-text)" }}>Enable Re-Entry Guard</label>
                        <button
                          type="button"
                          onClick={() => updateAiSettings({ reEntryGuardEnabled: !aiReEntryGuardEnabled })}
                          style={{
                            width: 36,
                            height: 20,
                            borderRadius: 10,
                            background: aiReEntryGuardEnabled ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                            boxShadow: aiReEntryGuardEnabled ? "0 0 8px rgba(251, 191, 36, 0.4)" : "none",
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
                              left: aiReEntryGuardEnabled ? 19 : 2,
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              background: "var(--theme-toggle-dot, #fff)",
                              transition: "left 0.2s",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            }}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold" style={{ color: "var(--theme-popup-text)" }}>Auto-execute Exits</label>
                        <button
                          type="button"
                          onClick={() => updateAiSettings({ autoExitEnabled: !aiAutoExitEnabled })}
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
                              background: "var(--theme-toggle-dot, #fff)",
                              transition: "left 0.2s",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            }}
                          />
                        </button>
                      </div>
                      {aiAutoExitEnabled && (
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold" style={{ color: "var(--theme-popup-text)" }}>Exit buffer (sideways)</label>
                          <div className="flex items-center gap-1.5">
                            <ClampedNumericField value={aiExitBufferCandles} onChange={(val) => updateAiSettings({ exitBufferCandles: val })} min={1} max={30} className="w-14 h-7 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                            <span className="text-[10px]" style={{ color: "var(--theme-popup-label)" }}>candles</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* AI Provider */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="relative flex items-center gap-1.5">
                          <label style={labelStyle}>Provider</label>
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
                              Local V1/V2: free rule-based engines, no API key needed. Groq is free and fast. Claude Haiku is paid but offers strong reasoning quality.
                            </div>
                          )}
                        </div>
                        {aiProvider !== "local" && aiProvider !== "local_v2" && aiProvider !== "local_v3" && aiProvider !== "local_v4" && (
                          <a
                            href={aiProvider === "claude" ? "https://console.anthropic.com/settings/keys" : "https://console.groq.com/keys"}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs underline font-semibold"
                            style={{ color: "var(--theme-accent-gold, var(--theme-popup-border))" }}
                          >
                            Get API key ↗
                          </a>
                        )}
                      </div>
                      <select
                        value={aiProvider} onChange={(e) => updateAiSettings({ provider: e.target.value })}
                        className="w-full h-9 px-2 rounded-lg text-xs font-bold border border-black/10 bg-transparent"
                        style={{ color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                      >
                        <option value="local" style={{ background: "var(--theme-popup-bg)" }}>Dinkan V1 (Rule Engine)</option>
                        <option value="local_v2" style={{ background: "var(--theme-popup-bg)" }}>Dinkan V2 (Choppy & Spike Guard)</option>
                        <option value="local_v3" style={{ background: "var(--theme-popup-bg)" }}>Dinkan V3 (Swift Trend Sniper)</option>
                        <option value="local_v4" style={{ background: "var(--theme-popup-bg)" }}>Dinkan V4 (Choppy Filter)</option>
                        <option value="groq" style={{ background: "var(--theme-popup-bg)" }}>Groq (free)</option>
                        <option value="claude" style={{ background: "var(--theme-popup-bg)" }}>Claude Haiku 3.5 (paid)</option>
                      </select>
                    </div>
                    </div>

                  {/* AI Advanced Params */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-black/5">
                    <div>
                      <label className="block mb-1" style={labelStyle}>Candles for analysis</label>
                      <ClampedNumericField value={aiCandlesCount} onChange={(val) => updateAiSettings({ candlesCount: val })} min={30} max={120} className="w-full h-8 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                    </div>
                    <div>
                      <label className="block mb-1" style={labelStyle}>Recent Candles Weight</label>
                      <ClampedNumericField value={aiRecentCandlesCount} onChange={(val) => updateAiSettings({ recentCandlesCount: val })} min={10} max={60} className="w-full h-8 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                    </div>
                    <div>
                      <label className="block mb-1" style={labelStyle}>Buffer Buy upto</label>
                      <ClampedNumericField value={aiEntryBufferMaxCandles} onChange={(val) => updateAiSettings({ entryBufferMaxCandles: val })} min={0} max={100} className="w-full h-8 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="flex items-center justify-between h-8">
                        <label style={labelStyle}>Heikin-Ashi Smoothing</label>
                        <button
                          type="button"
                          onClick={() => updateAiSettings({ useHeikinAshi: !aiUseHeikinAshi })}
                          style={{
                            width: 32,
                            height: 18,
                            borderRadius: 9,
                            background: aiUseHeikinAshi ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                            position: "relative",
                            transition: "background 0.2s",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              left: aiUseHeikinAshi ? 16 : 2,
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              background: "var(--theme-toggle-dot, #fff)",
                              transition: "left 0.2s",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            }}
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Groq Model dropdown */}
                  {aiProvider === "groq" && (
                  <div className="pt-4">
                    <label className="block mb-1" style={labelStyle}>Groq Model</label>
                    <select
                      value={aiModel} onChange={(e) => updateAiSettings({ model: e.target.value })}
                      className="w-full h-9 px-2 rounded-lg text-xs font-bold border border-black/10 bg-transparent"
                      style={{ color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    >
                      <option value="openai/gpt-oss-20b" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>GPT OSS 20B — fast, low cost</option>
                      <option value="openai/gpt-oss-120b" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>GPT OSS 120B — highest quality (recommended)</option>
                      <option value="qwen/qwen3.6-27b" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)" }}>Qwen 3.6 27B — preview</option>
                    </select>
                  </div>
                  )}

                  {/* API Key input */}
                  {aiProvider !== "local" && aiProvider !== "local_v2" && aiProvider !== "local_v3" && aiProvider !== "local_v4" && (
                  <div className="pt-4">
                    <div className="relative flex items-center gap-1.5 mb-1.5">
                      <label style={labelStyle}>AI API Keys</label>
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
                      onChange={(e) => updateAiSettings({ apiKey: e.target.value })}
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
                  )}
                </div>
                )}
                </div>
              </div>
            </section>

            {/* TEMP AI Testing Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FlaskConical size={18} style={{ color: "#a855f7" }} />
                  <div className="flex items-center gap-2" style={labelStyle}>
                    TEMP AI Testing
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7", fontSize: "10px" }}>TEMP</span>
                  </div>
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
                <div className="p-5 rounded-xl border" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                  <div className="text-xs mb-3" style={{ color: "var(--theme-popup-label)" }}>
                    Paste candle data (CSV format: time,open,high,low,close[,volume]) to test AI analysis without live market.
                  </div>

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
                        background: "var(--theme-popup-bg)",
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
                      <><FlaskConical className="w-3.5 h-3.5" /> {(aiProvider === "local" || aiProvider === "local_v2" || aiProvider === "local_v3" || aiProvider === "local_v4") ? "Analyze" : "Send to AI"}</>
                    )}
                  </button>

                  {tempStatus === "error" && tempResult?.error && (
                    <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
                      {tempResult.error}
                    </div>
                  )}

                  {tempStatus === "done" && tempResult && (
                    <div className="mt-3 space-y-3">
                      {tempResult.parsed && (
                        <div className="p-3 rounded-lg" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}>
                          <div className="text-xs font-bold mb-2" style={{ color: "#a855f7" }}>AI Response</div>
                          <div className="space-y-1 text-xs" style={{ color: "var(--theme-popup-text)" }}>
                            <div><span style={{ color: "var(--theme-popup-label)" }}>Regime:</span> <span style={{ fontWeight: 600, color: tempResult.parsed.marketRegime === "UPWARDS" ? "#22c55e" : tempResult.parsed.marketRegime === "SIDEWAYS" ? "#f59e0b" : (tempResult.parsed.marketRegime === "CHOPPY" || tempResult.parsed.marketRegime === "CHOP") ? "#ec4899" : tempResult.parsed.marketRegime === "TRADEABLE" ? "#06b6d4" : "#ef4444" }}>{tempResult.parsed.marketRegime}</span></div>
                            <div><span style={{ color: "var(--theme-popup-label)" }}>Block Entry:</span> {String(tempResult.parsed.blockEntry)}</div>
                            <div><span style={{ color: "var(--theme-popup-label)" }}>Suggest Exit:</span> {String(tempResult.parsed.suggestExit)}</div>
                            <div><span style={{ color: "var(--theme-popup-label)" }}>Confidence:</span> <span style={{ fontWeight: 600 }}>{tempResult.parsed.confidence}%</span></div>
                            <div><span style={{ color: "var(--theme-popup-label)" }}>Reason:</span> {tempResult.parsed.reason}</div>
                            {tempResult.parsed.rangeHigh != null && <div><span style={{ color: "var(--theme-popup-label)" }}>Range High:</span> {tempResult.parsed.rangeHigh}</div>}
                            {tempResult.parsed.rangeLow != null && <div><span style={{ color: "var(--theme-popup-label)" }}>Range Low:</span> {tempResult.parsed.rangeLow}</div>}
                          </div>
                        </div>
                      )}

                      {tempResult.ruleBreakdown && tempResult.ruleBreakdown.length > 0 && (
                        <div className="p-3 rounded-lg" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}>
                          <div className="text-xs font-bold mb-2" style={{ color: "#a855f7" }}>Rule Breakdown</div>
                          <div className="space-y-1 text-xs" style={{ color: "var(--theme-popup-text)" }}>
                            {tempResult.ruleBreakdown.map((rule, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: rule.triggered ? "#22c55e" : "var(--theme-popup-field-border)" }} />
                                <span style={{ color: "var(--theme-popup-label)", minWidth: 140 }}>{rule.name}</span>
                                <span style={{ fontWeight: 600 }}>{rule.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="text-xs" style={{ color: "var(--theme-popup-label)" }}>
                        Candles parsed: {tempResult.candleCount} | Used: {tempResult.usedCount} | Model: {tempResult.model || "openai/gpt-oss-120b"}
                      </div>

                      <details>
                        <summary className="text-xs cursor-pointer" style={{ color: "var(--theme-popup-label)" }}>Raw AI response</summary>
                        <pre className="mt-2 p-2 rounded text-xs overflow-auto" style={{ background: "var(--theme-popup-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)", maxHeight: "200px" }}>
{tempResult.rawResponse}
                        </pre>
                      </details>

                      <details>
                        <summary className="text-xs cursor-pointer" style={{ color: "var(--theme-popup-label)" }}>Prompt sent to AI</summary>
                        <pre className="mt-2 p-2 rounded text-xs overflow-auto" style={{ background: "var(--theme-popup-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)", maxHeight: "200px" }}>
{tempResult.promptSent || "(not available)"}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
