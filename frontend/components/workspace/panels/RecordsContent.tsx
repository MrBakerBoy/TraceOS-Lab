'use client';

import { useWorkspaceStore } from '@/stores/workspace';
import type { Submission } from '@/types/workspace';

interface Props {
  submissions: Submission[];
}

export default function RecordsContent({ submissions }: Props) {
  const { selectSubmission } = useWorkspaceStore();

  const statusColor = (status: string) => {
    if (status === 'completed') return 'bg-green-100 text-green-800';
    if (status === 'failed') return 'bg-red-100 text-red-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  if ((submissions || []).length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
        暂无提交记录
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold mb-2">提交记录</h2>
      {submissions.map((sub) => (
        <div
          key={sub.id}
          onClick={() => selectSubmission(sub.id)}
          className="p-4 bg-[var(--bg-card)] border rounded-lg cursor-pointer hover:border-[var(--accent)] transition"
        >
          <div className="flex justify-between items-center mb-2">
            <span className="font-medium">提交 #{sub.submission_number}</span>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor(
                sub.status,
              )}`}
            >
              {sub.status}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm text-[var(--text-tertiary)]">
            <div>
              得分: <strong>{sub.score ?? '-'}/{(sub.total_score !== null && sub.total_score !== undefined) ? sub.total_score : "-"}</strong>
            </div>
            <div>
              通过: {sub.passed_test_cases}/{sub.total_test_cases}
            </div>
            <div>{new Date(sub.created_at).toLocaleString('zh-CN')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
