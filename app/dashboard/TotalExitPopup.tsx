"use client";

import { useEffect, useState, useRef } from "react";
import { X, LogOut, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function TotalExitPopup({ open, onClose }: Props) {
  const [totalTargetEnabled, setTotalTargetEnabled] = useState(false);
  const [totalTargetValue, setTotalTargetValue] = useState(1200);
  const [totalLossEnabled, setTotalLossEnabled] = useState(false);
  const [totalLossValue, setTotalLossValue] = useState(-1200);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const settingsLoadedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/next-api/total-exit")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          setTotalTargetEnabled(Boolean(data.totalTargetEnabled));
          setTotalTargetValue(data.totalTargetValue ?? 1200);
          setTotalLossEnabled(Boolean(data.totalLossEnabled));
          setTotalLossValue(data.totalLossValue ?? -1200);
          settingsLoadedRef.current = true;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      setSaving(true);
      fetch("/next-api/total-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalTargetEnabled,
          totalTargetValue,
          totalLossEnabled,
          totalLossValue,
        }),
      }).finally(() => setSaving(false));
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [totalTargetEnabled, totalTargetValue, totalLossEnabled, totalLossValue]);

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
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-5">
          <div className="flex items-center gap-2">
            <LogOut size={20} style={{ color: "var(--theme-popup-border)" }} />
            <h2 className="text-lg font-bold" style={{ color: "var(--theme-popup-text)" }}>Total Exit</h2>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "thin" }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Loader2 className="animate-spin" size={32} style={{ color: "var(--theme-popup-border)" }} />
              <span className="text-sm" style={{ color: "var(--theme-popup-label)" }}>Loading settings...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Total Target */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-semibold text-lg" style={{ color: "var(--theme-popup-text)" }}>Total Target</span>
                    <span className="text-xs" style={{ color: "var(--theme-popup-label)" }}>Exit all trades if overall profit reaches this amount</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTotalTargetEnabled(!totalTargetEnabled)}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      background: totalTargetEnabled ? "var(--theme-popup-border)" : "var(--theme-popup-field-border)",
                      position: "relative",
                      transition: "background 0.2s",
                      border: "none",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 3,
                        left: totalTargetEnabled ? 23 : 3,
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

                <div className="flex items-center gap-2">
                  <span className="font-bold text-green-600 text-lg">₹ +</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="flex-1 px-3 py-2 rounded-md font-bold text-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      fontSize: "1.2rem",
                      background: "var(--theme-popup-field-bg)",
                      border: "1px solid var(--theme-popup-field-border)",
                    }}
                    value={totalTargetValue}
                    disabled={!totalTargetEnabled}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9]/g, "");
                      setTotalTargetValue(cleaned === "" ? 0 : Number(cleaned));
                    }}
                  />
                </div>
              </div>

              {/* Separator */}
              <div style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}></div>

              {/* Total Loss */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-semibold text-lg" style={{ color: "var(--theme-popup-text)" }}>Total Loss</span>
                    <span className="text-xs" style={{ color: "var(--theme-popup-label)" }}>Exit all trades if overall loss reaches this amount</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTotalLossEnabled(!totalLossEnabled)}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      background: totalLossEnabled ? "var(--theme-popup-border)" : "var(--theme-popup-field-border)",
                      position: "relative",
                      transition: "background 0.2s",
                      border: "none",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 3,
                        left: totalLossEnabled ? 23 : 3,
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

                <div className="flex items-center gap-2">
                  <span className="font-bold text-red-600 text-lg">₹ -</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="flex-1 px-3 py-2 rounded-md font-bold text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      fontSize: "1.2rem",
                      background: "var(--theme-popup-field-bg)",
                      border: "1px solid var(--theme-popup-field-border)",
                    }}
                    value={Math.abs(totalLossValue)}
                    disabled={!totalLossEnabled}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^0-9]/g, "");
                      setTotalLossValue(cleaned === "" ? 0 : -Number(cleaned));
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid var(--theme-popup-field-border)" }}>
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--theme-popup-label)" }}>
            {saving && <Loader2 className="animate-spin" size={12} />}
            {saving ? "Saving changes..." : "Settings saved automatically"}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition"
            style={{
              background: "var(--theme-popup-border)",
              color: "#fff",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
