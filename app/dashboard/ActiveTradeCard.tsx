"use client";

import styles from "./ActiveTradeCard.module.scss";

type ActiveTradeCardProps = {
  symbol: string;
  pnl: number;
  logs: string[];
  onExit: () => void;
};

export default function ActiveTradeCard({
  symbol,
  pnl,
  logs,
  onExit,
}: ActiveTradeCardProps) {
  const pnlClass = pnl >= 0 ? styles.profit : styles.loss;
  const pnlText = pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2);

  return (
    <div className={styles.inner}>
      <div className={styles.topRow}>
        <div className={styles.symbol}>{symbol}</div>

        <div className={styles.rightSide}>
          <div className={`${styles.pnl} ${pnlClass}`}>{pnlText}</div>

          <button type="button" className={styles.exitBtn} onClick={onExit}>
            EXIT
          </button>
        </div>
      </div>

      <div className={styles.logBox}>
        {logs.length === 0 ? (
          <div className={styles.logLine}>No logs yet</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className={styles.logLine}>
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}