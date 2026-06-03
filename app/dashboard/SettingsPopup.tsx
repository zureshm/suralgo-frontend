"use client";

import { useEffect, useState } from "react";
import { X, Settings } from "lucide-react";

const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL || "http://localhost:4000";

// Friendly display names for strategy script names — edit these as needed
const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  evaluateEMACross: "EMA Crossover",
  surStrategy: "Sur Strategy",
  chatGptStrategy: "ChatGPT Strategy",
  claudSurStrategy: "Claude Sur Strategy",
  utGptStrategy: "UT GPT",
  utGptStrategy1: "UT GPT v1",
  utGptStrategy2: "UT GPT v2",
  utGptStrategy3: "UT GPT v3",
  superDoubleUT: "Super Double UT",
  superUTBotStrategy: "Super UT Bot",
  doubleUTBotStrategy: "Double UT Bot",
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
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
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
          </>
        )}
      </div>
    </div>
  );
}
