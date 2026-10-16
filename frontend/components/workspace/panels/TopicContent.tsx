'use client';

import type { Experiment } from '@/types/workspace';

interface Props {
  experiment: Experiment;
}

export default function TopicContent({ experiment }: Props) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">{experiment.title}</h1>
      <div className="flex gap-2 mb-6">
        <span className="px-2 py-1 bg-blue-50 text-blue-700 text-sm rounded">
          {experiment.category}
        </span>
        <span className="px-2 py-1 bg-[var(--bg-card-hover)] text-[var(--text-secondary)] text-sm rounded">
          {experiment.difficulty}
        </span>
      </div>
      <article className="prose max-w-none text-sm text-[var(--text-secondary)] leading-relaxed">
        {experiment.instructions ? (
          <div dangerouslySetInnerHTML={{ __html: experiment.instructions }} />
        ) : (
          <p>{experiment.description || '暂无题目描述'}</p>
        )}
      </article>
    </div>
  );
}
