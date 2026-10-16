import { NextResponse } from "next/server";

// Proxy host-level metrics from the host metrics server (port 8766)
// accessible from inside Docker via the gateway IP.
const METRICS_SERVER = process.env.HOST_METRICS_URL || "http://127.0.0.1:8766/metrics";

export async function GET() {
  try {
    const res = await fetch(METRICS_SERVER, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream error" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "metrics server unreachable" }, { status: 503 });
  }
}
