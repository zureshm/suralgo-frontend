"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { UserCircle, Loader2, HelpCircle } from "lucide-react";

interface AccountInfo {
  broker: string;
  clientCode: string;
  net: number;
  availableCash: number;
  availableIntradayPayin: number;
  availableLimitMargin: number;
  collateral: number;
  m2mUnrealized: number;
  m2mRealized: number;
  utilisedDebits: number;
  utilisedPayout: number;
}

const TRADE_API = "http://localhost:5000";

export default function BrokerLoginCard() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");

  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const fetchFunds = useCallback(() => {
    fetch(`${TRADE_API}/auth/funds`)
      .then((r) => r.json())
      .then((funds) => {
        if (funds.success) {
          setAccountInfo((prev) =>
            prev
              ? {
                  ...prev,
                  net: funds.net ?? 0,
                  availableCash: funds.availableCash ?? 0,
                  availableIntradayPayin: funds.availableIntradayPayin ?? 0,
                  availableLimitMargin: funds.availableLimitMargin ?? 0,
                  collateral: funds.collateral ?? 0,
                  m2mUnrealized: funds.m2mUnrealized ?? 0,
                  m2mRealized: funds.m2mRealized ?? 0,
                  utilisedDebits: funds.utilisedDebits ?? 0,
                  utilisedPayout: funds.utilisedPayout ?? 0,
                }
              : prev
          );
        }
      })
      .catch(() => {});
  }, []);

  // Check session status on mount
  useEffect(() => {
    fetch(`${TRADE_API}/auth/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.isLoggedIn) {
          setConnected(true);
          const emptyFunds = { net: 0, availableCash: 0, availableIntradayPayin: 0, availableLimitMargin: 0, collateral: 0, m2mUnrealized: 0, m2mRealized: 0, utilisedDebits: 0, utilisedPayout: 0 };
          setAccountInfo({
            broker: "Angel One",
            clientCode: data.clientCode || "",
            ...emptyFunds,
          });
          fetchFunds();
        }
      })
      .catch(() => {});
  }, [fetchFunds]);

  // Auto-refresh funds every 30s while connected
  useEffect(() => {
    if (!connected) return;

    const interval = setInterval(fetchFunds, 30000);
    return () => clearInterval(interval);
  }, [connected, fetchFunds]);

  const handleConnect = useCallback(async () => {
    setError("");

    if (!clientCode.trim() || !password.trim() || !totpSecret.trim()) {
      setError("All fields are required.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${TRADE_API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          clientCode: clientCode.trim(),
          password: password.trim(),
          totpSecret: totpSecret.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }

      const f = data.funds || {};
      setAccountInfo({
        broker: "Angel One",
        clientCode: data.clientCode || clientCode.trim(),
        net: f.net ?? 0,
        availableCash: f.availableCash ?? 0,
        availableIntradayPayin: f.availableIntradayPayin ?? 0,
        availableLimitMargin: f.availableLimitMargin ?? 0,
        collateral: f.collateral ?? 0,
        m2mUnrealized: f.m2mUnrealized ?? 0,
        m2mRealized: f.m2mRealized ?? 0,
        utilisedDebits: f.utilisedDebits ?? 0,
        utilisedPayout: f.utilisedPayout ?? 0,
      });
      setConnected(true);
    } catch (err) {
      setError("Cannot reach trade server. Is it running on port 5000?");
    } finally {
      setLoading(false);
    }
  }, [apiKey, clientCode, password, totpSecret]);

  const handleDisconnect = useCallback(async () => {
    try {
      await fetch(`${TRADE_API}/auth/logout`, { method: "POST" });
    } catch {
      // server unreachable — still clear local state
    }
    setConnected(false);
    setAccountInfo(null);
    setApiKey("");
    setClientCode("");
    setPassword("");
    setTotpSecret("");
    setError("");
  }, []);

  const formatCurrency = (val: number) =>
    "₹" + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── Connected State ──
  if (connected && accountInfo) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex flex-col gap-3">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <UserCircle className="w-5 h-5" />
              {accountInfo.broker}
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
                Client Code: {accountInfo.clientCode}
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
            {[
              { key: "net", label: "Net Balance", value: accountInfo.net, color: "text-green-600", tip: "Your total account value after all credits and debits. This is the overall net worth of your trading account." },
              { key: "availableCash", label: "Available Cash", value: accountInfo.availableCash, color: "text-green-600", tip: "Cash currently available in your account that can be used for trading or withdrawal." },
              { key: "intradayPayin", label: "Intraday Payin", value: accountInfo.availableIntradayPayin, color: "text-blue-600", tip: "Funds available for intraday (MIS) trades, including any deposits (payin) made today that have been credited to your account." },
              { key: "limitMargin", label: "Limit Margin", value: accountInfo.availableLimitMargin, color: "text-blue-600", tip: "Margin available for placing limit orders. This is the maximum amount you can use for pending/limit orders." },
              { key: "collateral", label: "Collateral", value: accountInfo.collateral, color: "text-muted-foreground", tip: "Value of pledged holdings (stocks/mutual funds) that can be used as margin for F&O trading." },
              { key: "m2mUnrealized", label: "M2M Unrealized", value: accountInfo.m2mUnrealized, color: "text-orange-600", tip: "Mark-to-Market profit or loss on your open positions that hasn't been booked yet. Changes with every price tick." },
              { key: "m2mRealized", label: "M2M Realized", value: accountInfo.m2mRealized, color: "text-orange-600", tip: "Mark-to-Market profit or loss that has been booked from closed positions today." },
              { key: "utilisedDebits", label: "Utilised Debits", value: accountInfo.utilisedDebits, color: "text-red-600", tip: "Total margin/funds currently blocked for your open positions and pending orders." },
              { key: "utilisedPayout", label: "Utilised Payout", value: accountInfo.utilisedPayout, color: "text-red-600", tip: "Funds that have been received via payin (deposit/transfer) into your trading account. This reflects how much money you've added." },
            ].map((row, i, arr) => (
              <div key={row.key} className={`flex justify-between items-center py-1.5 ${i < arr.length - 1 ? "border-b" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{row.label}</span>
                  <div className="relative">
                    <button
                      type="button"
                      className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600"
                      onClick={() => setOpenTooltip(openTooltip === row.key ? null : row.key)}
                    >
                      <HelpCircle className="h-3 w-3" />
                    </button>
                    {openTooltip === row.key && (
                      <div
                        className="absolute left-0 bottom-6 w-56 rounded-md p-2 text-white shadow-lg"
                        style={{ zIndex: 9, background: "rgba(0, 0, 0, 0.85)", fontSize: "11px", lineHeight: "16px" }}
                      >
                        {row.tip}
                      </div>
                    )}
                  </div>
                </div>
                <span className={`text-sm font-bold ${row.color}`}>
                  {formatCurrency(row.value)}
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
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <UserCircle className="w-5 h-5" />
            Angel One
          </CardTitle>
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

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              API Key
            </label>
            <Input
              type="password"
              placeholder="SmartAPI key (optional if set in .env)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Client Code
            </label>
            <Input
              placeholder="e.g. S1234567"
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              value={totpSecret}
              onChange={(e) => setTotpSecret(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

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
