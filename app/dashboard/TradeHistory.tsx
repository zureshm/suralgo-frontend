"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTradeStore } from "../store/TradeStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { History, Trash2 } from "lucide-react";
import styles from "./TradeHistory.module.scss";

export default function TradeHistory() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { tradeHistory, clearTradeHistory } = useTradeStore();
  const [currentPage, setCurrentPage] = useState(1);
  
  const tradesPerPage = 10;

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeHistory = mounted ? tradeHistory : [];
  
  // Pagination calculations
  const totalPages = Math.ceil(safeHistory.length / tradesPerPage);
  const startIndex = (currentPage - 1) * tradesPerPage;
  const endIndex = startIndex + tradesPerPage;
  const currentTrades = safeHistory.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <History className="w-5 h-5" />
            TRADE HISTORY
          </CardTitle>
          {safeHistory.length > 0 && (
            <button
              type="button"
              aria-label="Clear trade history"
              className="text-red-500 hover:text-red-600 transition-colors"
              onClick={() => {
                if (window.confirm("Clear all trade history?")) {
                  clearTradeHistory();
                }
              }}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Total Trades: {safeHistory.length}
          </span>
          {safeHistory.length > 0 && (
            <Badge variant="secondary" className="font-semibold">
              {safeHistory.filter(item => item.pnl > 0).length} Wins / {safeHistory.filter(item => item.pnl < 0).length} Losses
            </Badge>
          )}
          {totalPages > 1 && (
            <span className="text-sm text-muted-foreground ml-auto">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>
        <Separator />
        <div className="max-h-[380px] overflow-y-auto">
          {safeHistory.length === 0 ? (
            <div className={styles.empty}>No trade history yet</div>
          ) : (
          currentTrades.map((item, index) => {
            const pnlText = item.pnl >= 0 ? `+${item.pnl.toFixed(2)}` : item.pnl.toFixed(2);
            return (
              <div key={`${item.id}-${index}`} className={styles.historyItem}>
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
                  <div className={styles.historyLogs}>
                    {item.logs.length === 0 ? (
                      <div className={styles.logLine}>No logs</div>
                    ) : (
                      item.logs.map((line, i) => (
                        <div key={i} className={styles.logLine}>
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
        
        {totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        )}
      </CardContent>
    </Card>
  );
}
