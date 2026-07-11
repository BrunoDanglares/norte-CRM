import { useState, useEffect, useRef, useCallback, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiRequest } from "@/lib/queryClient";

const POPULAR_EMOJIS = ["😊", "😍", "🔥", "✅", "❤️", "🎉", "👋", "💬", "📩", "⭐", "💪", "🚀", "👏", "😎", "💰", "🎁", "📌", "✨", "🤝", "👇", "📲", "💡", "🙌", "❗", "😄", "🥳", "💜", "🤩", "👀", "🏆"];
const VARIABLES = [
  { code: "{{username}}", label: "Nome do usuário" },
  { code: "{{nome}}", label: "Nome do contato" },
];

function TextToolbar({ inputRef, field, setForm }: { inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>; field: string; setForm: (fn: (f: any) => any) => void }) {
  const [showEmojis, setShowEmojis] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojis(false);
    }
    if (showEmojis) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showEmojis]);

  function insertAt(text: string) {
    const el = inputRef.current;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const newVal = el.value.slice(0, start) + text + el.value.slice(end);
      setForm((f: any) => ({ ...f, [field]: newVal }));
      setTimeout(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); }, 0);
    } else {
      setForm((f: any) => ({ ...f, [field]: f[field] + text }));
    }
  }

  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ position: "relative" }} ref={emojiRef}>
        <button type="button" onClick={() => setShowEmojis(!showEmojis)} data-testid={`btn-emoji-${field}`} style={{ padding: "2px 8px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid var(--border)", background: showEmojis ? "rgba(225,48,108,0.08)" : "transparent" }} className="text-muted-foreground hover:text-foreground">
          😊
        </button>
        {showEmojis && (
          <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 50, padding: 8, borderRadius: 10, border: "1px solid var(--border)", width: 220, display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 2 }} className="bg-card shadow-lg">
            {POPULAR_EMOJIS.map(e => (
              <button key={e} type="button" onClick={() => { insertAt(e); setShowEmojis(false); }} style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, borderRadius: 4 }} className="hover:bg-muted">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      {VARIABLES.map(v => (
        <button key={v.code} type="button" onClick={() => insertAt(v.code)} title={v.label} data-testid={`btn-var-${v.code}`} style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", fontFamily: "monospace" }} className="text-muted-foreground hover:text-foreground hover:bg-muted">
          {v.code}
        </button>
      ))}
    </div>
  );
}

const TIPOS = [
  { value: "comment_to_dm", label: "Comentário → DM", icon: "💬", desc: "Alguém comenta no post e recebe DM automática com IA" },
  { value: "dm_received", label: "DM recebida", icon: "📩", desc: "Qualquer DM recebida entra no fluxo de prospecção com IA" },
  { value: "story_mention", label: "Menção nos Stories", icon: "⭐", desc: "Alguém marca seu perfil nos Stories e recebe DM com IA" },
];

const PERSONAS = [
  { value: "vendedor", label: "Consultor de vendas", prompt: "Você é um consultor de vendas simpático e objetivo da nossa empresa. Seu objetivo é qualificar o lead coletando: nome, contato e interesse. Quando tiver todas as informações, escreva LEAD_QUALIFICADO: [resumo]. Seja natural, use linguagem simples, máximo 2 frases por mensagem." },
  { value: "reativacao", label: "Reativação de ex-cliente", prompt: "Você é um atendente caloroso da nossa empresa. O contato já foi nosso cliente. Seu objetivo é reacender o interesse mostrando novidades e condições especiais para retorno. Quando o cliente demonstrar interesse real, escreva LEAD_QUALIFICADO: [resumo]. Máximo 2 frases por mensagem." },
  { value: "indicacao", label: "Campanha de indicação", prompt: "Você atende clientes que indicaram amigos para a nossa empresa. Agradeça a indicação, explique o benefício e pergunte se o indicado já foi contatado. Seja animado e breve. Máximo 2 frases por mensagem." },
  { value: "pos_instalacao", label: "Pós-venda / Upsell", prompt: "Você faz acompanhamento de pós-venda. Pergunte se tudo correu bem e colete uma avaliação rápida. Se positiva, ofereça um upgrade com condição especial. Se negativa, sinalize urgência de suporte escrevendo SUPORTE_URGENTE: [problema]. Máximo 2 frases." },
  { value: "personalizado", label: "Personalizado", prompt: "" },
];

const igGradient = "linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)";

function IgIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433" />
          <stop offset="25%" stopColor="#e6683c" />
          <stop offset="50%" stopColor="#dc2743" />
          <stop offset="75%" stopColor="#cc2366" />
          <stop offset="100%" stopColor="#bc1888" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig-grad)" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="5" stroke="url(#ig-grad)" strokeWidth="2" fill="none" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="url(#ig-grad)" />
    </svg>
  );
}

const ISP_STYLES = `
@keyframes igPulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.6); opacity: 0; } }
@keyframes ispCardIn { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes ispCardOut { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.92) translateY(6px); } }
@keyframes igRingSpin { to { transform: rotate(360deg); } }
@keyframes igRingGlow { 0%, 100% { filter: drop-shadow(0 0 4px rgba(225,48,108,0.4)); } 50% { filter: drop-shadow(0 0 10px rgba(225,48,108,0.7)); } }
.isp-card-enter { animation: ispCardIn 0.25s ease-out both; }
.isp-card-exit { animation: ispCardOut 0.22s ease-in both; pointer-events: none; }
.isp-card-toggle { transition: border-color 0.3s, box-shadow 0.3s; }
.isp-card-toggle.toggling { box-shadow: 0 0 0 2px rgba(225,48,108,0.3); }
.post-card-wrap:hover .post-flow-btn { opacity: 1 !important; }
.post-flow-btn:hover { transform: scale(1.1); }
.isp-ring-spinner {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  animation: igRingGlow 2s ease-in-out infinite;
}
.isp-ring-spinner svg { animation: igRingSpin 1s linear infinite; }
`;

