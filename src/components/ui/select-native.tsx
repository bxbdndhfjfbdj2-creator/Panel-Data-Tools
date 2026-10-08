import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function SelectNative({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-md bg-surface px-3 text-sm text-fg shadow-border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35",
        className,
      )}
      suppressHydrationWarning
      {...props}
    >
      {children}
    </select>
  );
}
