"use client";

interface ScoreRingProps {
  score: number;
  totalScore: number;
  coreScore?: number;
  edgeScore?: number;
  isQualified?: boolean;
}

export default function ScoreRing({
  score,
  totalScore,
  coreScore,
  edgeScore,
  isQualified,
}: ScoreRingProps) {
  const safeTotal = totalScore > 0 ? totalScore : 100;
  const pct = totalScore > 0 ? Math.round((score / totalScore) * 100) : 0;
  const stroke = isQualified
    ? "var(--success)"
    : score > 0
      ? "var(--warning)"
      : "var(--error)";

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex items-center gap-6">
      <div className="relative size-28 shrink-0">
        <svg
          className="size-28 -rotate-90"
          viewBox="0 0 100 100"
          role="img"
          aria-label={`得分 ${score} 分，满分 ${safeTotal} 分，百分比 ${pct}%`}
        >
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--bg-elevated)"
            strokeWidth="8"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none text-app-text">
            {score}
          </span>
          <span className="mt-0.5 text-[11px] text-app-text-3">
            / {safeTotal}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-app-success" />
          <span className="text-app-text-2">核心分</span>
          <span className="font-semibold text-app-text">{coreScore ?? 0}</span>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-app-accent" />
          <span className="text-app-text-2">附加分</span>
          <span className="font-semibold text-app-text">{edgeScore ?? 0}</span>
        </div>
        {isQualified !== undefined && (
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${isQualified ? "bg-app-success" : "bg-app-error"}`}
            />
            <span className="text-app-text-2">
              {isQualified ? "已达标" : "未达标"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}