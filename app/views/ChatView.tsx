"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { ChatConversation, ChatMessage, ChatStatus, ChatTag } from "@/lib/types";
import type { Role } from "@/lib/authz";

// Quản lý chat khách hàng, gộp về 1 Zalo OA (xem supabase/schema.sql
// "Giai đoạn 11"). Hoạt động được NGAY ở dạng ghi tay (sổ ghi chép hội
// thoại): "Trả lời khách" = tin nhân viên gửi, "Ghi lại tin khách" = tin
// khách đã gửi qua Zalo nhưng chưa có webhook tự động để ghi lại hộ. Khi
// Zalo OA được duyệt, tin "khách gửi" sẽ do webhook tự tạo và tin "trả lời"
// sẽ gọi thêm Zalo Send API — không đổi gì ở giao diện này.

const STATUS_LABEL: Record<ChatStatus, string> = { moi: "Mới", dang_xu_ly: "Đang xử lý", da_dong: "Đã đóng" };
const STATUS_PILL: Record<ChatStatus, string> = { moi: "pill-warm", dang_xu_ly: "pill-primary", da_dong: "pill-success" };

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function requestJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Thao tác thất bại");
  return json;
}

function isOffice(role: Role): boolean {
  return role === "admin" || role === "accountant";
}

