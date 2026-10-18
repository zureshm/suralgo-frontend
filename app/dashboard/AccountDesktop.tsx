"use client";

import { Suspense } from "react";
import { UserCircle } from "lucide-react";
import BrokerLoginCard from "./BrokerLoginCard";

export default function AccountDesktop() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ padding: 16, color: "var(--theme-popup-text)" }}>
      <div className="flex items-center gap-2 mb-6">
        <UserCircle size={24} style={{ color: "var(--theme-popup-border)" }} />
        <h2 className="text-xl font-bold">Account</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-6" style={{ scrollbarWidth: "thin" }}>
        <Suspense fallback={<div>Loading...</div>}>
          <BrokerLoginCard desktop />
        </Suspense>
      </div>
    </div>
  );
}
