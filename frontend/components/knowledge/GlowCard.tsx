"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: "blue" | "purple" | "teal" | "rainbow";
  onClick?: () => void;
}

export function GlowCard({ children, className, hover = true, glow = "rainbow", onClick }: GlowCardProps) {
  const glowColors = {
    blue: "before:from-[#0A84FF] before:via-[#0A84FF] before:to-[#0A84FF]",
    purple: "before:from-[#8B5CF6] before:via-[#A78BFA] before:to-[#8B5CF6]",
    teal: "before:from-[#14B8A6] before:via-[#5EEAD4] before:to-[#14B8A6]",
    rainbow: "before:from-[#0A84FF] before:via-[#BF5AF2] before:to-[#30D158]",
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl",
        "transition-all duration-500",
        hover && "hover:border-white/[0.12] hover:bg-white/[0.05] hover:shadow-[0_8px_32px_rgba(10,132,255,0.12)] hover:-translate-y-0.5",
        onClick && "cursor-pointer",
        // Animated gradient border on hover
        "before:absolute before:inset-[-1px] before:rounded-2xl before:p-[1px] before:bg-gradient-to-r before:bg-[length:200%_200%]",
        glowColors[glow],
        "before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-500",
        "before:animate-gradient before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[-webkit-mask-composite:xor] before:[mask-composite:exclude]",
        "after:absolute after:inset-0 after:rounded-2xl after:bg-[radial-gradient(600px_circle_at_50%_0%,rgba(10,132,255,0.06),transparent_70%)] after:opacity-0 hover:after:opacity-100 after:transition-opacity after:duration-700",
        className
      )}
    >
      <div className="relative z-10">{children}</div>
    </div>
  );
}
