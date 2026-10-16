import React from "react";

interface SettingsLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  title: string;
  description?: string;
}

export function SettingsLayout({
  children,
  sidebar,
  title,
  description,
}: SettingsLayoutProps) {
  return (
    <div className="flex gap-0 min-h-full">
      <aside className="w-[200px] flex-shrink-0 border-r border-[var(--border-default)] p-4">
        {sidebar}
      </aside>
      <main className="flex-1 p-[var(--space-page)]">
        <h1 className="text-[28px] font-bold tracking-[-0.018em] font-[var(--font-display)] text-[var(--text-primary)] mb-1">
          {title}
        </h1>
        {description && (
          <p className="text-[15px] text-[var(--text-secondary)] mb-8">
            {description}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
