"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { UserCircle, Loader2, HelpCircle } from "lucide-react";

// ── Broker types & configuration ───────────────────────────────────────────

type BrokerType = "angelone" | "flattrade";

const ANGELONE_API =
  process.env.NEXT_PUBLIC_TRADE_EXECUTION_URL || "http://localhost:5000";
const FLATTRADE_API =
  process.env.NEXT_PUBLIC_FLATTRADE_EXECUTION_URL || "http://localhost:5001";

const BROKER_CONFIG: Record<BrokerType, { name: string; apiUrl: string }> = {
  angelone: { name: "Angel One", apiUrl: ANGELONE_API },
  flattrade: { name: "Flattrade", apiUrl: FLATTRADE_API },
};

interface AccountInfo {
  broker: BrokerType;
  brokerName: string;
  clientId: string;
  funds: Record<string, number>;
}

// ── Fund row display configs per broker ────────────────────────────────────

const ANGELONE_FUND_ROWS = [
  { key: "net", label: "Net Balance", color: "text-green-600", tip: "Your total account value after all credits and debits. This is the overall net worth of your trading account." },
  { key: "availableCash", label: "Available Cash", color: "text-green-600", tip: "Cash currently available in your account that can be used for trading or withdrawal." },
  { key: "availableIntradayPayin", label: "Intraday Payin", color: "text-blue-600", tip: "Funds available for intraday (MIS) trades, including any deposits (payin) made today that have been credited to your account." },
  { key: "availableLimitMargin", label: "Limit Margin", color: "text-blue-600", tip: "Margin available for placing limit orders. This is the maximum amount you can use for pending/limit orders." },
  { key: "collateral", label: "Collateral", color: "text-muted-foreground", tip: "Value of pledged holdings (stocks/mutual funds) that can be used as margin for F&O trading." },
  { key: "m2mUnrealized", label: "M2M Unrealized", color: "text-orange-600", tip: "Mark-to-Market profit or loss on your open positions that hasn't been booked yet. Changes with every price tick." },
  { key: "m2mRealized", label: "M2M Realized", color: "text-orange-600", tip: "Mark-to-Market profit or loss that has been booked from closed positions today." },
  { key: "utilisedDebits", label: "Utilised Debits", color: "text-red-600", tip: "Total margin/funds currently blocked for your open positions and pending orders." },
  { key: "utilisedPayout", label: "Utilised Payout", color: "text-red-600", tip: "Funds that have been received via payin (deposit/transfer) into your trading account. This reflects how much money you've added." },
];

const FLATTRADE_FUND_ROWS = [
  { key: "availableMargin", label: "Available Margin", color: "text-green-600", tip: "Cash currently available for trading after deducting all margin utilization." },
  { key: "totalCredits", label: "Total Credits", color: "text-green-600", tip: "Total funds credited to your account including opening balance and deposits." },
  { key: "openingBalance", label: "Opening Balance", color: "text-blue-600", tip: "Your account balance at the start of the trading day." },
  { key: "utilization", label: "Utilization", color: "text-red-600", tip: "Total margin currently utilized for open positions and pending orders." },
  { key: "peakMargin", label: "Peak Margin", color: "text-orange-600", tip: "Highest margin utilized during the trading day." },
  { key: "unrealizedMtm", label: "Unrealized MTM", color: "text-orange-600", tip: "Mark-to-Market profit or loss on open positions that hasn't been booked yet." },
  { key: "derivativeIntradayMargin", label: "Derivative Intraday Margin", color: "text-muted-foreground", tip: "Margin blocked for intraday derivative positions." },
];

const FUND_ROWS_MAP: Record<BrokerType, typeof ANGELONE_FUND_ROWS> = {
  angelone: ANGELONE_FUND_ROWS,
  flattrade: FLATTRADE_FUND_ROWS,
};

// ── Component ──────────────────────────────────────────────────────────────

