"use client";

import React from "react";

interface GlassColorWellProps {
  label: string;
  description?: string;
  cyanValue: string;
  purpleValue: string;
  onCyanChange: (color: string) => void;
  onPurpleChange: (color: string) => void;
}

const PRESET_PAIRS: { cyan: string; purple: string; label: string }[] = [
  { cyan: "#00D4FF", purple: "#BF5AF2", label: "终端霓虹" },
  { cyan: "#64D2FF", purple: "#FF6482", label: "极光拂晓" },
  { cyan: "#30D158", purple: "#0A84FF", label: "矩阵翠绿" },
  { cyan: "#FF9F0A", purple: "#FF453A", label: "烈焰琥珀" },
  { cyan: "#5E5CE6", purple: "#FF375F", label: "暮光紫调" },
  { cyan: "#00F5FF", purple: "#7B61FF", label: "冰河星云" },
];

export function GlassColorWell({
  label,
  description,
  cyanValue,
  purpleValue,
  onCyanChange,
  onPurpleChange,
}: GlassColorWellProps) {
  return (
    <div className="flex flex-col gap-3 py-1">
      <div>
        <span className="text-[13px] font-medium text-[var(--kt-text)]">
          {label}
        </span>
        {description && (
          <p className="text-[11px] text-[var(--kt-text-tertiary)] mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {/* Gradient preview strip */}
      <div
        className="h-3 rounded-full"
        style={{
          background: `linear-gradient(to right, ${cyanValue}, ${purpleValue})`,
          boxShadow: `0 0 12px ${cyanValue}44, 0 0 12px ${purpleValue}44`,
        }}
      />

      {/* Individual color inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="color"
              value={cyanValue}
              onChange={(e) => onCyanChange(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div
              className="w-8 h-8 rounded-lg border-2 border-[var(--kt-border)] cursor-pointer transition-transform hover:scale-110"
              style={{ background: cyanValue }}
            />
          </div>
          <div>
            <span className="text-[10px] text-[var(--kt-text-tertiary)]">青色</span>
            <p className="text-[11px] font-mono text-[var(--kt-cyan)]">{cyanValue}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="color"
              value={purpleValue}
              onChange={(e) => onPurpleChange(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div
              className="w-8 h-8 rounded-lg border-2 border-[var(--kt-border)] cursor-pointer transition-transform hover:scale-110"
              style={{ background: purpleValue }}
            />
          </div>
          <div>
            <span className="text-[10px] text-[var(--kt-text-tertiary)]">紫色</span>
            <p className="text-[11px] font-mono text-[var(--kt-purple)]">{purpleValue}</p>
          </div>
        </div>
      </div>

      {/* Preset pairs */}
      <div>
        <p className="text-[10px] text-[var(--kt-text-tertiary)] mb-2 uppercase tracking-wider">
          预设配色
        </p>
        <div className="grid grid-cols-6 gap-2">
          {PRESET_PAIRS.map((pair) => (
            <button
              key={pair.label}
              onClick={() => {
                onCyanChange(pair.cyan);
                onPurpleChange(pair.purple);
              }}
              className="group relative flex flex-col items-center gap-1"
              title={pair.label}
            >
              <div
                className="w-8 h-8 rounded-lg border-2 transition-all duration-200 hover:scale-110"
                style={{
                  background: `linear-gradient(135deg, ${pair.cyan}, ${pair.purple})`,
                  borderColor:
                    cyanValue === pair.cyan && purpleValue === pair.purple
                      ? "var(--kt-cyan)"
                      : "var(--kt-border)",
                  boxShadow:
                    cyanValue === pair.cyan && purpleValue === pair.purple
                      ? `0 0 10px ${pair.cyan}44`
                      : "none",
                }}
              />
              <span className="text-[9px] text-[var(--kt-text-tertiary)] group-hover:text-[var(--kt-text-secondary)] transition-colors text-center leading-tight">
                {pair.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
