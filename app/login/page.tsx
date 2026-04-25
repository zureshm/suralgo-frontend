"use client";
import { useState } from "react";
import styles from "./page.module.scss";
import { useRouter } from "next/navigation";


export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");

  const handleConnect = () => {
    setError("");
    if (
      userId === process.env.NEXT_PUBLIC_APP_USERNAME &&
      apiKey === process.env.NEXT_PUBLIC_APP_PASSWORD
    ) {
      document.cookie = "auth=true; path=/; max-age=86400";
      router.push("/dashboard");
    } else {
      setError("Invalid credentials");
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Login</h1>

        <div className={styles.formRow}>
          <label className={styles.label} htmlFor="userId">User ID</label>
          <input
            id="userId"
            className={styles.input}
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>

        <div className={styles.formRow}>
          <label className={styles.label} htmlFor="apiKey">API Key</label>
          <input
            id="apiKey"
            className={styles.input}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={styles.primaryButton} type="button" onClick={handleConnect}>
            CONNECT
          </button>
        </div>
      </div>
    </div>
  );
}