let ispRingIdCounter = 0;
function IspRingSpinner({ size = 28 }: { size?: number }) {
  const [gradId] = useState(() => `isp-ring-grad-${++ispRingIdCounter}`);
  const r = size / 2 - 3;
  return (
    <div className="isp-ring-spinner" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f09433" />
            <stop offset="30%" stopColor="#e6683c" />
            <stop offset="55%" stopColor="#dc2743" />
            <stop offset="80%" stopColor="#cc2366" />
            <stop offset="100%" stopColor="#bc1888" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${gradId})`} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeDasharray={`${r * 4.2} ${r * 2}`} />
      </svg>
    </div>
  );
}

type SubTab = "posts" | "flows";

export default function InstaProspect() {
  const [subTab, setSubTab] = useState<SubTab>("flows");
  const [presetPostId, setPresetPostId] = useState<string>("");

  function createFlowForPost(postId: string) {
    setPresetPostId(postId);
    setSubTab("flows");
  }

  const { data: igStatus, isLoading: igLoading } = useQuery<any>({
    queryKey: ["/api/instagram/status"],
    staleTime: 60000,
  });

  if (igLoading) {
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <style>{ISP_STYLES}</style>
        <div style={{ margin: "0 auto 12px", display: "flex", justifyContent: "center" }}><IspRingSpinner size={32} /></div>
        <p className="text-muted-foreground" style={{ fontSize: 13 }}>Verificando Instagram...</p>
      </div>
    );
  }

  if (!igStatus?.connected) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: igGradient, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <IgIcon size={28} />
        </div>
        <h2 className="text-foreground" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Instagram não conectado</h2>
        <p className="text-muted-foreground" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Para usar as automações do Instagram, conecte sua conta Instagram Business em <strong>Canais → Instagram</strong>.
        </p>
        <a href="/conexoes?tab=instagram" className="text-foreground" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 20px", borderRadius: 8, background: "#E1306C", color: "white", fontSize: 13, fontWeight: 500, textDecoration: "none" }} data-testid="link-go-conexoes">
          Ir para Conexões
        </a>
      </div>
    );
  }

  const tabs: { key: SubTab; label: string; icon: string }[] = [
    { key: "flows", label: "Automações", icon: "⚡" },
    { key: "posts", label: "Publicações", icon: "🖼️" },
  ];

  return (
    <div style={{ padding: "1.5rem" }}>
      <style>{ISP_STYLES}</style>
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={subTab === t.key ? "text-foreground" : "text-muted-foreground"}
            data-testid={`tab-${t.key}`}
            style={{
              padding: "8px 16px", fontSize: 12.5, fontWeight: subTab === t.key ? 600 : 400,
              border: "none", background: "none", cursor: "pointer",
              borderBottom: subTab === t.key ? "2px solid #E1306C" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>


      {subTab === "posts" && <PostsTab onCreateFlow={createFlowForPost} />}
      {subTab === "flows" && <FlowsTab presetPostId={presetPostId} onPresetConsumed={() => setPresetPostId("")} />}
    </div>
  );
}


function PostsTab({ onCreateFlow }: { onCreateFlow: (postId: string) => void }) {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);

  useEffect(() => { loadPosts(); }, []);

  async function loadPosts(cursor?: string) {
    if (cursor) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const url = cursor ? `/api/instagram/posts?after=${cursor}` : "/api/instagram/posts";
      const data = await apiFetch(url);
      if (cursor) {
        setPosts(prev => [...prev, ...(data.posts || [])]);
      } else {
        setPosts(data.posts || []);
      }
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      // extrai a mensagem REAL do backend/Graph (err.message vem como "400: {\"error\":\"…\"}")
      let msg = "";
      try { const j = String(err?.message || "").match(/\{[\s\S]*\}/); if (j) msg = JSON.parse(j[0]).error || ""; } catch { /* ignore */ }
      setError(msg
        ? `Erro ao carregar publicações: ${msg}`
        : "Erro ao carregar publicações. Verifique se o Instagram está conectado e o token válido.");
    }
    setLoading(false);
    setLoadingMore(false);
  }

  function formatDate(ts: string) {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return ts; }
  }

  function mediaIcon(type: string) {
    if (type === "VIDEO") return "🎬";
    if (type === "CAROUSEL_ALBUM") return "📸";
    return "🖼️";
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <div style={{ margin: "0 auto 10px", display: "flex", justifyContent: "center" }}><IspRingSpinner size={24} /></div>
        <p className="text-muted-foreground" style={{ fontSize: 13 }}>Carregando publicações do Instagram...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border" style={{ padding: "2rem", borderRadius: 12, textAlign: "center" }}>
        <p style={{ fontSize: 28, margin: "0 0 8px" }}>⚠️</p>
        <p className="text-foreground" style={{ fontSize: 14, fontWeight: 500, margin: "0 0 4px" }}>Erro ao carregar</p>
        <p className="text-muted-foreground" style={{ fontSize: 12, margin: "0 0 12px" }}>{error}</p>
        <button onClick={() => loadPosts()} style={{ padding: "7px 16px", borderRadius: 8, background: "#E1306C", border: "none", color: "white", fontSize: 12, cursor: "pointer" }}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-card border border-border" style={{ padding: "2.5rem", borderRadius: 12, textAlign: "center" }}>
        <p style={{ fontSize: 28, margin: "0 0 8px" }}>📭</p>
        <p className="text-foreground" style={{ fontSize: 14, fontWeight: 500 }}>Nenhuma publicação encontrada</p>
        <p className="text-muted-foreground" style={{ fontSize: 12 }}>Publique conteúdo no Instagram para ver aqui.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {posts.map(post => (
          <div
            key={post.id}
            onClick={() => setSelectedPost(post)}
            className="bg-card border border-border post-card-wrap"
            style={{ borderRadius: 10, overflow: "hidden", cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s" }}
            data-testid={`post-card-${post.id}`}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = ""; }}
          >
            <div style={{ width: "100%", paddingTop: "100%", position: "relative", background: "#1a1a2e" }}>
              {post.mediaUrl ? (
                post.mediaType === "VIDEO" ? (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                    <img src={post.thumbnailUrl || post.mediaUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
                    <span style={{ position: "relative", fontSize: 28, zIndex: 1 }}>▶</span>
                  </div>
                ) : (
                  <img src={post.mediaUrl} alt={post.caption?.slice(0, 60) || ""} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                )
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 28 }}>{mediaIcon(post.mediaType)}</span>
                </div>
              )}
              {post.mediaType === "CAROUSEL_ALBUM" && (
                <span style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "white", fontSize: 10, padding: "2px 6px", borderRadius: 4 }}>📸 Álbum</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onCreateFlow(post.id); }}
                title="Criar automação para este post"
                data-testid={`button-create-flow-${post.id}`}
                className="post-flow-btn"
                style={{
                  position: "absolute", bottom: 8, right: 8,
                  width: 32, height: 32, borderRadius: 8,
                  background: "rgba(225,48,108,0.9)", border: "none",
                  color: "white", fontSize: 16, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: 0, transition: "opacity 0.2s, transform 0.15s",
                  backdropFilter: "blur(4px)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                }}
              >⚡</button>
            </div>
            <div style={{ padding: "10px 12px" }}>
              <p className="text-foreground" style={{ fontSize: 12, margin: "0 0 6px", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {post.caption || "(sem legenda)"}
              </p>
              <div className="text-muted-foreground" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
                <span>❤️ {post.likeCount}</span>
                <span>💬 {post.commentsCount}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateFlow(post.id); }}
                  title="Criar automação"
                  data-testid={`button-create-flow-inline-${post.id}`}
                  style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 3, color: "#E1306C", fontWeight: 500 }}
                >⚡</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {nextCursor && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button
            onClick={() => loadPosts(nextCursor)}
            disabled={loadingMore}
            style={{ padding: "8px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", fontSize: 12.5, cursor: "pointer" }}
            className="text-foreground"
            data-testid="button-load-more-posts"
          >
            {loadingMore ? "Carregando..." : "Carregar mais publicações"}
          </button>
        </div>
      )}

      {selectedPost && (
        <PostDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      )}
    </div>
  );
}

function PostDetailModal({ post, onClose }: { post: any; onClose: () => void }) {
  const [flows, setFlows] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingC, setLoadingC] = useState(false);
  const [cError, setCError] = useState("");
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [capExp, setCapExp] = useState(false);

  useEffect(() => {
    apiFetch("/api/insta-prospect/flows").then(f => {
      const linked = (f || []).filter((fl: any) => fl.postId === post.id);
      setFlows(linked);
    }).catch(() => {});
  }, [post.id]);

  async function loadComments() {
    setLoadingC(true); setCError("");
    try {
      // cache-buster (?t=): senão o navegador devolve comentários antigos em cache mesmo
      // depois de apagar/responder — a lista tem que refletir o Instagram AGORA.
      const d = await apiFetch(`/api/instagram/posts/${post.id}/comments?t=${Date.now()}`);
      setComments(Array.isArray(d.comments) ? d.comments : []);
    } catch (e: any) {
      let msg = ""; try { const j = String(e?.message || "").match(/\{[\s\S]*\}/); if (j) msg = JSON.parse(j[0]).error || ""; } catch {}
      setCError(msg || "Não deu pra carregar os comentários.");
    }
    setLoadingC(false);
  }
  useEffect(() => { loadComments(); /* eslint-disable-next-line */ }, [post.id]);

  async function enviarResposta(commentId: string) {
    const msg = replyText.trim();
    if (!msg || sending) return;
    setSending(true); setCError("");
    try {
      await apiRequest("POST", `/api/instagram/comments/${commentId}/reply`, { message: msg });
      setReplyText(""); setReplyOpen(null);
      await loadComments();
    } catch (e: any) {
      let msg2 = ""; try { const j = String(e?.message || "").match(/\{[\s\S]*\}/); if (j) msg2 = JSON.parse(j[0]).error || ""; } catch {}
      setCError(msg2 || "Não deu pra enviar a resposta.");
    }
    setSending(false);
  }

  function formatDate(ts: string) {
    try { return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ts; }
  }
  function relTime(ts: string) {
    try {
      const d = new Date(ts).getTime(); const diff = (Date.now() - d) / 1000;
      if (diff < 60) return "agora"; if (diff < 3600) return `${Math.floor(diff / 60)}min`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`; return `${Math.floor(diff / 86400)}d`;
    } catch { return ""; }
  }

  // Modal no estilo Instagram web: fecha no Esc e trava o scroll do fundo enquanto aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const caption = post.caption || "";
  const capLong = caption.length > 220;

  return createPortal(
    <div
      onClick={onClose}
      className="flex items-center justify-center p-3 sm:p-6"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 2147483000 }}
      data-testid="modal-post-overlay"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="relative bg-card border border-border rounded-2xl overflow-hidden shadow-2xl w-full max-w-[980px] max-h-[92vh] md:h-[86vh] flex flex-col md:flex-row"
        data-testid="modal-post-detail"
      >
        {/* Fechar — flutua acima de tudo */}
        <button onClick={onClose} aria-label="Fechar" className="absolute top-2.5 right-2.5 z-20" style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "grid", placeItems: "center" }} data-testid="button-close-post-detail">✕</button>

        {/* ── MÍDIA (esquerda, estilo Instagram web) ── */}
        <div className="relative shrink-0 flex items-center justify-center w-full md:w-[56%] h-[36vh] md:h-full" style={{ background: "#000" }}>
          {post.mediaUrl ? (
            post.mediaType === "VIDEO"
              ? <video src={post.mediaUrl} controls className="max-w-full max-h-full" style={{ objectFit: "contain" }} />
              : <img src={post.mediaUrl} alt="" className="max-w-full max-h-full" style={{ objectFit: "contain" }} />
          ) : <span className="text-muted-foreground" style={{ fontSize: 12 }}>Sem mídia</span>}
        </div>

        {/* ── PAINEL DIREITO (legenda + comentários) ── */}
        <div className="flex flex-col min-h-0 flex-1 md:w-[44%] md:h-full">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border shrink-0" style={{ padding: "12px 46px 12px 16px" }}>
            <div style={{ flex: "none", width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#feda75,#d62976,#4f5bd5)", display: "grid", placeItems: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
              {(post.username || "IG").slice(0, 2).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p className="text-foreground" style={{ fontSize: 13, fontWeight: 600, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{post.username ? `@${post.username}` : "Publicação"}</p>
              <p className="text-muted-foreground" style={{ fontSize: 10.5, margin: 0 }}>{formatDate(post.timestamp)}</p>
            </div>
          </div>

          {/* Corpo rolável: legenda + comentários + automações */}
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "14px 16px" }}>
            {/* Legenda (estilo primeiro comentário do IG) */}
            {caption ? (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 14 }}>
                <div style={{ flex: "none", width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#feda75,#d62976,#4f5bd5)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>{(post.username || "IG").slice(0, 1).toUpperCase()}</div>
                <p className="text-foreground" style={{ fontSize: 13, margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap", minWidth: 0 }}>
                  {post.username && <strong>@{post.username} </strong>}
                  {capLong && !capExp ? caption.slice(0, 220) + "… " : caption}
                  {capLong && (
                    <button onClick={() => setCapExp(v => !v)} className="text-muted-foreground" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0, fontWeight: 600 }}>
                      {capExp ? "ver menos" : "ver mais"}
                    </button>
                  )}
                </p>
              </div>
            ) : null}

          {/* ── Comentários (ler + responder) ── */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <p className="text-foreground" style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>💬 Comentários</p>
              <button onClick={loadComments} disabled={loadingC} className="text-muted-foreground" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11 }}>↻ atualizar</button>
            </div>

            {cError && <p style={{ fontSize: 11.5, color: "#ef4444", margin: "0 0 8px" }}>{cError}</p>}

            {loadingC ? (
              <p className="text-muted-foreground" style={{ fontSize: 12, textAlign: "center", padding: "10px 0" }}>Carregando comentários…</p>
            ) : comments.length === 0 ? (
              <p className="text-muted-foreground" style={{ fontSize: 12, textAlign: "center", padding: "10px 0" }}>Nenhum comentário ainda.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {comments.map((c: any) => (
                  <div key={c.id}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ flex: "none", width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#feda75,#d62976,#4f5bd5)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
                        {(c.username || "?").slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.45 }} className="text-foreground">
                          <strong>@{c.username || "usuário"}</strong> <span className="text-muted-foreground" style={{ fontSize: 10.5 }}>· {relTime(c.timestamp)}</span>
                          <br />{c.text}
                        </p>
                        {(c.replies || []).map((rp: any) => (
                          <p key={rp.id} style={{ fontSize: 12, margin: "6px 0 0 0", paddingLeft: 12, borderLeft: "2px solid var(--border)", lineHeight: 1.4 }} className="text-foreground">
                            <strong>@{rp.username || "usuário"}</strong> <span className="text-muted-foreground" style={{ fontSize: 10.5 }}>· {relTime(rp.timestamp)}</span><br />{rp.text}
                          </p>
                        ))}
                        {replyOpen === c.id ? (
                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            <input
                              value={replyText} onChange={e => setReplyText(e.target.value)} autoFocus
                              onKeyDown={e => { if (e.key === "Enter") enviarResposta(c.id); if (e.key === "Escape") { e.stopPropagation(); setReplyOpen(null); setReplyText(""); } }}
                              placeholder={`Responder @${c.username || ""}…`}
                              className="bg-muted text-foreground border-border"
                              style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12.5 }}
                              data-testid="input-comment-reply"
                            />
                            <button onClick={() => enviarResposta(c.id)} disabled={sending || !replyText.trim()}
                              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: sending || !replyText.trim() ? 0.6 : 1 }}
                              data-testid="button-send-reply">{sending ? "…" : "Enviar"}</button>
                          </div>
                        ) : (
                          <button onClick={() => { setReplyOpen(c.id); setReplyText(""); }} className="text-muted-foreground"
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, padding: "4px 0 0", fontWeight: 600 }} data-testid="button-open-reply">
                            Responder
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 14 }}>
            <p className="text-foreground" style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>⚡ Automações neste post</p>
            {flows.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <p className="text-muted-foreground" style={{ fontSize: 12, margin: "0 0 10px" }}>Nenhuma automação vinculada a este post.</p>
                <p className="text-muted-foreground" style={{ fontSize: 11 }}>
                  Crie um fluxo na aba <strong>Automações</strong> e vincule este post para respostas automáticas.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {flows.map(f => {
                  const tipo = TIPOS.find(t => t.value === f.tipo);
                  return (
                    <div key={f.id} className="bg-muted border border-border" style={{ padding: "8px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{tipo?.icon}</span>
                      <div>
                        <p className="text-foreground" style={{ fontSize: 12, fontWeight: 500, margin: 0 }}>{f.nome}</p>
                        <p className="text-muted-foreground" style={{ fontSize: 11, margin: 0 }}>{tipo?.label}</p>
                      </div>
                      <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", borderRadius: 20, background: f.ativo ? "rgba(34,197,94,0.15)" : undefined, color: f.ativo ? "#22c55e" : undefined }} className={f.ativo ? "" : "bg-muted text-muted-foreground"}>
                        {f.ativo ? "Ativo" : "Pausado"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: 12 }}>
            <p className="text-muted-foreground" style={{ fontSize: 10 }}>ID do post: {post.id}</p>
          </div>
          </div>{/* fim corpo rolável */}

          {/* Footer: métricas + abrir no Instagram */}
          <div className="border-t border-border shrink-0 text-muted-foreground" style={{ padding: "10px 16px", display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
            <span>❤️ {post.likeCount}</span>
            <span>💬 {post.commentsCount}</span>
            <a href={post.permalink} target="_blank" rel="noopener noreferrer" style={{ color: "#E1306C", textDecoration: "none", marginLeft: "auto", fontWeight: 600 }}>Abrir no Instagram ↗</a>
          </div>
        </div>{/* fim painel direito */}
      </div>{/* fim container */}
    </div>,
    document.body
  );
}

function FlowsTab({ presetPostId, onPresetConsumed }: { presetPostId?: string; onPresetConsumed?: () => void }) {
  const queryClient = useQueryClient();

  const { data: flowsData, isLoading: flowsLoading } = useQuery<any[]>({
    queryKey: ["/api/insta-prospect/flows"],
    staleTime: 15000,
  });
  const flows = Array.isArray(flowsData) ? flowsData : [];

  const { data: statsData } = useQuery<any>({
    queryKey: ["/api/insta-prospect/stats"],
    staleTime: 30000,
  });

  const { data: postsData } = useQuery<any>({
    queryKey: ["/api/instagram/posts"],
    staleTime: 60000,
  });
  const posts = postsData?.posts || [];

  const [showModal, setShowModal] = useState(false);
  const [editingFlow, setEditingFlow] = useState<any>(null);
  const [form, setForm] = useState({
    nome: "", tipo: "comment_to_dm",
    commentEnabled: true, dmEnabled: false, storyEnabled: false,
    keyword: "", keywordMatchType: "contains",
    dmKeyword: "", dmKeywordMatchType: "contains",
    storyFirstMessage: "",
    publicReply: "Oi {{username}}! Te mandei uma DM 😊", firstMessage: "Oi {{username}}! Obrigado pelo contato...",
    commentReplyMode: "static" as string, commentAiPrompt: "", postContext: "",
    firstMessageMediaUrl: "", firstMessageMediaType: "" as string,
    aiPersona: "vendedor", aiSystemPrompt: "", aiObjective: "qualificar_lead",
    aiModel: "gpt-4o-mini", aiTemperature: 0.7, aiMaxTokens: 300,
    finalAction: "atribuir_agente", autoTags: [] as string[],
    tagInput: "", postId: "", delaySeconds: 0,
  });
  const [modalTab, setModalTab] = useState<"config" | "gpt">("config");
  const [sections, setSections] = useState({ triggers: true, welcome: false, delay: false, prompt: false, actions: false, gptConfig: false });
  const [presetHandled, setPresetHandled] = useState(false);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const publicReplyRef = useRef<HTMLInputElement>(null);
  const firstMessageRef = useRef<HTMLTextAreaElement>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const { data: crmTags } = useQuery<Array<{ id: number; nome: string; cor: string }>>({
    queryKey: ["/api/lead-tags"],
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (presetPostId && !presetHandled && !flowsLoading) {
      openNew(presetPostId);
      setPresetHandled(true);
      onPresetConsumed?.();
    }
  }, [presetPostId, flowsLoading, presetHandled]);

  function invalidateFlows() {
    queryClient.invalidateQueries({ queryKey: ["/api/insta-prospect/flows"] });
    queryClient.invalidateQueries({ queryKey: ["/api/insta-prospect/stats"] });
  }

  function openNew(presetPostId?: string) {
    setEditingFlow(null);
    setForm({
      nome: "", tipo: "comment_to_dm",
      commentEnabled: !!presetPostId, dmEnabled: false, storyEnabled: false,
      keyword: "", keywordMatchType: "contains",
      dmKeyword: "", dmKeywordMatchType: "contains",
      storyFirstMessage: "",
      publicReply: "Oi {{username}}! Te mandei uma DM 😊", firstMessage: "Oi {{username}}! Obrigado pelo contato...",
      commentReplyMode: "static", commentAiPrompt: "", postContext: "",
      firstMessageMediaUrl: "", firstMessageMediaType: "",
      aiPersona: "personalizado",
      aiSystemPrompt: "Você é um assistente simpático e profissional. Responda de forma cordial e objetiva, ajudando o usuário com suas dúvidas.",
      aiObjective: "qualificar_lead",
      aiModel: "gpt-4o-mini", aiTemperature: 0.7, aiMaxTokens: 300,
      finalAction: "atribuir_agente", autoTags: [],
      tagInput: "", postId: presetPostId || "", delaySeconds: 0,
    });
    setModalTab("config");
    setSections({ triggers: true, welcome: false, delay: false, prompt: false, actions: false, gptConfig: false });
    setShowModal(true);
  }

  function openEdit(flow: any) {
    setEditingFlow(flow);
    setForm({
      ...flow,
      commentEnabled: flow.commentEnabled ?? (flow.tipo === "comment_to_dm"),
      dmEnabled: flow.dmEnabled ?? (flow.tipo === "dm_received"),
      storyEnabled: flow.storyEnabled ?? (flow.tipo === "story_mention"),
      dmKeyword: flow.dmKeyword || "",
      dmKeywordMatchType: flow.dmKeywordMatchType || "contains",
      storyFirstMessage: flow.storyFirstMessage || "",
      commentReplyMode: flow.commentReplyMode || "static",
      commentAiPrompt: flow.commentAiPrompt || "",
      postContext: flow.postContext || "",
      firstMessageMediaUrl: flow.firstMessageMediaUrl || "",
      firstMessageMediaType: flow.firstMessageMediaType || "",
      aiModel: flow.aiModel || "gpt-4o-mini",
      aiTemperature: flow.aiTemperature ?? 0.7,
      aiMaxTokens: flow.aiMaxTokens ?? 300,
      tagInput: "", autoTags: flow.autoTags || [], postId: flow.postId || "", delaySeconds: flow.delaySeconds || 0,
    });
    setModalTab("config");
    setSections({ triggers: true, welcome: false, delay: false, prompt: false, actions: false, gptConfig: false });
    setShowModal(true);
  }

  async function saveFlow() {
    if (!form.commentEnabled && !form.dmEnabled && !form.storyEnabled) {
      setActionError("Ative pelo menos uma funcionalidade (Comentário, DM ou Stories).");
      return;
    }
    const { tagInput, ...payload } = form;
    setSaving(true);
    setActionError("");
    try {
      if (editingFlow) {
        await apiRequest("PATCH", `/api/insta-prospect/flows/${editingFlow.id}`, payload);
      } else {
        await apiRequest("POST", "/api/insta-prospect/flows", payload);
      }
      setShowModal(false);
      invalidateFlows();
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("401") || msg.includes("Sessao expirada")) {
        setActionError("Sessão expirada. Faça login novamente.");
      } else {
        console.error("[InstaProspect] saveFlow error:", msg);
        setActionError(msg || "Erro ao salvar fluxo. Tente novamente.");
      }
    }
    setSaving(false);
  }

  async function toggleFlow(id: string) {
    setTogglingIds(prev => new Set(prev).add(id));
    try {
      await apiRequest("PATCH", `/api/insta-prospect/flows/${id}/toggle`);
      invalidateFlows();
    } catch {
      setActionError("Erro ao alterar status do fluxo.");
      setTimeout(() => setActionError(""), 4000);
    }
    setTimeout(() => {
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 400);
  }

  async function deleteFlow(id: string) {
    if (!confirm("Excluir este fluxo?")) return;
    setRemovingIds(prev => new Set(prev).add(id));
    try {
      await new Promise(r => setTimeout(r, 250));
      await apiRequest("DELETE", `/api/insta-prospect/flows/${id}`);
      invalidateFlows();
    } catch {
      setActionError("Erro ao excluir fluxo.");
      setTimeout(() => setActionError(""), 4000);
    }
    setTimeout(() => {
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 50);
  }

  async function duplicateFlow(id: string) {
    try {
      await apiRequest("POST", `/api/insta-prospect/flows/${id}/duplicate`);
      invalidateFlows();
    } catch {
      setActionError("Erro ao duplicar fluxo.");
      setTimeout(() => setActionError(""), 4000);
    }
  }

  function exportFlow(flow: any) {
    const exportData = {
      _chatbanana_instagram: true, version: 1, exportedAt: new Date().toISOString(),
      nome: flow.nome, tipo: flow.tipo,
      commentEnabled: flow.commentEnabled, dmEnabled: flow.dmEnabled, storyEnabled: flow.storyEnabled,
      keyword: flow.keyword, keywordMatchType: flow.keywordMatchType,
      dmKeyword: flow.dmKeyword, dmKeywordMatchType: flow.dmKeywordMatchType,
      postId: flow.postId, publicReply: flow.publicReply,
      commentReplyMode: flow.commentReplyMode, commentAiPrompt: flow.commentAiPrompt, postContext: flow.postContext,
      firstMessage: flow.firstMessage, storyFirstMessage: flow.storyFirstMessage,
      aiPrompt: flow.aiPrompt, aiModel: flow.aiModel, personaId: flow.personaId,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `instagram-${flow.nome.replace(/\s+/g, "-").toLowerCase()}.json`; el.click();
    URL.revokeObjectURL(url);
  }

  function handlePersonaChange(persona: string) {
    const p = PERSONAS.find(x => x.value === persona);
    setForm(f => ({ ...f, aiPersona: persona, aiSystemPrompt: p?.prompt || f.aiSystemPrompt }));
  }

  function addTag() {
    if (!form.tagInput.trim()) return;
    setForm(f => ({ ...f, autoTags: [...f.autoTags, f.tagInput.trim()], tagInput: "" }));
  }

  function removeTag(tag: string) {
    setForm(f => ({ ...f, autoTags: f.autoTags.filter(t => t !== tag) }));
  }

  const activeFlows = flows.filter((f: any) => f.ativo);
  const pausedFlows = flows.filter((f: any) => !f.ativo);
  const [flowSubTab, setFlowSubTab] = useState<"ativos" | "pausados">("ativos");
  const displayFlows = flowSubTab === "ativos" ? activeFlows : pausedFlows;

  if (flowsLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 0", gap: 8 }}>
        <IspRingSpinner size={28} />
        <span className="text-muted-foreground" style={{ fontSize: 12 }}>Carregando fluxos...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: "0.5rem 0" }}>
      {actionError && (
        <div style={{ marginBottom: 12, padding: "8px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 12 }} data-testid="text-action-error">
          {actionError}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "6px 4px", borderRadius: 8 }} className="bg-muted/30">
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {([
            { key: "ativos" as const, label: "Ativos", count: activeFlows.length, dotColor: "#E1306C" },
            { key: "pausados" as const, label: "Pausados", count: pausedFlows.length, dotColor: "#FED30E" },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFlowSubTab(tab.key)}
              data-testid={`flow-subtab-${tab.key}`}
              style={{
                // Bruno 2026-06-11: pill ATIVA TRANSLÚCIDA (volta ao inicial) — banana-50
                // tint + borda/texto da cor do tema. Suave, não sólido.
                display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", border: flowSubTab === tab.key ? "1px solid hsl(var(--primary) / 0.45)" : "1px solid transparent", background: flowSubTab === tab.key ? "var(--theme-tint-50, var(--banana-50))" : "transparent", color: flowSubTab === tab.key ? "hsl(var(--primary))" : undefined, boxShadow: "none", transition: "all 0.15s",
              }}
              className={flowSubTab === tab.key ? "" : "text-muted-foreground"}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: tab.dotColor, flexShrink: 0 }} />
              {tab.label}
              <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 8, fontWeight: 700, lineHeight: "14px", ...(flowSubTab === tab.key ? { background: "var(--brand-brown-tint)", color: "var(--brand-brown)" } : {}) }} className={flowSubTab === tab.key ? "" : "bg-muted text-muted-foreground"}>{tab.count}</span>
            </button>
          ))}
        </div>
        <button onClick={() => openNew()} data-testid="button-new-flow" style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, background: "#E1306C", border: "none", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 0 12px rgba(225,48,108,0.3)" }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>+</span> Novo Fluxo
        </button>
      </div>

      {displayFlows.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 0", gap: 12 }} className="text-muted-foreground" data-testid="empty-state">
          <IgIcon size={48} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{flowSubTab === "ativos" ? "Nenhum fluxo ativo" : "Nenhum fluxo pausado"}</span>
          <span style={{ fontSize: 11, maxWidth: 300, textAlign: "center", lineHeight: 1.5 }}>
            {flowSubTab === "ativos"
              ? "Crie um fluxo ou ative um pausado para vê-lo aqui"
              : "Fluxos pausados aparecerão aqui"}
          </span>
          {flowSubTab === "ativos" && (
            <button onClick={() => openNew()} style={{ padding: "8px 20px", borderRadius: 8, background: "#E1306C", border: "none", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
              Criar primeiro fluxo
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {displayFlows.map((flow: any, idx: number) => {
            const linkedPost = posts.find((p: any) => p.id === flow.postId);
            const persona = PERSONAS.find(p => p.value === flow.aiPersona);
            const isRemoving = removingIds.has(flow.id);
            const isToggling = togglingIds.has(flow.id);
            const caps = [
              flow.commentEnabled && { icon: "💬", label: "Comentario" },
              flow.dmEnabled && { icon: "📩", label: "DM" },
              flow.storyEnabled && { icon: "⭐", label: "Stories" },
            ].filter(Boolean) as { icon: string; label: string }[];
            return (
              <div
                key={flow.id}
                onClick={() => !isRemoving && openEdit(flow)}
                className={`bg-card border border-border hover:border-[#E1306C]/50 group isp-card-toggle ${isRemoving ? "isp-card-exit" : "isp-card-enter"} ${isToggling ? "toggling" : ""}`}
                style={{ borderRadius: 12, padding: 12, cursor: isRemoving ? "default" : "pointer", position: "relative", overflow: "hidden", animationDelay: isRemoving ? "0s" : `${idx * 0.04}s` }}
                data-testid={`flow-card-${flow.id}`}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6, gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: flow.ativo ? "rgba(225,48,108,0.1)" : "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.3s" }}>
                      <IgIcon size={14} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="text-foreground" data-testid={`text-flow-name-${flow.id}`}>{flow.nome}</div>
                      <div style={{ display: "flex", gap: 3, marginTop: 2 }} data-testid={`flow-caps-${flow.id}`}>
                        {caps.map(c => (
                          <span key={c.label} data-testid={`badge-${c.label.toLowerCase()}-${flow.id}`} style={{ fontSize: 8, padding: "0px 5px", borderRadius: 10, background: "rgba(225,48,108,0.08)", color: "#E1306C", fontWeight: 600 }}>{c.icon} {c.label}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, transition: "all 0.3s" }}>
                    {flow.ativo ? (
                      <span className="automation-active-indicator automation-active-indicator-sm automation-active-indicator-pink" style={{ width: 12, height: 12 }}>
                        <span className="dot-core" />
                        <span className="dot-ring" />
                        <span className="dot-ring-2" />
                      </span>
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FED30E", boxShadow: "0 0 6px #FED30E" }} />
                    )}
                    <span style={{ fontSize: 8, fontWeight: 800, color: flow.ativo ? "#E1306C" : "#FED30E", transition: "color 0.3s" }}>{flow.ativo ? "Ativo" : "Pausado"}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  {persona && (
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 20, border: "1px solid var(--border)" }} className="text-muted-foreground">
                      🤖 {persona.label}
                    </span>
                  )}
                  {linkedPost && (
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 20, border: "1px solid var(--border)" }} className="text-muted-foreground">
                      📌 Post vinculado
                    </span>
                  )}
                  <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 20, border: "1px solid var(--border)" }} className="text-muted-foreground">
                    ⚡ {(flow.totalTriggers || 0).toLocaleString()} acion.
                  </span>
                  <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 20, border: "1px solid var(--border)" }} className="text-muted-foreground">
                    👤 {(flow.totalLeads || 0).toLocaleString()} leads
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid var(--border)", opacity: 0.6 }} className="border-border/30">
                  <div style={{ display: "flex", gap: 2 }}>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(flow); }} title="Editar" data-testid={`button-edit-${flow.id}`} style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", fontSize: 11 }} className="text-muted-foreground hover:text-foreground hover:bg-muted">
                      ✏️
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); duplicateFlow(flow.id); }} title="Duplicar" data-testid={`button-dup-${flow.id}`} style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", fontSize: 11 }} className="text-muted-foreground hover:text-foreground hover:bg-muted">
                      📋
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); exportFlow(flow); }} title="Exportar como JSON" data-testid={`button-export-${flow.id}`} style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", fontSize: 11 }} className="text-muted-foreground hover:text-foreground hover:bg-muted">
                      ⬇️
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteFlow(flow.id); }} title="Excluir" data-testid={`button-delete-${flow.id}`} style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: "#ef4444" }}>
                      🗑️
                    </button>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFlow(flow.id); }}
                    data-testid={`button-toggle-${flow.id}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, height: 20, padding: "0 8px", borderRadius: 20, fontSize: 9, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${flow.ativo ? "#FED30E" : "#E1306C"}`,
                      color: flow.ativo ? "#FED30E" : "#E1306C",
                      background: "transparent",
                      transition: "all 0.3s",
                    }}
                  >
                    {flow.ativo ? "⏸ Pausar" : "▶ Ativar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (() => {
        const renderSection = (id: keyof typeof sections, label: string, icon: string, children: any) => (
          <div key={id}>
            <button type="button" onClick={() => setSections(s => ({ ...s, [id]: !s[id] }))} className="text-foreground hover:bg-muted/50" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600 }} data-testid={`section-${id}`}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
              <span style={{ fontSize: 10, transition: "transform 0.2s", transform: sections[id] ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
            </button>
            {sections[id] && <div style={{ padding: "4px 10px 10px 10px" }}>{children}</div>}
          </div>
        );

        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px 16px" }}>
          <div className="bg-card border border-border" style={{ borderRadius: 16, width: "100%", maxWidth: 580, maxHeight: "100%", display: "flex", flexDirection: "column" }} data-testid="modal-flow-form">
            <div style={{ padding: "1.25rem 1.5rem 0", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 className="text-foreground" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{editingFlow ? "Editar fluxo" : "Novo fluxo de prospecção"}</h2>
                <button onClick={() => setShowModal(false)} className="text-muted-foreground" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }} data-testid="button-close-modal">✕</button>
              </div>

              <div>
                <label className="text-muted-foreground" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>Nome do fluxo</label>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Promoção de Julho" className="bg-muted text-foreground border-border" data-testid="input-nome" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 13 }} />
              </div>

              {/* Redesign Norte: pílula seg-tab (azul sólido). Antes: underline rosa #E1306C. */}
              <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
                {([
                  { key: "config" as const, label: "Configurações", icon: "⚙️" },
                  { key: "gpt" as const, label: "IA / GPT", icon: "🤖" },
                ]).map(tab => (
                  <button key={tab.key} type="button" onClick={() => setModalTab(tab.key)} data-testid={`modal-tab-${tab.key}`}
                    className={`seg-tab ${modalTab === tab.key ? "seg-tab-active" : ""}`}>
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 1.5rem 1.5rem" }}>
              {modalTab === "config" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {renderSection("triggers", "Funcionalidades da IA", "📡", <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {TIPOS.map(t => {
                        const capKey = t.value === "comment_to_dm" ? "commentEnabled" : t.value === "dm_received" ? "dmEnabled" : "storyEnabled";
                        const isOn = form[capKey];
                        return (
                          <div key={t.value} data-testid={`cap-${t.value}`}>
                            <div onClick={() => setForm(f => ({ ...f, [capKey]: !f[capKey] }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${isOn ? "#E1306C" : "var(--border)"}`, cursor: "pointer", background: isOn ? "rgba(225,48,108,0.06)" : undefined, transition: "all 0.2s" }} className={isOn ? "" : "bg-muted"}>
                              <span style={{ fontSize: 18, flexShrink: 0 }}>{t.icon}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: isOn ? "#E1306C" : undefined }} className={isOn ? "" : "text-foreground"}>{t.label}</div>
                                <div style={{ fontSize: 10 }} className="text-muted-foreground">{t.desc}</div>
                              </div>
                              <div style={{ width: 36, height: 20, borderRadius: 10, background: isOn ? "#E1306C" : "var(--muted)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: isOn ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                              </div>
                            </div>
                            {isOn && t.value === "comment_to_dm" && (
                              <div style={{ padding: "10px 12px 4px 42px", display: "flex", flexDirection: "column", gap: 10 }}>
                                {posts.length > 0 && (
                                  <div>
                                    <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>Vincular a publicação</label>
                                    <select value={form.postId} onChange={e => setForm(f => ({ ...f, postId: e.target.value }))} className="bg-muted text-foreground border-border" data-testid="select-post-id" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12 }}>
                                      <option value="">Todos os posts (qualquer comentário)</option>
                                      {posts.map((p: any) => (<option key={p.id} value={p.id}>{(p.caption || "(sem legenda)").slice(0, 50)} — {new Date(p.timestamp).toLocaleDateString("pt-BR")}</option>))}
                                    </select>
                                  </div>
                                )}
                                <div>
                                  <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>Palavra-chave no comentário</label>
                                  <input value={form.keyword} onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))} placeholder="Ex: QUERO, EU QUERO — vazio = qualquer" className="bg-muted text-foreground border-border" data-testid="input-keyword" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12 }} />
                                </div>
                                <div>
                                  <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 5, fontWeight: 600 }}>Resposta pública no comentário</label>
                                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                                    {[
                                      { value: "static", label: "Texto fixo", icon: "📝" },
                                      { value: "ai", label: "IA (Assistente Norte)", icon: "🤖" },
                                    ].map(opt => (
                                      <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, commentReplyMode: opt.value }))} data-testid={`btn-reply-mode-${opt.value}`}
                                        style={{ padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${form.commentReplyMode === opt.value ? "#E1306C" : "var(--border)"}`, background: form.commentReplyMode === opt.value ? "rgba(225,48,108,0.08)" : "transparent", color: form.commentReplyMode === opt.value ? "#E1306C" : undefined, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                                        className={form.commentReplyMode === opt.value ? "" : "text-muted-foreground"}>
                                        <span>{opt.icon}</span> {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                  {form.commentReplyMode === "static" ? (
                                    <>
                                      <input ref={publicReplyRef} value={form.publicReply} onChange={e => setForm(f => ({ ...f, publicReply: e.target.value }))} placeholder='Ex: Oi {{username}}! Te mandei uma DM 😊' className="bg-muted text-foreground border-border" data-testid="input-public-reply" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12 }} />
                                      <TextToolbar inputRef={publicReplyRef} field="publicReply" setForm={setForm} />
                                    </>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                      <div>
                                        <label className="text-muted-foreground" style={{ fontSize: 10.5, display: "block", marginBottom: 3 }}>Contexto do post (sobre o que é o post)</label>
                                        <textarea value={form.postContext} onChange={e => setForm(f => ({ ...f, postContext: e.target.value }))} placeholder="Ex: Post sobre a promoção do mês, com condições especiais e benefícios exclusivos para novos clientes." rows={2} className="bg-muted text-foreground border-border" data-testid="input-post-context" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12, resize: "vertical" }} />
                                      </div>
                                      <div>
                                        <label className="text-muted-foreground" style={{ fontSize: 10.5, display: "block", marginBottom: 3 }}>Prompt da IA para comentários</label>
                                        <textarea value={form.commentAiPrompt} onChange={e => setForm(f => ({ ...f, commentAiPrompt: e.target.value }))} placeholder="Ex: Você é um atendente simpático da nossa empresa. Responda comentários de forma curta e engajante, incentivando o usuário a entrar em contato por DM para saber mais." rows={3} className="bg-muted text-foreground border-border" data-testid="input-comment-ai-prompt" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12, resize: "vertical" }} />
                                        <p className="text-muted-foreground" style={{ fontSize: 10, marginTop: 3 }}>A IA usará o contexto do post + este prompt para gerar respostas inteligentes a cada comentário.</p>
                                      </div>
                                      <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(225,48,108,0.04)", border: "1px dashed rgba(225,48,108,0.25)" }}>
                                        <div style={{ fontSize: 10.5, fontWeight: 600, color: "#E1306C", marginBottom: 3 }}>🤖 Como funciona</div>
                                        <p className="text-muted-foreground" style={{ fontSize: 10, lineHeight: 1.5 }}>A cada comentário recebido, a Assistente Norte analisa o contexto do post e do comentário para gerar uma resposta personalizada e natural. A resposta é publicada automaticamente como resposta pública ao comentário.</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>Mensagem enviada na DM</label>
                                  <textarea ref={firstMessageRef} value={form.firstMessage} onChange={e => setForm(f => ({ ...f, firstMessage: e.target.value }))} placeholder="Ex: Oi {{username}}! Obrigado pelo contato 😊" rows={2} className="bg-muted text-foreground border-border" data-testid="input-first-message-inline" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12, resize: "vertical" }} />
                                  <TextToolbar inputRef={firstMessageRef} field="firstMessage" setForm={setForm} />
                                </div>
                                <div style={{ padding: "8px 10px", borderRadius: 8, border: "1px dashed var(--border)" }} className="bg-muted/30">
                                  <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 5, fontWeight: 600 }}>📎 Anexo na DM (opcional)</label>
                                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                                    {[
                                      { value: "", label: "Nenhum", icon: "✕" },
                                      { value: "image", label: "Imagem", icon: "🖼️" },
                                      { value: "video", label: "Vídeo", icon: "🎬" },
                                      { value: "link", label: "Link", icon: "🔗" },
                                    ].map(opt => (
                                      <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, firstMessageMediaType: opt.value, firstMessageMediaUrl: opt.value ? f.firstMessageMediaUrl : "" }))} data-testid={`btn-media-inline-${opt.value || "none"}`}
                                        style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${form.firstMessageMediaType === opt.value ? "#E1306C" : "var(--border)"}`, background: form.firstMessageMediaType === opt.value ? "rgba(225,48,108,0.08)" : "transparent", color: form.firstMessageMediaType === opt.value ? "#E1306C" : undefined }}
                                        className={form.firstMessageMediaType === opt.value ? "" : "text-muted-foreground"}>
                                        {opt.icon} {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                  {form.firstMessageMediaType && (
                                    <div>
                                      <input value={form.firstMessageMediaUrl} onChange={e => setForm(f => ({ ...f, firstMessageMediaUrl: e.target.value }))} placeholder={form.firstMessageMediaType === "image" ? "https://exemplo.com/imagem.jpg" : form.firstMessageMediaType === "video" ? "https://exemplo.com/video.mp4" : "https://exemplo.com/pagina"} className="bg-muted text-foreground border-border" data-testid="input-media-url-inline" style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 11 }} />
                                      {form.firstMessageMediaUrl && form.firstMessageMediaType === "image" && (
                                        <div style={{ marginTop: 6, borderRadius: 6, overflow: "hidden", maxHeight: 80 }}>
                                          <img src={form.firstMessageMediaUrl} alt="Preview" style={{ width: "100%", objectFit: "cover", maxHeight: 80 }} onError={e => (e.currentTarget.style.display = "none")} />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            {isOn && t.value === "dm_received" && (
                              <div style={{ padding: "10px 12px 4px 42px" }}>
                                <p className="text-muted-foreground" style={{ fontSize: 10.5, lineHeight: 1.5 }}>A IA responde qualquer DM recebida usando o prompt configurado na aba "IA / GPT".</p>
                              </div>
                            )}
                            {isOn && t.value === "story_mention" && (
                              <div style={{ padding: "10px 12px 4px 42px" }}>
                                <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 3 }}>Mensagem ao ser mencionado nos Stories</label>
                                <input value={form.storyFirstMessage} onChange={e => setForm(f => ({ ...f, storyFirstMessage: e.target.value }))} placeholder="Oi {{username}}! Obrigado por marcar a gente!" className="bg-muted text-foreground border-border" data-testid="input-story-first-message" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12 }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!form.commentEnabled && !form.dmEnabled && !form.storyEnabled && (
                      <p style={{ fontSize: 11, marginTop: 6, color: "#ef4444" }}>Ative pelo menos uma funcionalidade.</p>
                    )}
                  </>)}

                  {renderSection("welcome", "Mensagem de boas-vindas", "💬", <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Mensagem de boas-vindas (DM)</label>
                        <textarea ref={firstMessageRef} value={form.firstMessage} onChange={e => setForm(f => ({ ...f, firstMessage: e.target.value }))} placeholder="Ex: Oi {{username}}! Obrigado pelo contato 😊" rows={2} className="bg-muted text-foreground border-border" data-testid="input-first-message" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 13, resize: "vertical" }} />
                        <TextToolbar inputRef={firstMessageRef} field="firstMessage" setForm={setForm} />
                        <p className="text-xs text-muted-foreground mt-1">Enviada imediatamente ao contato. Depois a IA assume.</p>
                      </div>
                      <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--border)" }} className="bg-muted/30">
                        <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 6, fontWeight: 600 }}>📎 Anexo na primeira DM (opcional)</label>
                        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                          {[
                            { value: "", label: "Nenhum", icon: "✕" },
                            { value: "image", label: "Imagem", icon: "🖼️" },
                            { value: "video", label: "Vídeo", icon: "🎬" },
                            { value: "link", label: "Link", icon: "🔗" },
                          ].map(opt => (
                            <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, firstMessageMediaType: opt.value, firstMessageMediaUrl: opt.value ? f.firstMessageMediaUrl : "" }))} data-testid={`btn-media-${opt.value || "none"}`}
                              style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${form.firstMessageMediaType === opt.value ? "#E1306C" : "var(--border)"}`, background: form.firstMessageMediaType === opt.value ? "rgba(225,48,108,0.08)" : "transparent", color: form.firstMessageMediaType === opt.value ? "#E1306C" : undefined }}
                              className={form.firstMessageMediaType === opt.value ? "" : "text-muted-foreground"}>
                              {opt.icon} {opt.label}
                            </button>
                          ))}
                        </div>
                        {form.firstMessageMediaType && (
                          <div>
                            <input value={form.firstMessageMediaUrl} onChange={e => setForm(f => ({ ...f, firstMessageMediaUrl: e.target.value }))} placeholder={form.firstMessageMediaType === "image" ? "https://exemplo.com/imagem.jpg" : form.firstMessageMediaType === "video" ? "https://exemplo.com/video.mp4" : "https://exemplo.com/pagina"} className="bg-muted text-foreground border-border" data-testid="input-media-url" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 12 }} />
                            {form.firstMessageMediaUrl && form.firstMessageMediaType === "image" && (
                              <div style={{ marginTop: 8, borderRadius: 8, overflow: "hidden", maxHeight: 120 }}>
                                <img src={form.firstMessageMediaUrl} alt="Preview" style={{ width: "100%", objectFit: "cover", maxHeight: 120 }} onError={e => (e.currentTarget.style.display = "none")} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>)}

                  {renderSection("delay", "Pausa entre mensagens", "⏱️", <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="range" min={0} max={120} step={5} value={form.delaySeconds} onChange={e => setForm(f => ({ ...f, delaySeconds: Number(e.target.value) }))} data-testid="input-delay-range" style={{ flex: 1 }} />
                      <input type="number" min={0} max={120} value={form.delaySeconds} onChange={e => setForm(f => ({ ...f, delaySeconds: Math.max(0, Math.min(120, Number(e.target.value) || 0)) }))} data-testid="input-delay-seconds" className="bg-muted text-foreground border-border" style={{ width: 60, padding: "6px 8px", borderRadius: 8, border: "0.5px solid", fontSize: 13, textAlign: "center" }} />
                      <span className="text-muted-foreground" style={{ fontSize: 12 }}>seg</span>
                    </div>
                    <p className="text-muted-foreground" style={{ fontSize: 11, marginTop: 3 }}>{form.delaySeconds === 0 ? "Sem pausa — respostas instantâneas." : form.delaySeconds <= 3 ? "Pausa curta — parece mais humano." : "Boa escolha — simula digitação natural."}</p>
                  </>)}

                  {renderSection("actions", "Ações e tags", "🏷️", <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Quando o lead for qualificado</label>
                        <select value={form.finalAction} onChange={e => setForm(f => ({ ...f, finalAction: e.target.value }))} className="bg-muted text-foreground border-border" data-testid="select-final-action" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 13 }}>
                          <option value="atribuir_agente">Transferir para atendente humano</option>
                          <option value="criar_deal">Criar card no Pipeline</option>
                          <option value="apenas_salvar">Apenas salvar lead no CRM</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Tags automáticas no lead</label>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                          {form.autoTags.map(tag => {
                            const tagData = (crmTags || []).find(t => t.nome === tag);
                            const tagColor = tagData?.cor || "#E1306C";
                            return (<span key={tag} onClick={() => removeTag(tag)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: `${tagColor}14`, color: tagColor, border: `0.5px solid ${tagColor}40`, cursor: "pointer" }} data-testid={`tag-${tag}`}>{tag} ✕</span>);
                          })}
                        </div>
                        <div style={{ position: "relative" }} ref={tagDropdownRef}>
                          <button type="button" onClick={() => setTagDropdownOpen(!tagDropdownOpen)} className="bg-muted text-foreground border-border" data-testid="button-select-tag" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 13, textAlign: "left", cursor: "pointer" }}>
                            {(crmTags || []).filter(t => !form.autoTags.includes(t.nome)).length === 0 ? "Todas as tags selecionadas" : "Selecionar tags do CRM..."}
                          </button>
                          {tagDropdownOpen && (
                            <div className="bg-popover border-border" style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: 4, borderRadius: 8, border: "0.5px solid", zIndex: 50, maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
                              {(crmTags || []).filter(t => !form.autoTags.includes(t.nome)).length === 0 ? (
                                <div className="text-muted-foreground" style={{ padding: "10px 12px", fontSize: 12 }}>{(crmTags || []).length === 0 ? "Nenhuma tag cadastrada no CRM" : "Todas as tags já foram adicionadas"}</div>
                              ) : (
                                (crmTags || []).filter(t => !form.autoTags.includes(t.nome)).map(tag => (
                                  <button key={tag.id} type="button" onClick={() => { setForm(f => ({ ...f, autoTags: [...f.autoTags, tag.nome] })); setTagDropdownOpen(false); }} className="text-foreground hover:bg-secondary/60" data-testid={`dropdown-tag-${tag.id}`} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left" }}>
                                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: tag.cor, flexShrink: 0 }} />
                                    {tag.nome}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>)}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <label className="text-muted-foreground" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                      Prompt da IA (Assistente Norte)
                    </label>
                    <textarea ref={aiPromptRef} value={form.aiSystemPrompt} onChange={e => setForm(f => ({ ...f, aiSystemPrompt: e.target.value }))} rows={5} placeholder="Descreva como a IA deve se comportar nas DMs. Ex: Você é um consultor de vendas simpático..." className="bg-muted text-foreground border-border" data-testid="input-system-prompt" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "0.5px solid", fontSize: 13, resize: "vertical", lineHeight: 1.6 }} />
                    <TextToolbar inputRef={aiPromptRef} field="aiSystemPrompt" setForm={setForm} />
                    <p className="text-muted-foreground" style={{ fontSize: 11, marginTop: 4 }}>Dica: inclua LEAD_QUALIFICADO: [resumo] para a IA sinalizar quando o lead estiver qualificado.</p>
                  </div>

                  <div style={{ borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }} className="bg-muted/20">
                    <button type="button" onClick={() => setSections(s => ({ ...s, gptConfig: !s.gptConfig }))} className="text-foreground hover:bg-muted/50" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 700 }} data-testid="section-gptConfig">
                      <span style={{ flex: 1, textAlign: "left" }}>Configurações do GPT</span>
                      <span style={{ fontSize: 10, transition: "transform 0.2s", transform: sections.gptConfig ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
                    </button>
                    {sections.gptConfig && <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                      <div>
                        <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 4, fontWeight: 600 }}>Modelo</label>
                        <select value={form.aiModel} onChange={e => setForm(f => ({ ...f, aiModel: e.target.value }))} className="bg-muted text-foreground border-border" data-testid="select-ai-model" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "0.5px solid", fontSize: 13 }}>
                          <option value="gpt-4o-mini">GPT-4o Mini (rápido, econômico)</option>
                          <option value="gpt-4o">GPT-4o (mais inteligente)</option>
                          <option value="gpt-4-turbo">GPT-4 Turbo (avançado)</option>
                          <option value="gpt-3.5-turbo">GPT-3.5 Turbo (básico)</option>
                        </select>
                      </div>

                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <label className="text-muted-foreground" style={{ fontSize: 11, fontWeight: 600 }}>Temperatura: {form.aiTemperature.toFixed(1)}</label>
                          <span className="text-muted-foreground" style={{ fontSize: 10 }}>
                            {form.aiTemperature <= 0.3 ? "Preciso e consistente" : form.aiTemperature <= 0.7 ? "Equilibrado" : form.aiTemperature <= 1.2 ? "Criativo" : "Muito criativo"}
                          </span>
                        </div>
                        <input type="range" min={0} max={2} step={0.1} value={form.aiTemperature} onChange={e => setForm(f => ({ ...f, aiTemperature: Number(e.target.value) }))} data-testid="input-ai-temperature" style={{ width: "100%", accentColor: "#E1306C" }} />
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="text-muted-foreground" style={{ fontSize: 9 }}>0.0 Preciso</span>
                          <span className="text-muted-foreground" style={{ fontSize: 9 }}>2.0 Criativo</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-muted-foreground" style={{ fontSize: 11, display: "block", marginBottom: 4, fontWeight: 600 }}>Max Tokens (tamanho da resposta)</label>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input type="range" min={50} max={2000} step={50} value={form.aiMaxTokens} onChange={e => setForm(f => ({ ...f, aiMaxTokens: Number(e.target.value) }))} data-testid="input-ai-max-tokens-range" style={{ flex: 1, accentColor: "#E1306C" }} />
                          <input type="number" min={50} max={2000} value={form.aiMaxTokens} onChange={e => setForm(f => ({ ...f, aiMaxTokens: Math.max(50, Math.min(2000, Number(e.target.value) || 300)) }))} data-testid="input-ai-max-tokens" className="bg-muted text-foreground border-border" style={{ width: 70, padding: "6px 8px", borderRadius: 8, border: "0.5px solid", fontSize: 13, textAlign: "center" }} />
                        </div>
                        <p className="text-muted-foreground" style={{ fontSize: 10, marginTop: 3 }}>
                          {form.aiMaxTokens <= 150 ? "Respostas curtas e objetivas." : form.aiMaxTokens <= 400 ? "Tamanho ideal para DMs." : "Respostas mais longas e detalhadas."}
                        </p>
                      </div>
                    </div>}
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: "12px 1.5rem 1.25rem", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              {actionError && <p style={{ fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{actionError}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowModal(false)} className="text-muted-foreground border-border" style={{ flex: 1, padding: "9px", borderRadius: 8, border: "0.5px solid", background: "transparent", fontSize: 13, cursor: "pointer" }} data-testid="button-cancel">
                  Cancelar
                </button>
                <button onClick={saveFlow} disabled={saving} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: saving ? "#999" : "#E1306C", color: "white", fontSize: 13, fontWeight: 500, cursor: saving ? "not-allowed" : "pointer" }} data-testid="button-save-flow">
                  {saving ? "Salvando..." : editingFlow ? "Salvar alterações" : "Criar fluxo"}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
