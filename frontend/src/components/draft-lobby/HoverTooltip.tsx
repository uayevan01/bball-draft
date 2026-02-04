"use client";

import type { ReactNode } from "react";

export function HoverTooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`group relative ${className ?? ""}`}>
      <div className="pointer-events-none absolute -top-2 left-1/2 z-20 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-zinc-950 px-2 py-1 text-[11px] font-semibold text-white shadow-md group-hover:block dark:bg-white dark:text-black">
        {label}
      </div>
      {children}
    </div>
  );
}


