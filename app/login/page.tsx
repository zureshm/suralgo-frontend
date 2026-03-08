"use client";
import styles from "./page.module.scss";
import { useRouter } from "next/navigation";


export default function LoginPage() {
  const router = useRouter();
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.formRow}>
          <label className={styles.label} htmlFor="userId">
            User ID :
          </label>
          <input
            id="userId"
            className={styles.input}
            type="text"
            placeholder=""
          />
        </div>

        <div className={styles.formRow}>
          <label className={styles.label} htmlFor="apiKey">
            API Key:
          </label>
          <input
            id="apiKey"
            className={styles.input}
            type="password"
            placeholder=""
          />
        </div>

        <div className={styles.actions}>
          <button className={styles.primaryButton} type="button" onClick={() => router.push('/dashboard')}>
            CONNECT
          </button>
        </div>
      </div>
    </div>
  );
}
