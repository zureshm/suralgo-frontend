"use client";

import { useEffect, useState } from "react";
import { X, Settings, Play, Palette } from "lucide-react";
import { playSound, setVolume } from "@/lib/sounds";
import { useTheme } from "@/components/ThemeProvider";
import { useTradeStore } from "../store/TradeStore";

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

  // Load volume from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("soundVolume");
    if (stored) setVolumeState(parseFloat(stored));
  }, []);

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
        className="relative w-[380px] rounded-2xl p-6"
        style={{
          background: "var(--theme-popup-bg)",
          color: "var(--theme-popup-text)",
          border: "3px solid var(--theme-popup-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",  maxWidth:"90%"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
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

        {loading ? (
          <div className="text-sm py-4 text-center" style={{ color: "var(--theme-popup-label)" }}>Loading...</div>
        ) : (
          <>
            {/* Current strategy */}
            <div className="mb-5">
              <div className="text-xs font-medium mb-1" style={{ color: "var(--theme-popup-label)" }}>Current Running Strategy</div>
              <div className="text-base font-bold" style={{ color: "var(--theme-popup-border)" }}>
                {getDisplayName(activeStrategy)}
              </div>
            </div>

            {/* Strategy selector */}
            <div className="mb-5">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--theme-popup-label)" }}>Switch Strategy</label>
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
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium" style={{ color: "var(--theme-popup-label)" }}>Color Theme</label>
                <Palette size={14} style={{ color: "var(--theme-popup-border)" }} />
              </div>
              <div className="flex items-center gap-4">
                {[
                  { value: "default" as const, label: "Default", color: "#323335" },
                  { value: "blue" as const, label: "Blue", color: "#164c8e" },
                  { value: "brown" as const, label: "Brown", color: "#570101" },
                ].map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTheme(t.value)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: t.color,
                        border: theme === t.value ? "3px solid var(--theme-popup-border)" : "2px solid var(--theme-popup-field-border)",
                        boxShadow: theme === t.value ? "0 0 0 2px #fff inset" : "none",
                      }}
                    />
                    <span className="text-xs" style={{ color: "var(--theme-popup-text)", fontWeight: theme === t.value ? 700 : 400 }}>
                      {t.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* Volume control */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium" style={{ color: "var(--theme-popup-label)" }}>Sound Volume</label>
                <span className="text-xs font-semibold" style={{ color: "var(--theme-popup-border)" }}>{Math.round(volume * 100)}%</span>
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
                    accentColor: "var(--theme-popup-border)",
                  }}
                />
                <button
                  onClick={() => playSound("enter")}
                  className="p-2 rounded-lg transition"
                  style={{ background: "var(--theme-popup-field-bg)", color: "var(--theme-popup-border)" }}
                  aria-label="Test sound"
                >
                  <Play size={16} />
                </button>
              </div>
            </div>

            {/* Separator */}
            <div className="my-6" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

            {/* Force Buy toggle */}
            <div className="mb-5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: "var(--theme-popup-label)" }}>Force Buy Button</label>
                <button
                  type="button"
                  onClick={() => setForceBuyEnabled(!forceBuyEnabled)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: forceBuyEnabled ? "var(--theme-popup-border)" : "var(--theme-popup-field-border)",
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
              <div className="text-xs mt-1" style={{ color: forceBuyEnabled ? "var(--theme-status-success)" : "var(--theme-status-loss)" }}>
                {forceBuyEnabled ? "Enabled" : "Disabled (self-control mode)"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