export default function ChatView({ role, userId }: { role: Role; userId: string }) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [tags, setTags] = useState<ChatTag[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null; username: string | null }[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showTags, setShowTags] = useState(false);

  async function loadConversations() {
    setLoading(true);
    try {
      const json = await requestJson("/api/chat/conversations");
      setConversations(json.conversations ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConversations();
    requestJson("/api/chat/tags").then((j) => setTags(j.tags ?? [])).catch(() => {});
    // Chi nhánh và danh sách nhân viên chỉ cần cho Admin/Kế toán (chọn chi
    // nhánh, gán quyền xem) — vẫn tải sẵn nhẹ nhàng cho mọi role để chọn chi
    // nhánh lúc tạo hội thoại mới cũng dùng được.
    supabase
      .from("stores")
      .select("id, name")
      .order("name")
      .then(({ data }) => setStores(data ?? []));
    if (isOffice(role)) {
      supabase
        .from("profiles")
        .select("id, display_name, username")
        .not("role", "is", null)
        .order("display_name")
        .then(({ data }) => setProfiles(data ?? []));
    }
  }, [role]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.customer_name.toLowerCase().includes(q) || (c.customer_phone ?? "").includes(q));
  }, [conversations, search]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="app app-full">
      <header className="app-header">
        <div className="app-header-title">
          <h1>Chat khách hàng</h1>
          <p className="app-header-meta">
            {conversations.length} hội thoại{isOffice(role) ? " · bạn thấy toàn bộ" : " · chỉ hội thoại được gán cho bạn"}
          </p>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setShowCreate(true)}>
          + Hội thoại mới
        </button>
      </header>

      {error && (
        <div role="alert" className="panel" style={{ color: "var(--danger-ink)", background: "var(--danger-wash)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <section className="panel" style={{ flex: "1 1 320px", minWidth: 280, maxWidth: 380, padding: 0, maxHeight: "72vh", overflowY: "auto" }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <input placeholder="Tìm theo tên hoặc số điện thoại..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%" }} />
          </div>
          {loading && <p style={{ color: "var(--muted)", padding: 12 }}>Đang tải…</p>}
          {!loading && filtered.length === 0 && <p style={{ color: "var(--muted)", padding: 12 }}>Chưa có hội thoại nào.</p>}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                background: c.id === selectedId ? "var(--primary-wash)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 650 }}>{c.customer_name}</span>
                <span className={`pill ${STATUS_PILL[c.status]}`} style={{ fontSize: "var(--text-micro)" }}>
                  {STATUS_LABEL[c.status]}
                </span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>
                {c.customer_phone ?? "—"}
                {c.branch?.name ? ` · ${c.branch.name}` : ""}
              </div>
              {(c.tags?.length ?? 0) > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                  {c.tags!.map((t) => (
                    <span key={t.id} className={`pill pill-${t.color}`} style={{ fontSize: "var(--text-micro)" }}>
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </section>

        <section className="panel" style={{ flex: "2 1 420px", minWidth: 300, maxHeight: "72vh", display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <p style={{ color: "var(--muted)" }}>Chọn một hội thoại ở danh sách bên trái.</p>
          ) : (
            <ConversationThread
              key={selected.id}
              conversation={selected}
              role={role}
              userId={userId}
              stores={stores}
              tags={tags}
              onChanged={loadConversations}
              onOpenAssign={() => setShowAssign(true)}
              onOpenTags={() => setShowTags(true)}
            />
          )}
        </section>
      </div>

      {showCreate && (
        <CreateConversationModal
          stores={stores}
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => {
            setShowCreate(false);
            await loadConversations();
            setSelectedId(id);
          }}
        />
      )}
      {showAssign && selected && (
        <AssignModal conversation={selected} profiles={profiles} onClose={() => setShowAssign(false)} onSaved={loadConversations} />
      )}
      {showTags && selected && (
        <TagPickerModal conversation={selected} tags={tags} onClose={() => setShowTags(false)} onSaved={loadConversations} onTagCreated={(t) => setTags((prev) => [...prev, t])} />
      )}
    </div>
  );
}

function ConversationThread({
  conversation,
  role,
  userId,
  stores,
  tags,
  onChanged,
  onOpenAssign,
  onOpenTags,
}: {
  conversation: ChatConversation;
  role: Role;
  userId: string;
  stores: { id: string; name: string }[];
  tags: ChatTag[];
  onChanged: () => void;
  onOpenAssign: () => void;
  onOpenTags: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const json = await requestJson(`/api/chat/conversations/${conversation.id}/messages`);
      setMessages(json.messages ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  async function send(direction: "ra" | "vao") {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await requestJson(`/api/chat/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, content: text.trim() }),
      });
      setText("");
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function setBranch(branchId: string) {
    try {
      await requestJson(`/api/chat/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId || null }),
      });
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function setStatus(status: string) {
    try {
      await requestJson(`/api/chat/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 650 }}>{conversation.customer_name}</div>
          <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>{conversation.customer_phone ?? "Chưa có số điện thoại"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <select value={conversation.status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select value={conversation.branch_id ?? ""} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Chưa gắn chi nhánh</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn btn-quiet" onClick={onOpenTags}>
            Tag
          </button>
          {role === "admin" || role === "accountant" ? (
            <button className="btn btn-quiet" onClick={onOpenAssign}>
              Gán quyền xem
            </button>
          ) : null}
        </div>
      </div>

      {(conversation.assignees?.length ?? 0) > 0 && (
        <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: "var(--text-micro)" }}>
          Được xem bởi: {conversation.assignees!.map((a) => a.display_name ?? "—").join(", ")}
        </p>
      )}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
        {loading && <p style={{ color: "var(--muted)" }}>Đang tải…</p>}
        {!loading && messages.length === 0 && <p style={{ color: "var(--muted)" }}>Chưa có tin nhắn nào.</p>}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.direction === "ra" ? "flex-end" : "flex-start",
              maxWidth: "80%",
              background: m.direction === "ra" ? "var(--primary-wash)" : "var(--surface-sunken)",
              borderRadius: "var(--radius-md)",
              padding: "7px 10px",
            }}
          >
            {m.content && <div style={{ whiteSpace: "pre-wrap", fontSize: "var(--text-body-sm)" }}>{m.content}</div>}
            {m.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.image_url} alt="" style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)", marginTop: m.content ? 6 : 0 }} />
            )}
            <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)", marginTop: 3 }}>
              {m.direction === "ra" ? m.sent_by_profile?.display_name ?? "Nhân viên" : "Khách hàng"} · {formatTime(m.created_at)}
            </div>
          </div>
        ))}
      </div>

      {error && <p style={{ color: "var(--danger-ink)", fontSize: "var(--text-micro)" }}>{error}</p>}

      <div style={{ display: "flex", gap: 6, marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nhập tin nhắn..."
          rows={2}
          style={{ flex: 1, resize: "vertical" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button className="btn btn-primary" disabled={sending || !text.trim()} onClick={() => send("ra")}>
            Trả lời khách
          </button>
          <button className="btn btn-quiet" disabled={sending || !text.trim()} onClick={() => send("vao")} title="Dùng khi khách đã nhắn qua Zalo cá nhân nhưng chưa có kết nối tự động">
            Ghi lại tin khách
          </button>
        </div>
      </div>
    </>
  );
}

function CreateConversationModal({
  stores,
  onClose,
  onCreated,
}: {
  stores: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const json = await requestJson("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: name, customer_phone: phone || null, branch_id: branchId || null }),
      });
      onCreated(json.conversation.id);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Hội thoại mới</h2>
        <p className="modal-sub">Dùng để ghi lại một đoạn chat khách hàng (qua Zalo cá nhân tạm thời, hoặc kênh khác) vào hệ thống.</p>
        <div className="field-group" style={{ display: "grid", gap: 8 }}>
          <label className="field">
            Tên khách hàng
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Số điện thoại (không bắt buộc)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="field">
            Chi nhánh (không bắt buộc)
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Chưa gắn chi nhánh</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p style={{ color: "var(--danger-ink)", fontSize: "var(--text-micro)" }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={submit}>
            {saving ? "Đang tạo…" : "Tạo hội thoại"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({
  conversation,
  profiles,
  onClose,
  onSaved,
}: {
  conversation: ChatConversation;
  profiles: { id: string; display_name: string | null; username: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>((conversation.assignees ?? []).map((a) => a.user_id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await requestJson(`/api/chat/conversations/${conversation.id}/assign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: selected }),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Gán quyền xem</h2>
        <p className="modal-sub">Chỉ những nhân viên được chọn mới thấy hội thoại "{conversation.customer_name}".</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 240, overflowY: "auto" }}>
          {profiles.map((p) => (
            <label key={p.id} className="pill" style={{ cursor: "pointer", gap: 6 }}>
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.display_name || p.username || "—"}
            </label>
          ))}
        </div>
        {error && <p style={{ color: "var(--danger-ink)", fontSize: "var(--text-micro)" }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagPickerModal({
  conversation,
  tags,
  onClose,
  onSaved,
  onTagCreated,
}: {
  conversation: ChatConversation;
  tags: ChatTag[];
  onClose: () => void;
  onSaved: () => void;
  onTagCreated: (t: ChatTag) => void;
}) {
  const [selected, setSelected] = useState<string[]>((conversation.tags ?? []).map((t) => t.id));
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function createTag() {
    if (!newTag.trim()) return;
    try {
      const json = await requestJson("/api/chat/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTag.trim() }),
      });
      onTagCreated(json.tag);
      setSelected((prev) => [...prev, json.tag.id]);
      setNewTag("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await requestJson(`/api/chat/conversations/${conversation.id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_ids: selected }),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Gắn tag</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {tags.map((t) => (
            <label key={t.id} className={`pill pill-${t.color}`} style={{ cursor: "pointer", gap: 6 }}>
              <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
              {t.name}
            </label>
          ))}
        </div>
        <div className="field-group" style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <input placeholder="Tạo tag mới..." value={newTag} onChange={(e) => setNewTag(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" onClick={createTag}>
            Thêm
          </button>
        </div>
        {error && <p style={{ color: "var(--danger-ink)", fontSize: "var(--text-micro)" }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
