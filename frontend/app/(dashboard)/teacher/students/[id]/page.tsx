'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';

export default function StudentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const user = getUser();
  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
      router.push('/experiments');
      return;
    }
    api.getTeacherStudentDetail(id)
      .then(setStudent)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="text-center py-12 text-[var(--text-tertiary)]">加载中...</div>;
  }

  if (!student) {
    return <div className="text-center py-12 text-[var(--text-tertiary)]">学生不存在</div>;
  }

  return (
    <div>
      <button
        onClick={() => router.push('/teacher')}
        className="mb-6 text-sm text-blue-600 hover:text-blue-800"
      >
        ← 返回仪表盘
      </button>

      <div className="bg-[var(--bg-card)] rounded-lg shadow p-6 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white text-xl font-bold">
            {(student.username?.[0] || '?').toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              {student.full_name || student.username}
            </h1>
            <p className="text-[var(--text-tertiary)]">
              {student.email || '-'} · {student.username}
            </p>
          </div>
          <div className="ml-auto flex gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{student.total_submissions || 0}</div>
              <div className="text-[var(--text-tertiary)]">提交次数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {student.avg_score ? student.avg_score.toFixed(1) + '%' : '-'}
              </div>
              <div className="text-[var(--text-tertiary)]">平均分</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {student.best_score ? student.best_score.toFixed(1) + '%' : '-'}
              </div>
              <div className="text-[var(--text-tertiary)]">最高分</div>
            </div>
          </div>
        </div>
      </div>

      {(Array.isArray(student.progress) && student.progress.length > 0) && (
        <div className="bg-[var(--bg-card)] rounded-lg shadow overflow-hidden">
          <h2 className="text-lg font-semibold p-6 pb-4">实验进度</h2>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-[var(--bg-card-hover)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase">实验</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase">类型</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase">提交次数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase">最高分</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase">最后提交</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {student.progress || [].map((exp: any) => (
                <tr key={exp.experiment || exp.experiment_id} className="hover:bg-[var(--bg-card-hover)]">
                  <td className="px-4 py-3 text-sm font-medium">{exp.experiment || exp.title}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">{exp.experiment || '-'}</td>
                  <td className="px-4 py-3 text-sm">{exp.submission_count}</td>
                  <td className="px-4 py-3 text-sm font-medium">
                    {exp.best_score != null ? exp.best_score.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-tertiary)]">
                    {exp.last_submission_at
                      ? new Date(exp.last_submission_at).toLocaleString('zh-CN')
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      exp.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : exp.status === 'in_progress'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-[var(--bg-card-hover)] text-[var(--text-secondary)]'
                    }`}>
                      {exp.status === 'completed' ? '已完成' : exp.status === 'in_progress' ? '进行中' : '未开始'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {student.weak_concepts && student.weak_concepts.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-lg shadow p-6 mt-6">
          <h2 className="text-lg font-semibold mb-3">⚠️ 薄弱概念</h2>
          <div className="flex flex-wrap gap-2">
            {student.weak_concepts.map((wc: any, i: number) => (
              <span
                key={i}
                className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm"
              >
                {wc.concept || wc.error_type} ({wc.count}次)
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
