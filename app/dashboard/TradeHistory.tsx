"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTradeStore } from "../store/TradeStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import styles from "./TradeHistory.module.scss";

export default function TradeHistory() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { tradeHistory } = useTradeStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeHistory = mounted ? tradeHistory : [];

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <CardTitle className="text-lg font-semibold">TRADE HISTORY</CardTitle>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Total Trades: {safeHistory.length}
            </span>
            {safeHistory.length > 0 && (
              <Badge variant="secondary" className="font-semibold">
                {safeHistory.filter(item => item.pnl > 0).length} Wins / {safeHistory.filter(item => item.pnl < 0).length} Losses
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <Separator />
        <div className="max-h-[400px] overflow-y-auto">
          {safeHistory.length === 0 ? (
            <div className={styles.empty}>No trade history yet</div>
          ) : (
          safeHistory.map((item) => {
            const pnlText = item.pnl >= 0 ? `+${item.pnl.toFixed(2)}` : item.pnl.toFixed(2);
            return (
              <div key={item.id} className={styles.historyItem}>
                <div className={styles.historyItemTop}>
                  <div className={styles.historySymbol}>{item.symbol}</div>
                  <div
                    className={`${styles.historyPnl} ${
                      item.pnl >= 0 ? styles.historyPositive : styles.historyNegative
                    }`}
                  >
                    {pnlText}
                  </div>
                </div>

                <details>
                  <summary className={styles.historyDetails}>Details......</summary>
                  <div className={styles.historyDetails}>
                    {item.logs.length === 0 ? (
                      <div>No logs</div>
                    ) : (
                      item.logs.map((line, i) => (
                        <div key={i}>
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                </details>
              </div>
            );
          })
        )}
        </div>
      </CardContent>
    </Card>
  );
}
