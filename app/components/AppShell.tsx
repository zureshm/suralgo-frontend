"use client";

import { useTradeStore } from "../store/TradeStore";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { desktopViewEnabled } = useTradeStore();
  return (
    <div
      className={`flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black${desktopViewEnabled ? " desktop-view" : ""}`}
      style={desktopViewEnabled ? { background: "#000" } : undefined}
    >
      {children}
    </div>
  );
}
