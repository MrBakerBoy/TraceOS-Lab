'use client';

import type { Submission } from '@/types/workspace';
import { useWorkspaceStore } from '@/stores/workspace';
import TestPointItem from '../evaluation/TestPointItem';

interface Props {
  submission: Submission;
}

export default function SubmissionDetail({ submission }: Props) {
  const { setActiveTab } = useWorkspaceStore();
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">
        提交 #{submission.submission_number} 详情
      </h2>

      <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
        <div>
          <div className="text-[var(--text-tertiary)]">状态</div>
          <div className="font-semibold">
            {submission.status === 'completed' ? '✅ 完成' : submission.status}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-tertiary)]">得分</div>
          <div className="font-semibold">
            {submission.score ?? '-'} / {(submission.total_score !== null && submission.total_score !== undefined) ? submission.total_score : "-"}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-tertiary)]">通过</div>
          <div className="font-semibold">
            {submission.passed_test_cases}/{submission.total_test_cases}
          </div>
        </div>
        <div>
          <div className="text-[var(--text-tertiary)]">耗时</div>
          <div className="font-semibold">
            {submission.execution_time ? `${submission.execution_time}ms` : '-'}
          </div>
        </div>
      </div>

      {submission.test_points && submission.test_points.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold text-sm mb-2">测试点明细</h3>
          <div className="rounded-lg border border-[var(--border-default)]">
            {submission.test_points.map((tp, i) => (
              <TestPointItem key={tp.id ?? i} point={tp} index={i} />
            ))}
          </div>
        </div>
      )}

      {submission.status === 'completed' && (
        <div className="mb-4">
          <button
            onClick={() => setActiveTab(`flamegraph-${submission.id}` as any)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-medium rounded-lg hover:from-orange-600 hover:to-red-600 transition-all shadow-sm"
          >
            <span>🔥</span>
            <span>性能火焰图分析</span>
            <span className="text-xs opacity-80">→</span>
         </button>
       </div>
      )}

      {submission.compile_error && (
        <div className="p-3 bg-red-50 rounded mb-4">
          <div className="font-semibold text-red-800 text-sm">编译错误</div>
          <pre className="mt-2 text-red-700 text-xs whitespace-pre-wrap">
            {submission.compile_error}
          </pre>
       </div>
      )}

      {submission.runtime_error && (
        <div className="p-3 bg-red-50 rounded mb-4">
          <div className="font-semibold text-red-800 text-sm">运行时错误</div>
          <pre className="mt-2 text-red-700 text-xs whitespace-pre-wrap">
            {submission.runtime_error}
          </pre>
        </div>
      )}

      {submission.code && (
        <div>
          <h3 className="font-semibold text-sm mb-2">提交的代码</h3>
          <pre className="bg-[var(--editor-bg)] text-[var(--editor-fg)] p-4 rounded-lg text-xs overflow-x-auto max-h-96">
            {submission.code}
          </pre>
        </div>
      )}
    </div>
  );
}
