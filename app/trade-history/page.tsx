"use client";

import styles from "./page.module.scss";
import { useRouter } from "next/navigation";

const history = [
  { symbol: "NIFTY 10MAR26 24800 CE", pnl: "+3200.05", positive: true },
  { symbol: "NIFTY 10MAR26 24900 PE", pnl: "+425.05", positive: true },
  { symbol: "NIFTY 10MAR26 24900 PE", pnl: "-1820.00", positive: false },
];

export default function TradeHistoryPage() {
  const router = useRouter();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backButton} type="button" onClick={() => router.push("/dashboard")}>← BACK</button>
        <div className={styles.divider}></div>
        <h1 className={styles.title}>FINISHED TRADE HISTORY</h1>

        <div className={styles.card}>
          {history.map((item, idx) => (
            <div key={`${item.symbol}-${idx}`} className={styles.item}>
              <div className={styles.itemTop}>
                <div className={styles.symbol}>{item.symbol}</div>
                <div
                  className={`${styles.pnl} ${
                    item.positive ? styles.positive : styles.negative
                  }`}
                >
                  {item.pnl}
                </div>
              </div>
              <div className={styles.details}>Details......</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
