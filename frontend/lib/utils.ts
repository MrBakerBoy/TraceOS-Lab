import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Resolve a CSS custom property at runtime; returns fallback when SSR or unset. */
export function cssVar(name: string, fallback?: string): string {
  if (typeof document === "undefined") return fallback ?? "";
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback || "";
}