export default function BrokerLoginCard() {
  const [selectedBroker, setSelectedBroker] = useState<BrokerType>("angelone");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  // Angel One fields
  const [aoApiKey, setAoApiKey] = useState("");
  const [aoClientCode, setAoClientCode] = useState("");
  const [aoPassword, setAoPassword] = useState("");
  const [aoTotpSecret, setAoTotpSecret] = useState("");

  // Flattrade fields
  const [ftApiKey, setFtApiKey] = useState("");
  const [ftApiSecret, setFtApiSecret] = useState("");
  const [ftRequestCode, setFtRequestCode] = useState("");

  // ── Fetch funds for a given broker ──
  const fetchFunds = useCallback((broker: BrokerType) => {
    const apiUrl = BROKER_CONFIG[broker].apiUrl;
    fetch(`${apiUrl}/auth/funds`)
      .then((r) => r.json())
      .then((funds) => {
        if (funds.success) {
          const fundData: Record<string, number> = {};
          for (const [k, v] of Object.entries(funds)) {
            if (typeof v === "number") fundData[k] = v;
          }
          setAccountInfo((prev) =>
            prev ? { ...prev, funds: fundData } : prev
          );
        }
      })
      .catch(() => {});
  }, []);

  // Check session status on mount (check both brokers)
  useEffect(() => {
    const checkBroker = async (broker: BrokerType) => {
      try {
        const res = await fetch(
          `${BROKER_CONFIG[broker].apiUrl}/auth/status`
        );
        const data = await res.json();
        if (data.isLoggedIn) return { broker, data };
      } catch {
        // server not reachable
      }
      return null;
    };

    Promise.all([checkBroker("angelone"), checkBroker("flattrade")]).then(
      (results) => {
        const active = results.find((r) => r !== null);
        if (active) {
          const { broker, data } = active;
          setSelectedBroker(broker);
          setConnected(true);
          setAccountInfo({
            broker,
            brokerName: BROKER_CONFIG[broker].name,
            clientId: data.clientCode || data.userId || "",
            funds: {},
          });
          fetchFunds(broker);
        }
      }
    );
  }, [fetchFunds]);

  // Auto-refresh funds every 30s while connected
  useEffect(() => {
    if (!connected || !accountInfo) return;
    const interval = setInterval(
      () => fetchFunds(accountInfo.broker),
      30000
    );
    return () => clearInterval(interval);
  }, [connected, accountInfo, fetchFunds]);

  // ── Connect handler ──
  const handleConnect = useCallback(async () => {
    setError("");
    const apiUrl = BROKER_CONFIG[selectedBroker].apiUrl;

    if (selectedBroker === "angelone") {
      if (
        !aoClientCode.trim() ||
        !aoPassword.trim() ||
        !aoTotpSecret.trim()
      ) {
        setError("Client Code, Password and TOTP Secret are required.");
        return;
      }
    } else {
      if (!ftApiKey.trim() || !ftApiSecret.trim() || !ftRequestCode.trim()) {
        setError("API Key, API Secret and Request Code are required.");
        return;
      }
    }

    setLoading(true);
    try {
      const body =
        selectedBroker === "angelone"
          ? {
              apiKey: aoApiKey.trim() || undefined,
              clientCode: aoClientCode.trim(),
              password: aoPassword.trim(),
              totpSecret: aoTotpSecret.trim(),
            }
          : {
              apiKey: ftApiKey.trim(),
              apiSecret: ftApiSecret.trim(),
              requestCode: ftRequestCode.trim(),
            };

      const res = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }

      // Extract numeric fund values generically
      const fundData: Record<string, number> = {};
      const fundsObj = data.funds || {};
      for (const [k, v] of Object.entries(fundsObj)) {
        if (typeof v === "number") fundData[k] = v;
      }

      const clientId =
        selectedBroker === "angelone"
          ? data.clientCode || aoClientCode.trim()
          : data.userId || "";

      setAccountInfo({
        broker: selectedBroker,
        brokerName: BROKER_CONFIG[selectedBroker].name,
        clientId,
        funds: fundData,
      });
      setConnected(true);

      // Notify trade engine which broker execution server to use
      fetch("/next-api/broker/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: apiUrl }),
      }).catch(() => {});
    } catch {
      const port = selectedBroker === "angelone" ? "5000" : "5001";
      setError(
        `Cannot reach trade server. Is it running on port ${port}?`
      );
    } finally {
      setLoading(false);
    }
  }, [
    selectedBroker,
    aoApiKey,
    aoClientCode,
    aoPassword,
    aoTotpSecret,
    ftApiKey,
    ftApiSecret,
    ftRequestCode,
  ]);

  // ── Disconnect handler ──
  const handleDisconnect = useCallback(async () => {
    if (accountInfo) {
      const apiUrl = BROKER_CONFIG[accountInfo.broker].apiUrl;
      try {
        await fetch(`${apiUrl}/auth/logout`, { method: "POST" });
      } catch {
        // server unreachable — still clear local state
      }
    }
    setConnected(false);
    setAccountInfo(null);

    // Reset trade engine to default broker URL
    fetch("/next-api/broker/active", { method: "DELETE" }).catch(() => {});
    setAoApiKey("");
    setAoClientCode("");
    setAoPassword("");
    setAoTotpSecret("");
    setFtApiKey("");
    setFtApiSecret("");
    setFtRequestCode("");
    setError("");
  }, [accountInfo]);

  const formatCurrency = (val: number) =>
    "₹" +
    val.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // ── Connected State ──
  if (connected && accountInfo) {
    const fundRows = FUND_ROWS_MAP[accountInfo.broker];

    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex flex-col gap-3">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <UserCircle className="w-5 h-5" />
              {accountInfo.brokerName}
            </CardTitle>
            <span className="text-xs text-muted-foreground -mt-2">
              Trading Account
            </span>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Badge variant="success" className="font-semibold">
                Connected
              </Badge>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-bold">
                {accountInfo.broker === "angelone"
                  ? "Client Code"
                  : "User ID"}
                : {accountInfo.clientId}
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
              >
                DISCONNECT
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <Separator />

          <div className="space-y-1">
            {fundRows.map((row, i, arr) => (
              <div
                key={row.key}
                className={`flex justify-between items-center py-1.5 ${i < arr.length - 1 ? "border-b" : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{row.label}</span>
                  <div className="relative">
                    <button
                      type="button"
                      className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600"
                      onClick={() =>
                        setOpenTooltip(
                          openTooltip === row.key ? null : row.key
                        )
                      }
                    >
                      <HelpCircle className="h-3 w-3" />
                    </button>
                    {openTooltip === row.key && (
                      <div
                        className="absolute left-0 bottom-6 w-56 rounded-md p-2 text-white shadow-lg"
                        style={{
                          zIndex: 9,
                          background: "rgba(0, 0, 0, 0.85)",
                          fontSize: "11px",
                          lineHeight: "16px",
                        }}
                      >
                        {row.tip}
                      </div>
                    )}
                  </div>
                </div>
                <span className={`text-sm font-bold ${row.color}`}>
                  {formatCurrency(accountInfo.funds[row.key] ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Disconnected State (Login Form) ──
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <UserCircle className="w-5 h-5" />
              {BROKER_CONFIG[selectedBroker].name}
            </CardTitle>

            <select
              value={selectedBroker}
              onChange={(e) => {
                setSelectedBroker(e.target.value as BrokerType);
                setError("");
              }}
              disabled={loading}
              className="text-sm border rounded-md px-2 py-1.5 bg-background text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="angelone">Angel One</option>
              <option value="flattrade">Flattrade</option>
            </select>
          </div>

          <span className="text-xs text-muted-foreground">
            Trading Account
          </span>

          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Badge variant="destructive" className="font-semibold">
              Disconnected
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Separator />

        {selectedBroker === "angelone" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                API Key
              </label>
              <Input
                type="password"
                placeholder="SmartAPI key (optional if set in .env)"
                value={aoApiKey}
                onChange={(e) => setAoApiKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Client Code
              </label>
              <Input
                placeholder="e.g. S1234567"
                value={aoClientCode}
                onChange={(e) => setAoClientCode(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Password
              </label>
              <Input
                type="password"
                placeholder="Enter password"
                value={aoPassword}
                onChange={(e) => setAoPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                TOTP Secret
              </label>
              <Input
                type="password"
                placeholder="Enter TOTP secret"
                value={aoTotpSecret}
                onChange={(e) => setAoTotpSecret(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                API Key
              </label>
              <Input
                type="password"
                placeholder="Flattrade API key"
                value={ftApiKey}
                onChange={(e) => setFtApiKey(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                API Secret
              </label>
              <Input
                type="password"
                placeholder="Flattrade API secret"
                value={ftApiSecret}
                onChange={(e) => setFtApiSecret(e.target.value)}
                disabled={loading}
              />
            </div>

            <Button
              type="button"
              className={`w-full h-9 ${
                ftApiKey.trim()
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
              disabled={!ftApiKey.trim()}
              onClick={() => {
                window.open(
                  `https://auth.flattrade.in/?app_key=${ftApiKey.trim()}`,
                  "_blank"
                );
              }}
            >
              Generate Code
            </Button>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Request Code
              </label>
              <Input
                placeholder="Code from Flattrade auth redirect URL"
                value={ftRequestCode}
                onChange={(e) => {
                  let val = e.target.value;
                  // Auto-extract code from pasted redirect URL
                  // e.g. http://localhost:3000/callback?code=abc-123&client=FT050489
                  try {
                    if (val.includes("code=")) {
                      const url = new URL(val);
                      const code = url.searchParams.get("code");
                      if (code) val = code;
                    }
                  } catch {
                    // not a valid URL, use raw value
                  }
                  setFtRequestCode(val);
                }}
                disabled={loading}
              />
            </div>
          </div>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={handleConnect}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
        </Button>

        {error && (
          <p className="text-xs text-destructive text-center">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
