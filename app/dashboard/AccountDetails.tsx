"use client";

import styles from "./AccountDetails.module.scss";

export default function AccountDetails() {
  return (
    <>
      <h2 className={styles.sectionTitle}>ACCOUNT DETAILS</h2>
      
      <div className={styles.card}>
        <div className={styles.topRow}>
          <div className={styles.userId}>User ID : SUR-1234X</div>
          <button className={styles.disconnect} type="button">
            DISCONNECT
          </button>
        </div>

        <div className={styles.statusRow}>
          <div className={styles.statusLabel}>Status :</div>
          <div className={styles.statusValue}>Connected</div>
        </div>

        <div className={styles.divider} />

        <div className={styles.lines}>
          <div>Available Cash: ₹95,000</div>
          <div>Margin Used: ₹12,500</div>
          <div>Available to Trade: ₹82,500</div>
        </div>
      </div>
    </>
  );
}
