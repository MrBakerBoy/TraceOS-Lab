'use client';

import type { Experiment, TestCase } from '@/types/workspace';

interface Props {
  experiment: Experiment;
  testCases: TestCase[];
}

export default function RequirementsContent({ experiment, testCases }: Props) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">实验要求</h2>
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
        {experiment.description || '暂无要求说明'}
      </div>

      {(testCases || []).length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">测试用例</h3>
          <ul className="space-y-2">
            {testCases.map((tc) => (
              <li
                key={tc.id}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
              >
                <span>• {tc.name}</span>
                {tc.is_public && (
                  <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                    公开
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
