"use client";

import styles from "./TradeHistory.module.scss";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTradeStore } from "../store/TradeStore";

export default function TradeHistory() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { tradeHistory } = useTradeStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeHistory = mounted ? tradeHistory : [];

  return (
    <>
      <h2 className={styles.sectionTitle}>TRADE HISTORY</h2>
      
      <div className={`${styles.card} ${styles.historyCard}`}>
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
    </>
  );
}
