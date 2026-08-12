"use client";

import React from "react";

export default function QuotaBar({ used, allowed }: { used: number; allowed: number }) {
  const pct = allowed > 0 ? Math.min(100, Math.round((used / allowed) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="w-full max-w-xs">
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>Usage this period</span>
        <span>
          {used} / {allowed}
        </span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}