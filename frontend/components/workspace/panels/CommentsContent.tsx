"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { getUser } from "@/lib/auth";
import type { Comment } from "@/types/workspace";

interface Props {
  comments: Comment[];
  experimentId: string;
  onRefresh: () => void;
}

export default function CommentsContent({ comments, experimentId, onRefresh }: Props) {
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const user = getUser();

  const isTeacherOrAdmin = user?.role === "teacher" || user?.role === "admin";

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      await api.createComment(experimentId, newComment.trim());
      setNewComment("");
      onRefresh();
    } catch {
      alert("发表失败");
    } finally {
      setSending(false);
    }
  };

  const handleReply = async (parentId: string) => {
    if (!replyContent.trim()) return;
    setSending(true);
    try {
      await api.createComment(experimentId, replyContent.trim(), parentId);
      setReplyContent("");
      setReplyTo(null);
      onRefresh();
    } catch {
      alert("回复失败");
    } finally {
      setSending(false);
    }
  };

  const handleEdit = async (commentId: string) => {
    if (!editContent.trim()) return;
    try {
      await api.updateComment(commentId, editContent.trim());
      setEditingId(null);
      setEditContent("");
      onRefresh();
    } catch {
      alert("编辑失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除这条评论？")) return;
    try {
      await api.deleteComment(id);
      onRefresh();
    } catch {
      alert("删除失败");
    }
  };

  const handleTogglePin = async (id: string) => {
    try {
      await api.togglePinComment(id);
      onRefresh();
    } catch {
      alert("操作失败");
    }
  };

  const renderComment = (c: Comment, isReply = false) => {
    const isOwner = c.user_id === user?.id;
    const canEdit = isOwner || isTeacherOrAdmin;
    const isEditing = editingId === c.id;

    return (
      <div key={c.id} className={`flex gap-3 ${isReply ? "ml-10 mt-2" : ""}`}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
            c.is_ai ? "bg-purple-500" : c.user?.role === "teacher" ? "bg-blue-500" : "bg-gray-400"
          }`}
        >
          {c.is_ai ? "AI" : (c.user?.username?.[0] || "?").toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium">
              {c.is_ai ? "AI 助手" : c.user?.full_name || c.user?.username || "匿名"}
            </span>
            {c.is_ai && (
              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">AI</span>
            )}
            {c.user?.role === "teacher" && !c.is_ai && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">教师</span>
            )}
            {c.is_pinned && (
              <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">置顶</span>
            )}
            <span className="text-xs text-[var(--text-tertiary)]">
              {new Date(c.created_at).toLocaleString("zh-CN")}
            </span>
            {c.updated_at && c.updated_at !== c.created_at && (
              <span className="text-xs text-[var(--text-tertiary)]">(已编辑)</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {!isReply && (
                <button
                  onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyContent(""); }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  {replyTo === c.id ? "取消" : "回复"}
                </button>
              )}
              {isTeacherOrAdmin && !isReply && (
                <button
                  onClick={() => handleTogglePin(c.id)}
                  className="text-xs text-amber-500 hover:text-amber-700"
                  title={c.is_pinned ? "取消置顶" : "置顶"}
                >
                  {c.is_pinned ? "取消置顶" : "置顶"}
                </button>
              )}
              {canEdit && !c.is_ai && (
                <button
                  onClick={() => { setEditingId(c.id); setEditContent(c.content); }}
                  className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  编辑
                </button>
              )}
              {(canEdit || isOwner) && (
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  删除
                </button>
              )}
            </div>
          </div>

          {isEditing ? (
            <div className="mt-1">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full p-2 border rounded text-sm resize-none"
                rows={2}
              />
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => handleEdit(c.id)}
                  className="px-3 py-1 bg-[var(--accent)] text-white rounded text-xs"
                >
                  保存
                </button>
                <button
                  onClick={() => { setEditingId(null); setEditContent(""); }}
                  className="px-3 py-1 bg-[var(--bg-input)] text-[var(--text-secondary)] rounded text-xs"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{c.content}</p>
          )}

          {replyTo === c.id && !isReply && (
            <div className="mt-2 space-y-2">
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="输入回复..."
                className="w-full p-2 border rounded text-sm resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleReply(c.id)}
                  disabled={sending || !replyContent.trim()}
                  className="px-3 py-1 bg-[var(--accent)] text-white rounded text-xs disabled:opacity-50"
                >
                  {sending ? "发送中..." : "回复"}
                </button>

              </div>
            </div>
          )}

          {c.replies && c.replies.length > 0 && (
            <div className="mt-2 border-l-2 border-gray-100 pl-2 space-y-2">
              {c.replies.map((r) => renderComment(r, true))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">讨论区</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {comments.length === 0 && (
          <div className="text-center text-[var(--text-tertiary)] py-8">暂无评论</div>
        )}
        {comments.map((c) => renderComment(c))}
      </div>

      {user && (
        <div className="border-t p-4 space-y-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="发表评论..."
            className="w-full p-3 border rounded-lg resize-none text-sm"
            rows={2}
          />
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={sending || !newComment.trim()}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-md text-sm disabled:opacity-50"
            >
              {sending ? "发表中..." : "发表"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
