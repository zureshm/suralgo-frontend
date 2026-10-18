"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert, Loader2 } from "lucide-react";

export default function RiskManagement() {
  const [totalTargetEnabled, setTotalTargetEnabled] = useState(false);
  const [totalTargetValue, setTotalTargetValue] = useState(1200);
  const [totalLossEnabled, setTotalLossEnabled] = useState(false);
  const [totalLossValue, setTotalLossValue] = useState(-1200);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const settingsLoadedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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
  }, []);

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

  const toggleStyle = (on: boolean) => ({
    width: 44,
    height: 24,
    borderRadius: 12,
    background: on ? "var(--theme-popup-border)" : "var(--theme-popup-field-border)",
    position: "relative" as const,
    transition: "background 0.2s",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
  });

  const toggleKnob = (on: boolean) => ({
    position: "absolute" as const,
    top: 3,
    left: on ? 23 : 3,
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "#fff",
    transition: "left 0.2s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  });

  const inputStyle = (color: string) => ({
    fontSize: "1.2rem",
    background: "var(--theme-popup-field-bg)",
    border: "1px solid var(--theme-popup-field-border)",
    width: "100%",
    minWidth: 0,
    color,
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="w-5 h-5" />
          RISK MANAGEMENT
        </CardTitle>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="animate-spin w-4 h-4" />
            <span className="text-sm text-muted-foreground">Loading settings...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Total Target */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Total Target</span>
                  <span className="text-xs text-muted-foreground">Exit all trades if overall profit reaches this amount</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTotalTargetEnabled(!totalTargetEnabled)}
                  style={toggleStyle(totalTargetEnabled)}
                >
                  <span style={toggleKnob(totalTargetEnabled)} />
                </button>
              </div>

              <div className="flex items-center gap-2 w-full">
                <span className="font-bold text-green-600 text-lg whitespace-nowrap">₹ +</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="flex-1 px-3 py-2 rounded-md font-bold focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed w-full"
                  style={inputStyle("#16a34a")}
                  value={totalTargetValue}
                  disabled={!totalTargetEnabled}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, "");
                    setTotalTargetValue(cleaned === "" ? 0 : Number(cleaned));
                  }}
                />
              </div>
            </div>

            <Separator />

            {/* Total Loss */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Total Loss</span>
                  <span className="text-xs text-muted-foreground">Exit all trades if overall loss reaches this amount</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTotalLossEnabled(!totalLossEnabled)}
                  style={toggleStyle(totalLossEnabled)}
                >
                  <span style={toggleKnob(totalLossEnabled)} />
                </button>
              </div>

              <div className="flex items-center gap-2 w-full">
                <span className="font-bold text-red-600 text-lg whitespace-nowrap">₹ -</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="flex-1 px-3 py-2 rounded-md font-bold focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed w-full"
                  style={inputStyle("#dc2626")}
                  value={Math.abs(totalLossValue)}
                  disabled={!totalLossEnabled}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, "");
                    setTotalLossValue(cleaned === "" ? 0 : -Number(cleaned));
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              {saving && <Loader2 className="animate-spin w-3 h-3" />}
              {saving ? "Saving changes..." : "Settings saved automatically"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
