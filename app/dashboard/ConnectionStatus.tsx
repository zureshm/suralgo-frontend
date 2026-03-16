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
      <CardContent>
        <div className="flex items-center justify-between py-2">
          {connectionItems.map((item, index) => (
            <div 
              key={index}
              className="flex items-center gap-2"
            >
              <div className="font-medium text-sm">{item.name}</div>
              <div 
                className={`w-3 h-3 rounded-full ${
                  item.connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                }`}
                title={item.connected ? "Connected" : "Disconnected"}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
