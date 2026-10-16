'use client';

import type { Experiment } from '@/types/workspace';

interface Props {
  experiment: Experiment;
  canView: boolean;
}

export default function AnswerContent({ experiment, canView }: Props) {
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] p-6">
        <div className="text-4xl mb-4">🔒</div>
        <h3 className="text-lg font-semibold mb-2 text-[var(--text-secondary)]">参考答案暂未开放</h3>
        <p className="text-sm text-center">
          请先提交代码并通过验证后查看参考答案
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">参考答案</h2>
      {experiment.answer_explanation && (
        <div className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
          {experiment.answer_explanation}
        </div>
      )}
      {experiment.reference_solution && (
        <pre className="bg-[var(--editor-bg)] text-[var(--editor-fg)] p-4 rounded-lg text-sm overflow-x-auto">
          {experiment.reference_solution}
        </pre>
      )}
    </div>
  );
}
