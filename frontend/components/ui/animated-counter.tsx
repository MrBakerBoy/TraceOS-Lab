"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useSpring, useTransform, animate } from "framer-motion";
import { cn } from "@/lib/utils";

// ── Types ──

export interface AnimatedCounterProps {
  /** Target numeric value */
  value: number;
  /** Optional prefix (e.g. "$", "↑") */
  prefix?: string;
  /** Optional suffix (e.g. "%", "ms", " ops/s") */
  suffix?: string;
  /** Number of decimal places */
  decimals?: number;
  /** Animation duration in seconds */
  duration?: number;
  /** Font size/weight styling */
  className?: string;
  /** Show + sign for positive values */
  showSign?: boolean;
  /** Whether to animate on mount */
  animate?: boolean;
}

// ── Component ──

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.2,
  className,
  showSign = false,
  animate: shouldAnimate = true,
}) => {
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Spring-based animation
  const spring = useSpring(0, {
    stiffness: 80,
    damping: 20,
    duration: duration * 1000,
  });

  // Only animate on first entry into viewport, then snap
  const startAnimation = useCallback(() => {
    if (shouldAnimate) {
      spring.set(value);
      setHasAnimated(true);
    }
  }, [spring, value, shouldAnimate]);

  useEffect(() => {
    if (hasAnimated) {
      // Subsequent updates: faster spring
      spring.set(value);
    }
  }, [value, spring, hasAnimated]);

  // IntersectionObserver to trigger on-scroll
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          startAnimation();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnimated, startAnimation]);

  // Immediate render if no animation
  if (!shouldAnimate) {
    const formatted = formatValue(value, decimals);
    return (
      <span className={cn("font-mono tabular-nums", className)}>
        {showSign && value > 0 ? "+" : ""}
        {prefix}
        {formatted}
        {suffix}
      </span>
    );
  }

  return (
    <motion.span
      ref={ref}
      className={cn("font-mono tabular-nums inline-block", className)}
    >
      {showSign && value > 0 && "+"}
      {prefix}
      <CounterDigits spring={spring} decimals={decimals} />
      {suffix}
    </motion.span>
  );
};

// ── Internal: CounterDigits renders a spring-driven number ──

function CounterDigits({
  spring,
  decimals,
}: {
  spring: ReturnType<typeof useSpring>;
  decimals: number;
}) {
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const unsubscribe = spring.on("change", (v) => {
      setDisplay(formatValue(v, decimals));
    });
    return unsubscribe;
  }, [spring, decimals]);

  return <>{display}</>;
}

// ── Helpers ──

function formatValue(v: number, decimals: number): string {
  if (decimals > 0) {
    return v.toFixed(decimals);
  }
  return Math.round(v).toLocaleString();
}

// ── Compact Stat Change: small up/down indicator + delta ──

export interface StatChangeProps {
  /** Percentage or absolute delta */
  delta: number;
  /** "up" = green arrow, "down" = red arrow */
  direction?: "up" | "down";
  /** Label text (e.g. "vs last run") */
  label?: string;
  className?: string;
}

export const StatChange: React.FC<StatChangeProps> = ({
  delta,
  direction,
  label,
  className,
}) => {
  const dir = direction || (delta >= 0 ? "up" : "down");
  const isUp = dir === "up";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isUp ? "text-[var(--kt-green)]" : "text-[var(--kt-red)]",
        className,
      )}
    >
      <motion.span
        initial={{ y: isUp ? 4 : -4, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        {isUp ? "↑" : "↓"}
      </motion.span>
      <span className="tabular-nums">{Math.abs(delta).toFixed(1)}%</span>
      {label && (
        <span className="text-[var(--kt-text-tertiary)] font-normal ml-1">
          {label}
        </span>
      )}
    </span>
  );
};
