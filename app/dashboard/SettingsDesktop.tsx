"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { FocusEvent, InputHTMLAttributes } from "react";
import { Settings, Play, Palette, Shield, HelpCircle, Loader2, FlaskConical, Volume2, Zap, GitBranch, Clock, Monitor } from "lucide-react";
import { playSound, setVolume } from "@/lib/sounds";
import { useTheme } from "@/components/ThemeProvider";
import { useTradeStore } from "../store/TradeStore";

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

  const [aiGuardEnabled, setAiGuardEnabled] = useState(false);
  const [aiEntryGuardEnabled, setAiEntryGuardEnabled] = useState(false);
  const [aiAutoExitEnabled, setAiAutoExitEnabled] = useState(false);
  const [aiCandlesCount, setAiCandlesCount] = useState(120);
  const [aiRecentCandlesCount, setAiRecentCandlesCount] = useState(30);
  const [aiEntryBufferMaxCandles, setAiEntryBufferMaxCandles] = useState(1);
  const [aiConsiderVolume, setAiConsiderVolume] = useState(false);
  const [aiUseHeikinAshi, setAiUseHeikinAshi] = useState(true);
  const [aiProvider, setAiProvider] = useState("local");
  const [aiModel, setAiModel] = useState("openai/gpt-oss-120b");
  const [aiApiKey, setAiApiKey] = useState("");

  const aiSettingsLoadedRef = useRef(false);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    fetch("/next-api/ai/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          setAiGuardEnabled(Boolean(data.enabled));
          setAiEntryGuardEnabled(Boolean(data.entryGuardEnabled));
          setAiAutoExitEnabled(Boolean(data.autoExitEnabled));
          if (typeof data.candlesCount === "number") setAiCandlesCount(data.candlesCount);
          if (typeof data.recentCandlesCount === "number") setAiRecentCandlesCount(data.recentCandlesCount);
          if (typeof data.entryBufferMaxCandles === "number") setAiEntryBufferMaxCandles(data.entryBufferMaxCandles);
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
          localStorage.setItem("aiEntryBufferMaxCandles", String(data.entryBufferMaxCandles || 1));
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
        const aiEntryBuffer = localStorage.getItem("aiEntryBufferMaxCandles");
        if (aiEntryBuffer) setAiEntryBufferMaxCandles(parseInt(aiEntryBuffer, 10));
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
    localStorage.setItem("aiAutoExitEnabled", String(aiAutoExitEnabled));
    localStorage.setItem("aiCandlesCount", String(aiCandlesCount));
    localStorage.setItem("aiRecentCandlesCount", String(aiRecentCandlesCount));
    localStorage.setItem("aiEntryBufferMaxCandles", String(aiEntryBufferMaxCandles));
    localStorage.setItem("aiConsiderVolume", String(aiConsiderVolume));
    localStorage.setItem("aiUseHeikinAshi", String(aiUseHeikinAshi));
    localStorage.setItem("aiProvider", aiProvider);
    localStorage.setItem("aiModel", aiModel);
    localStorage.setItem("aiApiKey", aiApiKey);
  }, [aiGuardEnabled, aiEntryGuardEnabled, aiAutoExitEnabled, aiCandlesCount, aiRecentCandlesCount, aiEntryBufferMaxCandles, aiConsiderVolume, aiUseHeikinAshi, aiProvider, aiModel, aiApiKey]);

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
          entryBufferMaxCandles: aiEntryBufferMaxCandles,
          considerVolume: aiConsiderVolume,
          useHeikinAshi: aiUseHeikinAshi,
          provider: aiProvider,
          model: aiModel,
          apiKeys: aiApiKey,
        }),
      }).catch(() => {});
    }, 500);
  }, [aiGuardEnabled, aiEntryGuardEnabled, aiAutoExitEnabled, aiCandlesCount, aiRecentCandlesCount, aiEntryBufferMaxCandles, aiConsiderVolume, aiUseHeikinAshi, aiProvider, aiModel, aiApiKey]);

  useEffect(() => { postAiSettings(); }, [postAiSettings]);

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
              <div className="mb-4" style={labelStyle}>Appearance & Sound</div>
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
              <div className="mb-4" style={labelStyle}>Safety & Performance</div>
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
                  <div className="flex items-center gap-3">
                    <input
                      type="text" maxLength={2} value={autoCutoffHours}
                      onChange={(e) => setAutoCutoffHours(e.target.value.replace(/\D/g, ""))}
                      className="w-12 h-8 px-1 border rounded text-center text-sm font-semibold focus:outline-none"
                      style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    />
                    <span className="font-bold">:</span>
                    <input
                      type="text" maxLength={2} value={autoCutoffMinutes}
                      onChange={(e) => setAutoCutoffMinutes(e.target.value.replace(/\D/g, ""))}
                      className="w-12 h-8 px-1 border rounded text-center text-sm font-semibold focus:outline-none"
                      style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    />
                    <select
                      value={autoCutoffAmpm}
                      onChange={(e) => setAutoCutoffAmpm(e.target.value)}
                      className="h-8 px-2 border rounded text-sm font-semibold focus:outline-none cursor-pointer"
                      style={{ background: "var(--theme-popup-bg)", color: "var(--theme-popup-text)", borderColor: "var(--theme-popup-field-border)" }}
                    >
                      <option value="pm" style={{ background: "var(--theme-popup-bg)" }}>PM</option>
                      <option value="am" style={{ background: "var(--theme-popup-bg)" }}>AM</option>
                    </select>
                  </div>
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
              <div className="flex items-center justify-between mb-4">
                <div style={labelStyle}>AI Guard Intelligence</div>
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
                <div className="p-5 rounded-xl border space-y-6" style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Primary AI Switches */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold" style={{ color: "var(--theme-popup-text)" }}>Enable EntryGuard</label>
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
                              background: "var(--theme-toggle-dot, #fff)",
                              transition: "left 0.2s",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            }}
                          />
                        </button>
                      </div>
                    </div>

                    {/* AI Provider */}
                    <div>
                      <label className="block mb-1" style={labelStyle}>Provider</label>
                      <select
                        value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}
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
                      <label className="block mb-1" style={labelStyle}>Candles</label>
                      <ClampedNumericField value={aiCandlesCount} onChange={setAiCandlesCount} min={30} max={120} className="w-full h-8 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                    </div>
                    <div>
                      <label className="block mb-1" style={labelStyle}>Recent Wt</label>
                      <ClampedNumericField value={aiRecentCandlesCount} onChange={setAiRecentCandlesCount} min={10} max={60} className="w-full h-8 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                    </div>
                    <div>
                      <label className="block mb-1" style={labelStyle}>Buffer</label>
                      <ClampedNumericField value={aiEntryBufferMaxCandles} onChange={setAiEntryBufferMaxCandles} min={1} max={10} className="w-full h-8 rounded border border-black/10 text-center font-bold text-xs" style={{ background: "var(--theme-popup-bg)", color: "var(--theme-accent-gold, var(--theme-popup-text))", borderColor: "var(--theme-popup-field-border)" }} />
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="flex items-center justify-between h-8">
                        <label style={labelStyle}>HA</label>
                        <button
                          type="button"
                          onClick={() => setAiUseHeikinAshi(!aiUseHeikinAshi)}
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
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
