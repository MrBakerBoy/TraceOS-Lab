"use client";

import {
  Flag,
  Trophy,
  Target,
  Flame,
  Rocket,
  Hammer,
  Medal,
  Crown,
  Star,
  Shield,
  Sparkles,
  Mountain,
  Compass,
  Globe,
  Code,
  FlaskConical,
  Beaker,
  Lock,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  flag: Flag,
  trophy: Trophy,
  target: Target,
  flame: Flame,
  rocket: Rocket,
  hammer: Hammer,
  medal: Medal,
  crown: Crown,
  star: Star,
  shield: Shield,
  sparkles: Sparkles,
  mountain: Mountain,
  compass: Compass,
  globe: Globe,
  code: Code,
  flask: FlaskConical,
  beaker: Beaker,
  lock: Lock,
};

export function AchievementIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Trophy;
  return <Icon className={className} strokeWidth={1.5} />;
}
