"use client";

import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import { getUser } from "@/lib/auth";
import { api } from "@/lib/api";

export default function CommentPanel() {
  const { experiment, comments, loadComments } = useWorkspaceStore();
  const user = getUser();
  const isTeacherOrAdmin = user?.role === "teacher" || user?.role === "admin";

  const [commentInput, setCommentInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editInput, setEditInput] = useState("");

  const doSubmit = async (parentId?: string) => {
    const content = parentId ? replyInput : commentInput;
    if (!content.trim() || !experiment) return;
    setSubmitting(true);
    setError("");
    try {
      await api.createComment(experiment.id, content.trim(), parentId || undefined);
      if (parentId) { setReplyInput(""); setReplyingTo(null); }
      else { setCommentInput(""); }
      loadComments();
    } catch (err: any) {
      setError(err.message || "评论失败");
    } finally { setSubmitting(false); }
  };

  const doEdit = async (id: string) => {
    try {
      await api.updateComment(id, editInput.trim());
      setEditingId(null); setEditInput("");
      loadComments();
    } catch (err: any) { setError(err.message || "编辑失败"); }
  };

  const doDelete = async (id: string) => {
    if (!confirm("确定删除该评论？")) return;
    try { await api.deleteComment(id); loadComments(); }
    catch (err: any) { setError(err.message || "删除失败"); }
  };

  const doPin = async (id: string) => {
    try { await api.togglePinComment(id); loadComments(); }
    catch (err: any) { setError(err.message || "操作失败"); }
  };

  const canEdit = (c: any) => user && (user.id === c.user_id || isTeacherOrAdmin);
  const canDelete = (c: any) => user && (user.id === c.user_id || isTeacherOrAdmin);

  const sorted = [...(comments || [])].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return 0;
  });
  const topLevel = sorted.filter((c: any) => !c.parent_id);
  const replies = (pid: string) => sorted.filter((c: any) => c.parent_id === pid);

  if (comments.length === 0) {
    return (
      <div className="p-3 flex flex-col h-full">
        <p className="text-[var(--text-tertiary)] text-[13px]">暂无评论</p>
        <div className="flex-shrink-0 mt-2 pt-2 border-t border-[var(--border-default)]">
          <textarea value={commentInput} onChange={function(e){ setCommentInput(e.target.value); }} placeholder="write..." className="w-full text-[12px] p-2 border border-[var(--border-default)] rounded resize-none bg-[var(--bg-input)] text-[var(--text-primary)]" rows={2} />
          <button onClick={function(){ doSubmit(); }} disabled={submitting || !commentInput.trim()} className="mt-1.5 px-4 py-1.5 bg-[var(--accent)] text-white text-[12px] rounded hover:opacity-90 disabled:opacity-50">
            {submitting ? "..." : "send"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-2">
          {topLevel.map(function(c: any){
            return (
              <div key={c.id}>
                <div className={"p-2.5 border border-[var(--border-default)] rounded " + (c.is_pinned ? "bg-[var(--accent)]/5 border-[var(--accent)]/20" : "bg-[var(--bg-card)]")}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[12px] font-medium text-[var(--text-primary)]">{c.user?.full_name || c.user?.username || "用户"}</span>
                    {c.is_ai && <span className="text-[10px] bg-purple-500/10 text-purple-500 px-1 rounded">AI</span>}
                    {c.is_pinned && <span className="text-[10px] text-[var(--accent)]">📌 置顶</span>}
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{new Date(c.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  {editingId === c.id ? (
                    <div>
                      <textarea value={editInput} onChange={function(e){ setEditInput(e.target.value); }} className="w-full text-[12px] p-2 border border-[var(--border-default)] rounded resize-none bg-[var(--bg-input)] text-[var(--text-primary)]" rows={2} />
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={function(){ doEdit(c.id); }} className="text-[11px] px-2 py-0.5 bg-[var(--accent)] text-white rounded">保存</button>
                        <button onClick={function(){ setEditingId(null); }} className="text-[11px] px-2 py-0.5 bg-[var(--bg-input)] text-[var(--text-secondary)] rounded">取消</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap">{c.content}</p>
                  )}
                  {editingId !== c.id && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <button onClick={function(){ setReplyingTo(replyingTo === c.id ? null : c.id); setReplyInput(""); }} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]">回复</button>
                      {canEdit(c) && <button onClick={function(){ setEditingId(c.id); setEditInput(c.content); }} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]">编辑</button>}
                      {isTeacherOrAdmin && <button onClick={function(){ doPin(c.id); }} className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--accent)]">{c.is_pinned ? "unpin" : "pin"}</button>}
                      {canDelete(c) && <button onClick={function(){ doDelete(c.id); }} className="text-[10px] text-red-400 hover:text-red-500">删除</button>}
                    </div>
                  )}
                  {replyingTo === c.id && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-default)]">
                      <textarea value={replyInput} onChange={function(e){ setReplyInput(e.target.value); }} placeholder={"回复 " + (c.user?.full_name || c.user?.username || "用户")} className="w-full text-[11px] p-2 border border-[var(--border-default)] rounded resize-none bg-[var(--bg-input)] text-[var(--text-primary)]" rows={2} />
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={function(){ doSubmit(c.id); }} disabled={submitting} className="text-[11px] px-2 py-0.5 bg-[var(--accent)] text-white rounded disabled:opacity-50">回复</button>
                        <button onClick={function(){ setReplyingTo(null); }} className="text-[11px] px-2 py-0.5 bg-[var(--bg-input)] text-[var(--text-secondary)] rounded">取消</button>
                      </div>
                    </div>
                  )}
                </div>
                {replies(c.id).length > 0 && (
                  <div className="ml-4 mt-1 space-y-1 border-l-2 border-[var(--border-default)] pl-2">
                    {replies(c.id).map(function(r: any){
                      return (
                        <div key={r.id} className={"p-2 border border-[var(--border-default)] rounded " + (r.is_pinned ? "bg-[var(--accent)]/5" : "bg-[var(--bg-card)]")}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] font-medium text-[var(--text-primary)]">{r.user?.full_name || r.user?.username || "用户"}</span>
                            {r.is_ai && <span className="text-[9px] bg-purple-500/10 text-purple-500 px-1 rounded">AI</span>}
                            <span className="text-[9px] text-[var(--text-tertiary)] ml-auto">{new Date(r.created_at).toLocaleString("zh-CN")}</span>
                          </div>
                          {editingId === r.id ? (
                            <div>
                              <textarea value={editInput} onChange={function(e){ setEditInput(e.target.value); }} className="w-full text-[11px] p-1.5 border border-[var(--border-default)] rounded resize-none bg-[var(--bg-input)] text-[var(--text-primary)]" rows={2} />
                              <div className="flex gap-1.5 mt-1">
                                <button onClick={function(){ doEdit(r.id); }} className="text-[10px] px-2 py-0.5 bg-[var(--accent)] text-white rounded">保存</button>
                                <button onClick={function(){ setEditingId(null); }} className="text-[10px] px-2 py-0.5 bg-[var(--bg-input)] text-[var(--text-secondary)] rounded">取消</button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[11px] text-[var(--text-secondary)]">{r.content}</p>
                          )}
                          {editingId !== r.id && (
                            <div className="flex items-center gap-2 mt-1">
                              {canEdit(r) && <button onClick={function(){ setEditingId(r.id); setEditInput(r.content); }} className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--accent)]">编辑</button>}
                              {canDelete(r) && <button onClick={function(){ doDelete(r.id); }} className="text-[9px] text-red-400 hover:text-red-500">删除</button>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      <div className="flex-shrink-0 mt-2 pt-2 border-t border-[var(--border-default)]">
        <textarea value={commentInput} onChange={function(e){ setCommentInput(e.target.value); }} placeholder="输入评论..." className="w-full text-[12px] p-2 border border-[var(--border-default)] rounded resize-none bg-[var(--bg-input)] text-[var(--text-primary)]" rows={2} />
        <button onClick={function(){ doSubmit(); }} disabled={submitting || !commentInput.trim()} className="mt-1.5 px-4 py-1.5 bg-[var(--accent)] text-white text-[12px] rounded hover:opacity-90 disabled:opacity-50 transition">
          {submitting ? "sending..." : "send comment"}
        </button>
      </div>
    </div>
  );
}
