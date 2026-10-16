// Observability API helper — used as fallback when core-service endpoints
// return empty results.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export interface ObsTrace {
  time: string;
  pid: number;
  tid?: number;
  syscall_name: string;
  syscall_number?: number;
  args?: Record<string, unknown>;
  return_value: number;
  error_code?: number;
  error_name?: string;
  duration_ns: number;
  cpu_id?: number;
  source_line?: number;
}

export interface ObsTraceSummary {
  total_count: number;
  error_count: number;
  unique_syscalls: number;
  execution_time_ns: number;
  syscall_counts: Record<string, number>;
}

export interface ObsTracesResponse {
  submission_id: string;
  summary: ObsTraceSummary;
  traces: ObsTrace[];
}

export const obsApi = {
  getTraces: async (submissionId: string, limit?: number): Promise<ObsTracesResponse> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const url = `${API_BASE}/api/obs/traces/${submissionId}${limit ? `?limit=${limit}` : ''}`;
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`Observability traces failed: ${res.status}`);
    return res.json();
  },
};
