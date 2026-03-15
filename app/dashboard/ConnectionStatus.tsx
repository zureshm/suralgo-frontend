"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import styles from "./ConnectionStatus.module.scss";
import { Network } from "lucide-react";

interface ConnectionStatus {
  api: boolean;
  strategy: boolean;
}

interface ConnectionItem {
  name: string;
  endpoint: string;
  connected: boolean;
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

  const connectionItems: ConnectionItem[] = [
    {
      name: "API Server",
      endpoint: "localhost:2000",
      connected: connections.api
    },
    {
      name: "Strategy Engine",
      endpoint: "localhost:4000",
      connected: connections.strategy
    }
  ];

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <Network className="w-5 h-5" />
          CONNECTION STATUS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectionItems.map((item, index) => (
          <div 
            key={index}
            className={styles.connectionRow}
          >
            <div className={styles.connectionInfo}>
              <div className={styles.connectionName}>{item.name}</div>
              <div className={styles.connectionEndpoint}>
                {item.endpoint}
              </div>
            </div>
            <div 
              className={`${styles.statusIndicator} ${
                item.connected ? styles.connected : styles.disconnected
              }`}
            >
              {item.connected ? "Connected" : "Disconnected"}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
