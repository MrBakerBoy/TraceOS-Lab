"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { ToastContainer } from "@/components/ui/Toast";
import { Loader2 } from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) { router.push("/login"); }
    else { setUser(u); }
  }, [router]);

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary via-purple-500 to-teal-500 flex items-center justify-center shadow-lg animate-pulse">
            <Loader2 className="size-6 text-white animate-spin" />
          </div>
          <span className="text-muted-foreground text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[30%] -right-[10%] w-[700px] h-[700px] rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, var(--accent-purple), transparent 70%)" }} />
        <div className="absolute -bottom-[20%] -left-[5%] w-[500px] h-[500px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, var(--accent-teal), transparent 70%)" }} />
        <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }} />
      </div>
      <Sidebar />
      <main className="relative flex-1 flex flex-col overflow-y-auto">{children}</main>
      <ToastContainer />
    </div>
  );
}
