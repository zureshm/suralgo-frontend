"use client";

import { useState, useEffect } from "react";
import styles from "./ConnectionStatus.module.scss";

interface ConnectionStatus {
  api: boolean;
  strategy: boolean;
}

export default function ConnectionStatus() {
  const [connections, setConnections] = useState<ConnectionStatus>({
    api: false,
    strategy: false
  });

  useEffect(() => {
    const checkConnections = async () => {
      // Check API connection (localhost:2000)
      try {
        const apiResponse = await fetch("http://localhost:2000/watchlist");
        setConnections(prev => ({ ...prev, api: apiResponse.ok }));
      } catch {
        setConnections(prev => ({ ...prev, api: false }));
      }

      // Check Strategy connection (localhost:4000)
      try {
        const strategyResponse = await fetch("http://localhost:4000/evaluate");
        setConnections(prev => ({ ...prev, strategy: strategyResponse.ok }));
      } catch {
        setConnections(prev => ({ ...prev, strategy: false }));
      }
    };

    // Check immediately
    checkConnections();

    // Check every 5 seconds
    const interval = setInterval(checkConnections, 5000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (connected: boolean) => {
    return connected ? "#0a9b3f" : "#d60000";
  };

  const getStatusText = (connected: boolean) => {
    return connected ? "Connected" : "Disconnected";
  };

  return (
    <>
      <h2 className={styles.sectionTitle}>CONNECTION STATUS</h2>
      
      <div className={styles.card}>
        <div className={styles.connectionRow}>
          <div className={styles.connectionInfo}>
            <div className={styles.connectionName}>API Server</div>
            <div className={styles.connectionEndpoint}>localhost:2000</div>
          </div>
          <div 
            className={styles.statusIndicator}
            style={{ backgroundColor: getStatusColor(connections.api) }}
          >
            {getStatusText(connections.api)}
          </div>
        </div>

        <div className={styles.connectionRow}>
          <div className={styles.connectionInfo}>
            <div className={styles.connectionName}>Strategy Engine</div>
            <div className={styles.connectionEndpoint}>localhost:4000</div>
          </div>
          <div 
            className={styles.statusIndicator}
            style={{ backgroundColor: getStatusColor(connections.strategy) }}
          >
            {getStatusText(connections.strategy)}
          </div>
        </div>
      </div>
    </>
  );
}
