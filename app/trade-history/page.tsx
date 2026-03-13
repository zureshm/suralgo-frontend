"use client";

import styles from "./page.module.scss";
import { useRouter } from "next/navigation";
import { useTradeStore } from "../store/TradeStore";

export default function TradeHistoryPage() {
  const router = useRouter();
  const { tradeHistory } = useTradeStore();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backButton} type="button" onClick={() => router.push("/dashboard")}>← BACK</button>
        <div className={styles.divider}></div>
        <h1 className={styles.title}>FINISHED TRADE HISTORY</h1>

        <div className={styles.card}>
          {tradeHistory.length === 0 ? (
            <div className={styles.details}>No history yet</div>
          ) : (
            tradeHistory.map((item) => {
              const pnlText = item.pnl >= 0 ? `+${item.pnl.toFixed(2)}` : item.pnl.toFixed(2);
              return (
                <div key={item.id} className={styles.item}>
                  <div className={styles.itemTop}>
                    <div className={styles.symbol}>{item.symbol}</div>
                    <div
                      className={`${styles.pnl} ${
                        item.pnl >= 0 ? styles.positive : styles.negative
                      }`}
                    >
                      {pnlText}
                    </div>
                  </div>

                  <details>
                    <summary className={styles.details}>Details......</summary>
                    <div>
                      {item.logs.length === 0 ? (
                        <div className={styles.details}>No logs</div>
                      ) : (
                        item.logs.map((line, i) => (
                          <div key={i} className={styles.details}>
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
      </div>
    </div>
  );
}
