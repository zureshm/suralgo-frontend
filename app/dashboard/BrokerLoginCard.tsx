"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { UserCircle, Loader2 } from "lucide-react";

interface AccountInfo {
  broker: string;
  clientCode: string;
  availableCash: number;
  marginUsed: number;
  availableToTrade: number;
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

  // Check session status on mount
  useEffect(() => {
    fetch(`${TRADE_API}/auth/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data.isLoggedIn) {
          setConnected(true);
          setAccountInfo({
            broker: "Angel One",
            clientCode: data.clientCode || "",
            availableCash: 0,
            marginUsed: 0,
            availableToTrade: 0,
          });
          // Fetch funds separately
          fetch(`${TRADE_API}/auth/funds`)
            .then((r) => r.json())
            .then((funds) => {
              if (funds.success) {
                setAccountInfo((prev) =>
                  prev
                    ? {
                        ...prev,
                        availableCash: funds.availableCash ?? 0,
                        marginUsed: funds.marginUsed ?? 0,
                        availableToTrade: funds.availableToTrade ?? 0,
                      }
                    : prev
                );
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

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

      setAccountInfo({
        broker: "Angel One",
        clientCode: data.clientCode || clientCode.trim(),
        availableCash: data.availableCash ?? 0,
        marginUsed: data.marginUsed ?? 0,
        availableToTrade: data.availableToTrade ?? 0,
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
    "₹" + val.toLocaleString("en-IN");

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

          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm font-medium">Available Cash</span>
              <span className="text-sm font-bold text-green-600">
                {formatCurrency(accountInfo.availableCash)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm font-medium">Margin Used</span>
              <span className="text-sm font-bold text-orange-600">
                {formatCurrency(accountInfo.marginUsed)}
              </span>
            </div>

            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-medium">Available to Trade</span>
              <span className="text-sm font-bold text-blue-600">
                {formatCurrency(accountInfo.availableToTrade)}
              </span>
            </div>
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
