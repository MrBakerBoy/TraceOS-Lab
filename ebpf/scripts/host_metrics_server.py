#!/usr/bin/env python3
"""
Host-level resource metrics HTTP server.
Provides real-time CPU / memory / disk / network metrics via HTTP,
polled by the frontend ResourceMonitorCard.

Usage:
  nohup python3 ebpf/scripts/host_metrics_server.py --port 8766 &
"""
import http.server
import json
import time
import psutil
import argparse

class MetricsHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._respond({"status": "healthy", "service": "host-metrics-server"})
            return
        if self.path == "/metrics":
            self._respond(self._collect())
            return
        self.send_error(404)

    def _collect(self):
        cpu = psutil.cpu_percent(interval=0.3)
        mem = psutil.virtual_memory()
        disk = psutil.disk_io_counters()
        net = psutil.net_io_counters()
        return {
            "timestamp": int(time.time() * 1000),
            "cpu_percent": round(cpu, 1),
            "memory_percent": round(mem.percent, 1),
            "memory_used_gb": round(mem.used / (1024**3), 2),
            "memory_total_gb": round(mem.total / (1024**3), 2),
            "disk_read_bytes": disk.read_bytes if disk else 0,
            "disk_write_bytes": disk.write_bytes if disk else 0,
            "disk_iops": (disk.read_count + disk.write_count) if disk else 0,
            "network_rx_bytes": net.bytes_recv if net else 0,
            "network_tx_bytes": net.bytes_sent if net else 0,
            "ctx_switches_per_sec": getattr(psutil, "cpu_stats", lambda: type("x",(),{"ctx_switches":0})())().ctx_switches if hasattr(psutil, "cpu_stats") else 0,
            "page_faults_per_sec": 0,
        }

    def _respond(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8766)
    args = p.parse_args()
    srv = http.server.HTTPServer(("0.0.0.0", args.port), MetricsHandler)
    print(f"Host metrics server listening on :{args.port}")
    srv.serve_forever()
