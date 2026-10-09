import { useState, useCallback, useRef, useEffect } from "react";

// Shared state in memory
let sharedAiSettings = {
  enabled: false,
  entryGuardEnabled: false,
  autoExitEnabled: false,
  candlesCount: 120,
  recentCandlesCount: 30,
  entryBufferMaxCandles: 1,
  exitBufferCandles: 3,
  considerVolume: false,
  useHeikinAshi: true,
  provider: "local",
  model: "openai/gpt-oss-120b",
  apiKey: "",
};

// Subscribers to changes
const subscribers = new Set<() => void>();

export function useSharedAiSettings() {
  const [settings, setSettings] = useState(sharedAiSettings);
  const subscriberRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Create subscriber function
    const subscriber = () => {
      setSettings({ ...sharedAiSettings });
    };

    subscriberRef.current = subscriber;
    subscribers.add(subscriber);

    return () => {
      if (subscriberRef.current) {
        subscribers.delete(subscriberRef.current);
      }
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<typeof sharedAiSettings>) => {
    sharedAiSettings = { ...sharedAiSettings, ...updates };
    // Notify all subscribers
    subscribers.forEach((subscriber) => subscriber());
  }, []);

  return { settings, updateSettings };
}
