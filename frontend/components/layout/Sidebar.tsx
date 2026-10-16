"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSidebarStore } from "@/stores/sidebar";
import { getUser, removeAuthToken } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  BookOpen, FileText, BarChart3, Users, LayoutDashboard, Settings, GraduationCap,
  LogOut, ChevronLeft, Shield, ScrollText, Upload, Search, CheckCircle, Code2,
  Sparkles, Terminal
} from "lucide-react";

interface NavItem { href: string; label: string; matchPrefix?: boolean; icon: React.ReactNode; badge?: string; }

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggleCollapsed } = useSidebarStore();
  const user = getUser();
  const isTeacherOrAdmin = user?.role === "teacher" || user?.role === "admin";

  const handleLogout = () => { removeAuthToken(); router.push("/login"); };
  const isActive = (href: string, mp = false) => mp ? pathname.startsWith(href) : pathname === href;

  const mainNav: NavItem[] = [
    { href: "/experiments", label: "实验列表", matchPrefix: true, icon: BookOpen },
    { href: "/submissions", label: "提交历史", icon: FileText },
    { href: "/progress", label: "学习进度", icon: BarChart3 },
    ...(isTeacherOrAdmin
      ? [{ href: "/teacher/courses", label: "班级管理", matchPrefix: true, icon: Users } as NavItem]
      : [{ href: "/student/courses", label: "我的班级", icon: GraduationCap } as NavItem]),
    ...(isTeacherOrAdmin ? [{ href: "/teacher", label: "教师仪表盘", icon: LayoutDashboard } as NavItem] : []),
    ...(isTeacherOrAdmin ? [{ href: "/teacher/experiments", label: "实验管理", icon: Settings } as NavItem] : []),
    ...(user?.role === "admin" ? [
      { href: "/admin", label: "系统管理", icon: Shield } as NavItem,
      { href: "/admin/logs", label: "审计日志", icon: ScrollText } as NavItem,
    ] : []),
  ];

  const ragNav: NavItem[] = [
    { href: "/knowledge", label: "知识库上传", icon: Upload },
    { href: "/rag", label: "RAG 检索", icon: Search },
    ...(isTeacherOrAdmin ? [{ href: "/teacher/knowledge-review", label: "知识审核", icon: CheckCircle } as NavItem] : []),
  ];

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href, item.matchPrefix);
    const Icon = item.icon;
    return (
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href={item.href}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-2.5 text-[13px] rounded-xl mx-2 transition-all duration-200",
                active
                  ? "text-primary font-semibold bg-gradient-to-r from-primary/8 to-primary/4"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full" style={{ background: "linear-gradient(to bottom, var(--primary), var(--kt-purple), var(--kt-teal))" }} />
              )}
              <Icon className={cn(
                "size-[18px] flex-shrink-0 transition-all duration-200",
                active ? "opacity-100 drop-shadow-sm" : "opacity-55 group-hover:opacity-85"
              )} strokeWidth={active ? 2.2 : 1.8} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && item.badge && (
                <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 h-4">{item.badge}</Badge>
              )}
            </Link>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right" className="text-xs font-medium">{item.label}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <aside className={cn(
      "relative flex flex-col flex-shrink-0 border-r border-border/50 transition-all duration-300 ease-in-out",
      collapsed ? "w-[64px]" : "w-[240px]"
    )}
    style={{
      background: "linear-gradient(180deg, var(--sidebar) 0%, var(--bg-sidebar) 100%)",
      backdropFilter: "blur(24px) saturate(180%)",
      WebkitBackdropFilter: "blur(24px) saturate(180%)",
    }}>
      {/* Kernel scan line at top */}
      <div className="absolute top-0 left-0 right-0 h-[2px] opacity-70" style={{ background: "linear-gradient(to right, var(--primary), var(--kt-purple), var(--kt-teal))" }} />

      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border/30">
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-primary/25" style={{ background: "linear-gradient(to bottom right, var(--kt-cyan), var(--kt-purple), var(--kt-green))" }}>
            <Code2 className="size-[18px] text-white" strokeWidth={2} />
          </div>
          <div className="absolute -inset-0.5 rounded-xl blur-sm -z-10" style={{ background: "linear-gradient(to bottom right, var(--primary), var(--kt-purple))", opacity: 0.20 }} />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-bold tracking-tight flex items-center gap-1">
              TraceOS <span className="text-transparent" style={{ backgroundImage: "linear-gradient(to right, var(--primary), var(--kt-purple), var(--kt-teal))", backgroundClip: "text", WebkitBackgroundClip: "text" }}>Lab</span>
              <Sparkles className="size-3 text-primary/60" />
            </h1>
            {user && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] text-muted-foreground truncate">{user.username}</span>
                {isTeacherOrAdmin && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{user.role === "admin" ? "管理员" : "教师"}</Badge>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 scrollbar-thin">
        {mainNav.map((item) => (<NavLink key={item.href} item={item} />))}

        {/* RAG Section */}
        <div className="mt-4 mb-1 mx-2">
          <div className="border-t border-border/40 pt-3 pb-1.5">
            {!collapsed && (
              <span className="px-2 text-[11px] text-foreground/70 uppercase tracking-[0.12em] font-semibold flex items-center gap-1.5">
                <Terminal className="size-3" /> 知识库
              </span>
            )}
          </div>
        </div>
        {ragNav.map((item) => (<NavLink key={item.href} item={item} />))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/30 p-2">
        <Link href="/settings"
          className={cn(
            "group relative flex items-center gap-3 px-3 py-2.5 text-[13px] rounded-xl mx-1 transition-all duration-200",
            isActive("/settings") ? "text-primary font-semibold bg-gradient-to-r from-primary/8 to-primary/4" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}>
          {isActive("/settings") && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full" style={{ background: "linear-gradient(to bottom, var(--primary), var(--kt-purple), var(--kt-teal))" }} />}
          <Settings className="size-[18px] flex-shrink-0 opacity-55 group-hover:opacity-85 transition-opacity" strokeWidth={1.8} />
          {!collapsed && <span>设置</span>}
        </Link>
        <button onClick={handleLogout}
          className="group relative flex items-center gap-3 px-3 py-2.5 text-[13px] rounded-xl mx-1 text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all duration-200 w-full text-left mt-0.5">
          <LogOut className="size-[18px] flex-shrink-0 opacity-55 group-hover:opacity-100 transition-opacity" strokeWidth={1.8} />
          {!collapsed && <span>退出登录</span>}
        </button>
      </div>

      {/* Collapse */}
      <div className="border-t border-border/30 p-2 flex justify-center">
        <Button variant="ghost" size="icon" onClick={toggleCollapsed}
          className="size-8 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-all">
          <ChevronLeft className={cn("size-4 transition-transform duration-300", collapsed && "rotate-180")} />
        </Button>
      </div>
    </aside>
  );
}
