import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Brain, CreditCard, Smartphone,
  Zap, Eye, EyeOff, Copy, ExternalLink, FlaskConical,
  Save, Key, RefreshCw, FileText, Workflow, Plus,
  Trash2, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Shield, MessageCircle, X,
  Users, Calendar, BarChart3, Settings, Globe,
  Mail, Tag, Layers, Bot, BookOpen, Search,
} from "lucide-react";
import { OpenAIIcon, StripeIcon, InstagramIcon } from "@/components/brand-icons";
import { PageHeader } from "@/components/page/PageShell";

interface IntegrationField {
  label: string;
  key: string;
  value: string;
  placeholder: string;
  secret?: boolean;
}

interface IntegrationStats {
  msgs: string;
  rate: string;
  label: string;
}

interface Integration {
  id: string;
  name: string;
  desc: string;
  icon: typeof MessageCircle;
  color: string;
  bg: string;
  on: boolean;
  connected: boolean;
  fields: IntegrationField[];
  webhook: string | null;
  docs: string;
  stats: IntegrationStats | null;
}

const initialIntegrations: Integration[] = [
  {
    id: "openai", name: "OpenAI GPT-4o", desc: "Base de Conhecimento IA, sugestões de resposta, qualificação automática",
    icon: Brain, color: "#10a37f", bg: "rgba(16,163,127,.1)", on: true, connected: true,
    fields: [
      { label: "API Key", key: "openai_key", value: "sk-proj...", placeholder: "sk-proj-...", secret: true },
    ],
    webhook: null, docs: "https://platform.openai.com/docs",
    stats: { msgs: "1.247", rate: "1.8s", label: "tempo médio" },
  },
  {
    id: "stripe", name: "Stripe", desc: "Billing, assinaturas, checkout, portal do cliente",
    icon: CreditCard, color: "#6772e5", bg: "rgba(99,91,255,.1)", on: true, connected: true,
    fields: [
      { label: "Secret Key", key: "stripe_sk", value: "sk_live_...", placeholder: "sk_live_...", secret: true },
    ],
    webhook: "https://api.chatbananacrm.com/webhooks/stripe", docs: "https://stripe.com/docs",
    stats: { msgs: "R$1.491", rate: "100%", label: "cobrado este mês" },
  },
  {
    id: "instagram", name: "Instagram", desc: "DMs, comentários e prospecção com IA (InstaProspect)",
    icon: Globe, color: "#E1306C", bg: "rgba(225,48,108,.1)", on: true, connected: false,
    fields: [], webhook: null, docs: "https://developers.facebook.com/docs/instagram-api", stats: null,
  },
];

const ALLOWED_EVENTS = [
  { key: "lead.created", label: "Contato criado" },
  { key: "lead.updated", label: "Contato atualizado" },
  { key: "lead.won", label: "Contato ganho" },
  { key: "lead.lost", label: "Contato perdido" },
  { key: "message.received", label: "Mensagem recebida" },
  { key: "message.sent", label: "Mensagem enviada" },
  { key: "deal.moved", label: "Contato movido pipeline" },
  { key: "contact.created", label: "Contato criado" },
];

const TOKEN_PERMISSIONS = [
  { key: "leads:read", label: "Leitura de contatos" },
  { key: "leads:write", label: "Escrita de contatos" },
  { key: "messages:send", label: "Enviar mensagens" },
  { key: "contacts:read", label: "Leitura de contatos" },
  { key: "contacts:write", label: "Escrita de contatos" },
  { key: "prompts:read", label: "Leitura de prompts" },
];

type IntegTabId = "openai" | "stripe" | "instagram";
type IntegSubTab = "ativos" | "inativos";

const INTEG_CARDS: { id: IntegTabId; name: string; desc: string; color: string; bg: string; brandIcon: string }[] = [
  { id: "openai", name: "OpenAI GPT-4o", desc: "IA, sugestões e qualificação", color: "#10a37f", bg: "rgba(16,163,127,.08)", brandIcon: "openai" },
  { id: "stripe", name: "Stripe", desc: "Pagamentos e assinaturas", color: "#6772e5", bg: "rgba(99,91,255,.08)", brandIcon: "stripe" },
  { id: "instagram", name: "Instagram", desc: "DMs, comentários e InstaProspect", color: "#E1306C", bg: "rgba(225,48,108,.08)", brandIcon: "instagram" },
];

function IntegIcon({ id, size = 24 }: { id: string; size?: number }) {
  const cls = `w-[${size}px] h-[${size}px]`;
  if (id === "openai") return <OpenAIIcon className={cls} style={{ width: size, height: size }} />;
  if (id === "stripe") return <StripeIcon className={cls} style={{ width: size, height: size }} />;
  if (id === "instagram") return <InstagramIcon className={cls} style={{ width: size, height: size }} />;
  return <Workflow style={{ width: size, height: size }} />;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-primary/15 text-primary",
  POST: "bg-primary/15 text-tertiary-600 dark:text-tertiary-500",
  PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PATCH: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  DELETE: "bg-red-500/15 text-rose-600 dark:text-rose-400",
};

interface ApiParam { name: string; type: string; required: boolean; desc: string }
interface ApiEndpoint { method: string; path: string; desc: string; category: string; auth: string; params?: ApiParam[]; response?: string; example?: string }

const API_DOCS_CATEGORIES = [
  { id: "all", label: "Todos", icon: BookOpen },
  { id: "auth", label: "Autenticação", icon: Key },
  { id: "leads", label: "Contatos / CRM", icon: Users },
  { id: "contacts", label: "Contatos", icon: Mail },
  { id: "conversations", label: "Conversas", icon: MessageCircle },
  { id: "deals", label: "Negócios", icon: BarChart3 },
  { id: "automacoes", label: "Automações", icon: Bot },
  { id: "campanhas", label: "Campanhas", icon: Zap },
  { id: "usuarios", label: "Usuários / Equipes", icon: Users },
  { id: "conexoes", label: "Conexões WhatsApp", icon: Smartphone },
  { id: "webhooks", label: "Webhooks", icon: Globe },
  { id: "tokens", label: "API Tokens", icon: Key },
  { id: "ia", label: "IA / Prompts", icon: Brain },
  { id: "config", label: "Configurações", icon: Settings },
  { id: "tags", label: "Tags / Pipeline", icon: Tag },
];

const API_ENDPOINTS: ApiEndpoint[] = [
  { method: "POST", path: "/api/auth/login", desc: "Autenticar usuário e iniciar sessão", category: "auth", auth: "public",
    params: [{ name: "email", type: "string", required: true, desc: "Email do usuário" }, { name: "senha", type: "string", required: true, desc: "Senha do usuário" }],
    response: '{\n  "ok": true,\n  "user": { "id": 1, "nome": "...", "email": "...", "role": "admin" }\n}',
    example: 'curl -X POST /api/auth/login \\\n  -H "Content-Type: application/json" \\\n  -d \'{"email":"joao@flowcrm.com","senha":"senha123"}\'' },
  { method: "POST", path: "/api/auth/register", desc: "Registrar novo usuário e workspace", category: "auth", auth: "public",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome do usuário" }, { name: "email", type: "string", required: true, desc: "Email" }, { name: "senha", type: "string", required: true, desc: "Senha (min 6 chars)" }, { name: "workspace_nome", type: "string", required: false, desc: "Nome do workspace" }],
    response: '{\n  "ok": true,\n  "user": { "id": 2, "nome": "...", "email": "..." }\n}' },
  { method: "GET", path: "/api/auth/me", desc: "Dados do usuário logado", category: "auth", auth: "session",
    response: '{\n  "id": 1, "nome": "Joao", "email": "joao@flowcrm.com",\n  "role": "admin", "workspaceId": "uuid"\n}' },
  { method: "POST", path: "/api/auth/logout", desc: "Encerrar sessão", category: "auth", auth: "public" },

  { method: "GET", path: "/api/leads", desc: "Listar todos os contatos do workspace", category: "leads", auth: "session",
    response: '[\n  {\n    "id": 1, "nome": "...", "telefone": "...",\n    "email": "...", "status": "novo",\n    "canal": "WhatsApp",\n    "tags": ["Quente"], "owner": "Ana"\n  }\n]',
    example: 'curl /api/leads \\\n  -H "Authorization: Bearer <token>"' },
  { method: "GET", path: "/api/leads/:id", desc: "Buscar contato por ID", category: "leads", auth: "session",
    params: [{ name: "id", type: "number", required: true, desc: "ID do contato (URL param)" }] },
  { method: "POST", path: "/api/leads", desc: "Criar novo contato", category: "leads", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome do contato" }, { name: "contato", type: "string", required: false, desc: "Nome do contato" }, { name: "email", type: "string", required: false, desc: "Email" }, { name: "telefone", type: "string", required: false, desc: "Telefone" }, { name: "empresa", type: "string", required: false, desc: "Empresa" }, { name: "canal", type: "string", required: false, desc: "Canal de origem" }, { name: "status", type: "string", required: false, desc: "novo, contatado, qualificado, proposta, negociacao, ganho, perdido" }, { name: "tags", type: "string[]", required: false, desc: "Tags do contato" }],
    response: '{ "id": 10, "nome": "...", ... }',
    example: 'curl -X POST /api/leads \\\n  -H "Authorization: Bearer <token>" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"nome":"Maria Silva","telefone":"5511999887766","canal":"WhatsApp"}\'' },
  { method: "PATCH", path: "/api/leads/:id", desc: "Atualizar contato existente", category: "leads", auth: "session",
    params: [{ name: "id", type: "number", required: true, desc: "ID do contato (URL param)" }, { name: "nome", type: "string", required: false, desc: "Nome" }, { name: "status", type: "string", required: false, desc: "Status do pipeline" }, { name: "tags", type: "string[]", required: false, desc: "Tags" }, { name: "owner", type: "string", required: false, desc: "Responsável" }] },
  { method: "DELETE", path: "/api/leads/:id", desc: "Excluir contato", category: "leads", auth: "session",
    params: [{ name: "id", type: "number", required: true, desc: "ID do contato (URL param)" }] },

  { method: "GET", path: "/api/lead-tags", desc: "Listar todas as tags de contato", category: "tags", auth: "session",
    response: '[\n  { "id": 1, "nome": "Quente", "cor": "#ef4444" },\n  { "id": 2, "nome": "Premium", "cor": "#8b5cf6" }\n]' },
  { method: "POST", path: "/api/lead-tags", desc: "Criar nova tag", category: "tags", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome da tag" }, { name: "cor", type: "string", required: true, desc: "Cor hex (#ff0000)" }] },
  { method: "PATCH", path: "/api/lead-tags/:id", desc: "Atualizar tag", category: "tags", auth: "session" },
  { method: "DELETE", path: "/api/lead-tags/:id", desc: "Excluir tag", category: "tags", auth: "session" },

  { method: "GET", path: "/api/pipeline-stages", desc: "Listar estágios do pipeline", category: "tags", auth: "session",
    response: '[\n  { "id": 1, "key": "novo", "label": "Novo", "color": "#FBCA22", "ordem": 0 }\n]' },
  { method: "POST", path: "/api/pipeline-stages", desc: "Criar estágio do pipeline", category: "tags", auth: "session",
    params: [{ name: "key", type: "string", required: true, desc: "Chave única" }, { name: "label", type: "string", required: true, desc: "Nome exibido" }, { name: "color", type: "string", required: true, desc: "Cor hex" }, { name: "ordem", type: "number", required: true, desc: "Posição" }] },
  { method: "PATCH", path: "/api/pipeline-stages/:id", desc: "Atualizar estágio", category: "tags", auth: "session" },
  { method: "DELETE", path: "/api/pipeline-stages/:id", desc: "Excluir estágio", category: "tags", auth: "session" },

  { method: "GET", path: "/api/contacts", desc: "Listar contatos do workspace", category: "contacts", auth: "session",
    response: '[\n  { "id": 1, "nome": "...", "telefone": "...", "email": "..." }\n]' },
  { method: "POST", path: "/api/contacts", desc: "Criar contato", category: "contacts", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome do contato" }, { name: "telefone", type: "string", required: false, desc: "Telefone" }, { name: "email", type: "string", required: false, desc: "Email" }] },
  { method: "PATCH", path: "/api/contacts/:id", desc: "Atualizar contato", category: "contacts", auth: "session" },
  { method: "DELETE", path: "/api/contacts/:id", desc: "Excluir contato", category: "contacts", auth: "session" },

  { method: "GET", path: "/api/deals", desc: "Listar negócios", category: "deals", auth: "session",
    response: '[\n  { "id": 1, "titulo": "...", "valor": 5000, "estagio": "proposta" }\n]' },
  { method: "POST", path: "/api/deals", desc: "Criar negócio", category: "deals", auth: "session",
    params: [{ name: "titulo", type: "string", required: true, desc: "Título do negócio" }, { name: "valor", type: "number", required: false, desc: "Valor" }, { name: "leadId", type: "number", required: false, desc: "ID do contato vinculado" }] },
  { method: "PATCH", path: "/api/deals/:id", desc: "Atualizar negócio", category: "deals", auth: "session" },

  { method: "GET", path: "/api/conversations", desc: "Listar todas as conversas", category: "conversations", auth: "session",
    response: '[\n  {\n    "id": 1, "nome": "Carlos Silva",\n    "canal": "WhatsApp", "status": "open",\n    "unread": 2, "ultimaMensagem": "...",\n    "conexaoId": "uuid"\n  }\n]' },
  { method: "PATCH", path: "/api/conversations/:id/tags", desc: "Atualizar tags da conversa", category: "conversations", auth: "session",
    params: [{ name: "tags", type: "string[]", required: true, desc: "Array de tags" }] },
  { method: "PATCH", path: "/api/conversations/:id/assign", desc: "Atribuir conversa a usuário/equipe", category: "conversations", auth: "session",
    params: [{ name: "agente", type: "string|null", required: true, desc: "Nome do agente ou null para remover" }] },
  { method: "DELETE", path: "/api/conversations/:id", desc: "Excluir conversa e mensagens", category: "conversations", auth: "session" },
  { method: "GET", path: "/api/conversations/:id/messages", desc: "Listar mensagens da conversa", category: "conversations", auth: "session",
    response: '[\n  {\n    "id": 1, "texto": "Ola!",\n    "direction": "in", "agente": null,\n    "createdAt": "2026-03-13T..."\n  }\n]' },
  { method: "POST", path: "/api/conversations/:id/messages", desc: "Enviar mensagem na conversa", category: "conversations", auth: "session",
    params: [{ name: "texto", type: "string", required: true, desc: "Texto da mensagem" }, { name: "direction", type: "string", required: false, desc: "in ou out (default: out)" }, { name: "agente", type: "string", required: false, desc: "Nome do agente" }] },

  { method: "GET", path: "/api/automacoes", desc: "Listar automações", category: "automacoes", auth: "session",
    response: '{\n  "ok": true,\n  "data": [{ "id": 1, "nome": "...", "status": "ACTIVE", "nodes": [...] }]\n}' },
  { method: "GET", path: "/api/automacoes/stats", desc: "Estatísticas de execução das automações", category: "automacoes", auth: "session" },
  { method: "GET", path: "/api/automacoes/:id", desc: "Detalhes de uma automação", category: "automacoes", auth: "session" },
  { method: "POST", path: "/api/automacoes", desc: "Criar automação", category: "automacoes", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome da automação" }, { name: "nodes", type: "object[]", required: false, desc: "Array de nós do fluxo" }, { name: "edges", type: "object[]", required: false, desc: "Array de conexões" }] },
  { method: "PUT", path: "/api/automacoes/:id", desc: "Atualizar automação", category: "automacoes", auth: "session" },
  { method: "PATCH", path: "/api/automacoes/:id/toggle", desc: "Ativar/desativar automação", category: "automacoes", auth: "session" },
  { method: "POST", path: "/api/automacoes/:id/duplicate", desc: "Duplicar automação", category: "automacoes", auth: "session" },
  { method: "POST", path: "/api/automacoes/:id/execute", desc: "Executar automação manualmente", category: "automacoes", auth: "session",
    params: [{ name: "phone", type: "string", required: true, desc: "Telefone do lead" }] },
  { method: "DELETE", path: "/api/automacoes/:id", desc: "Excluir automação", category: "automacoes", auth: "session" },


  { method: "GET", path: "/api/campanhas", desc: "Listar campanhas de envio em massa", category: "campanhas", auth: "session" },
  { method: "GET", path: "/api/campanhas/:id", desc: "Detalhes da campanha", category: "campanhas", auth: "session" },
  { method: "POST", path: "/api/campanhas", desc: "Criar campanha", category: "campanhas", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome da campanha" }, { name: "channel", type: "string", required: true, desc: "Canal (whatsapp)" }, { name: "template", type: "string", required: false, desc: "Template de mensagem" }] },
  { method: "PATCH", path: "/api/campanhas/:id", desc: "Atualizar campanha", category: "campanhas", auth: "session" },
  { method: "DELETE", path: "/api/campanhas/:id", desc: "Excluir campanha", category: "campanhas", auth: "session" },

  { method: "GET", path: "/api/usuarios", desc: "Listar usuários do workspace", category: "usuarios", auth: "session",
    response: '{\n  "ok": true,\n  "data": [{\n    "id": 1, "nome": "Joao", "email": "...",\n    "role": "admin", "status": "ACTIVE",\n    "equipes": ["Vendas"]\n  }]\n}' },
  { method: "GET", path: "/api/usuarios/:id", desc: "Detalhes do usuário", category: "usuarios", auth: "session" },
  { method: "POST", path: "/api/usuarios/invite", desc: "Convidar usuário para o workspace", category: "usuarios", auth: "session",
    params: [{ name: "email", type: "string", required: true, desc: "Email do convidado" }, { name: "nome", type: "string", required: true, desc: "Nome" }, { name: "role", type: "string", required: false, desc: "admin, manager, agent" }] },
  { method: "PUT", path: "/api/usuarios/:id", desc: "Atualizar usuário", category: "usuarios", auth: "session" },
  { method: "PATCH", path: "/api/usuarios/:id/status", desc: "Alterar status (ACTIVE/INACTIVE)", category: "usuarios", auth: "session" },
  { method: "DELETE", path: "/api/usuarios/:id", desc: "Excluir usuário", category: "usuarios", auth: "session" },

  { method: "GET", path: "/api/equipes", desc: "Listar equipes com membros", category: "usuarios", auth: "session",
    response: '{\n  "ok": true,\n  "data": [{\n    "id": "uuid", "nome": "Vendas",\n    "members": [{ "id": 1, "nome": "Ana" }],\n    "leader": { "id": 1, "nome": "Ana" }\n  }]\n}' },
  { method: "POST", path: "/api/equipes", desc: "Criar equipe", category: "usuarios", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome da equipe" }, { name: "descricao", type: "string", required: false, desc: "Descrição" }, { name: "leader_id", type: "number", required: false, desc: "ID do líder" }] },
  { method: "PUT", path: "/api/equipes/:id", desc: "Atualizar equipe", category: "usuarios", auth: "session" },
  { method: "POST", path: "/api/equipes/:id/membros", desc: "Adicionar membro à equipe", category: "usuarios", auth: "session",
    params: [{ name: "user_id", type: "number", required: true, desc: "ID do usuário" }] },
  { method: "DELETE", path: "/api/equipes/:id/membros/:userId", desc: "Remover membro da equipe", category: "usuarios", auth: "session" },
  { method: "DELETE", path: "/api/equipes/:id", desc: "Excluir equipe", category: "usuarios", auth: "session" },

  { method: "GET", path: "/api/conexoes", desc: "Listar conexões WhatsApp", category: "conexoes", auth: "session",
    response: '{\n  "ok": true,\n  "data": [{\n    "id": "uuid", "nome": "WhatsApp Principal",\n    "numero": "5511999...", "status": "connected",\n    "provider": "evolution"\n  }]\n}' },
  { method: "POST", path: "/api/conexoes", desc: "Criar nova conexão WhatsApp", category: "conexoes", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome da conexão" }, { name: "provider", type: "string", required: false, desc: "evolution" }] },
  { method: "GET", path: "/api/conexoes/:id/status", desc: "Status da conexão", category: "conexoes", auth: "session" },
  { method: "GET", path: "/api/conexoes/:id/qrcode", desc: "QR Code para conectar", category: "conexoes", auth: "session" },

  { method: "GET", path: "/api/webhooks", desc: "Listar webhooks configurados", category: "webhooks", auth: "session" },
  { method: "POST", path: "/api/webhooks", desc: "Criar webhook", category: "webhooks", auth: "session",
    params: [{ name: "url", type: "string", required: true, desc: "URL do webhook" }, { name: "events", type: "string[]", required: true, desc: "Eventos: lead.created, lead.updated, message.received, deal.moved" }, { name: "secret", type: "string", required: false, desc: "Secret para validação HMAC" }],
    response: '{\n  "ok": true,\n  "data": { "id": 1, "url": "...", "events": [...] }\n}',
    example: 'curl -X POST /api/webhooks \\\n  -H "Authorization: Bearer <token>" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"url":"https://meuapp.com/webhook","events":["lead.created"]}\'' },
  { method: "DELETE", path: "/api/webhooks/:id", desc: "Excluir webhook", category: "webhooks", auth: "session" },
  { method: "POST", path: "/api/webhooks/:id/testar", desc: "Enviar payload de teste", category: "webhooks", auth: "session" },
  { method: "GET", path: "/api/webhooks/:id/logs", desc: "Logs de envio do webhook", category: "webhooks", auth: "session" },

  { method: "GET", path: "/api/tokens", desc: "Listar API tokens", category: "tokens", auth: "session",
    response: '{\n  "ok": true,\n  "data": [{\n    "id": 1, "nome": "Token Prod",\n    "permissions": ["leads:read","leads:write"],\n    "lastUsed": "2026-03-13T..."\n  }]\n}' },
  { method: "POST", path: "/api/tokens", desc: "Gerar novo API token", category: "tokens", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome do token" }, { name: "permissions", type: "string[]", required: true, desc: "Permissões: leads:read, leads:write, messages:send, prompts:read" }],
    response: '{\n  "ok": true,\n  "token": "flw_xxxxxxxx",\n  "data": { "id": 1, "nome": "..." }\n}' },
  { method: "DELETE", path: "/api/tokens/:id", desc: "Revogar token", category: "tokens", auth: "session" },


  { method: "GET", path: "/api/ia/prompts", desc: "Listar prompts de IA", category: "ia", auth: "session",
    response: '[\n  {\n    "id": 1, "nome": "Qualificacao",\n    "slug": "qualificacao",\n    "prompt": "Voce e um assistente...",\n    "modelo": "gpt-4o", "ativo": true\n  }\n]' },
  { method: "GET", path: "/api/ia/prompts/by-slug/:slug", desc: "Buscar prompt por slug", category: "ia", auth: "session" },
  { method: "POST", path: "/api/ia/prompts", desc: "Criar prompt de IA", category: "ia", auth: "session",
    params: [{ name: "nome", type: "string", required: true, desc: "Nome do prompt" }, { name: "slug", type: "string", required: true, desc: "Slug único" }, { name: "prompt", type: "string", required: true, desc: "Texto do prompt" }, { name: "modelo", type: "string", required: false, desc: "gpt-4o, gpt-4o-mini" }, { name: "temperatura", type: "number", required: false, desc: "0.0 a 2.0" }] },
  { method: "PUT", path: "/api/ia/prompts/:id", desc: "Atualizar prompt", category: "ia", auth: "session" },
  { method: "DELETE", path: "/api/ia/prompts/:id", desc: "Excluir prompt", category: "ia", auth: "session" },
  { method: "GET", path: "/api/ia/prompts/:id/historico", desc: "Histórico de versões do prompt", category: "ia", auth: "session" },
  { method: "POST", path: "/api/ia/prompts/:id/restaurar/:versao", desc: "Restaurar versão anterior do prompt", category: "ia", auth: "session" },

  { method: "GET", path: "/api/respostas-rapidas", desc: "Listar respostas rápidas do chat", category: "config", auth: "session" },
  { method: "POST", path: "/api/respostas-rapidas", desc: "Criar resposta rápida", category: "config", auth: "session",
    params: [{ name: "titulo", type: "string", required: true, desc: "Título/atalho" }, { name: "texto", type: "string", required: true, desc: "Texto completo" }] },
  { method: "PATCH", path: "/api/respostas-rapidas/:id", desc: "Atualizar resposta rápida", category: "config", auth: "session" },
  { method: "DELETE", path: "/api/respostas-rapidas/:id", desc: "Excluir resposta rápida", category: "config", auth: "session" },

  { method: "GET", path: "/api/anotacoes", desc: "Listar anotações", category: "config", auth: "session" },
  { method: "POST", path: "/api/anotacoes", desc: "Criar anotação", category: "config", auth: "session" },
  { method: "PATCH", path: "/api/anotacoes/:id", desc: "Atualizar anotação", category: "config", auth: "session" },
  { method: "DELETE", path: "/api/anotacoes/:id", desc: "Excluir anotação", category: "config", auth: "session" },

  { method: "GET", path: "/api/transactions", desc: "Listar transações financeiras", category: "config", auth: "session" },
  { method: "POST", path: "/api/transactions", desc: "Criar transação", category: "config", auth: "session" },

  { method: "GET", path: "/api/billing/usage", desc: "Uso e faturamento do workspace", category: "config", auth: "session" },
  { method: "GET", path: "/api/planos", desc: "Listar planos disponíveis", category: "config", auth: "session" },
  { method: "GET", path: "/api/planos/:slug", desc: "Detalhes de um plano", category: "config", auth: "session" },
  { method: "GET", path: "/api/workspaces", desc: "Listar workspaces", category: "config", auth: "session" },
  { method: "POST", path: "/api/workspaces", desc: "Criar workspace", category: "config", auth: "session" },
  { method: "GET", path: "/api/permissoes", desc: "Listar permissões por role", category: "config", auth: "session" },
  { method: "PUT", path: "/api/permissoes/:role", desc: "Atualizar permissões de um role", category: "config", auth: "session" },

  { method: "GET", path: "/api/integrations/config", desc: "Configurações de integrações", category: "config", auth: "session" },
  { method: "POST", path: "/api/integrations/config", desc: "Salvar configuração de integração", category: "config", auth: "session",
    params: [{ name: "provider", type: "string", required: true, desc: "openai, stripe, etc" }, { name: "config", type: "object", required: true, desc: "Objeto de configuração" }] },

  { method: "POST", path: "/api/upload", desc: "Upload de arquivo (multipart)", category: "config", auth: "session",
    params: [{ name: "file", type: "File", required: true, desc: "Arquivo (multipart/form-data)" }],
    response: '{\n  "url": "/uploads/filename.ext"\n}' },

  { method: "GET", path: "/api/perfil/me", desc: "Dados do perfil do usuário logado", category: "auth", auth: "session" },
  { method: "PUT", path: "/api/perfil/me", desc: "Atualizar perfil", category: "auth", auth: "session" },
  { method: "POST", path: "/api/perfil/alterar-senha", desc: "Alterar senha do usuário", category: "auth", auth: "session",
    params: [{ name: "senhaAtual", type: "string", required: true, desc: "Senha atual" }, { name: "novaSenha", type: "string", required: true, desc: "Nova senha (min 6)" }] },
  { method: "POST", path: "/api/perfil/avatar", desc: "Upload de avatar", category: "auth", auth: "session" },
  { method: "DELETE", path: "/api/perfil/conta", desc: "Excluir conta do usuário", category: "auth", auth: "session" },

];

export default function Integracoes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [integrations, setIntegrations] = useState<Integration[]>(initialIntegrations);
  const [openInteg, setOpenInteg] = useState<IntegTabId | null>(null);
  const [integSubTab, setIntegSubTab] = useState<IntegSubTab>("ativos");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showApiDocs, setShowApiDocs] = useState(false);
  const [apiDocsSearch, setApiDocsSearch] = useState("");
  const [apiDocsCategory, setApiDocsCategory] = useState("all");
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenPerms, setNewTokenPerms] = useState<string[]>(["leads:read", "leads:write", "messages:send", "prompts:read"]);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [canCloseTokenModal, setCanCloseTokenModal] = useState(false);

  const { data: tokensData } = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/tokens"] });
  const { data: integConfigData } = useQuery<{ ok: boolean; data: Record<string, { enabled: boolean; config: any }> }>({ queryKey: ["/api/integrations/config"] });
  useEffect(() => {
    if (integConfigData?.data) {
      const configs = integConfigData.data;
      setIntegrations(prev => prev.map(ig => {
        const saved = configs[ig.id];
        if (saved) {
          return { ...ig, on: saved.enabled, connected: saved.enabled };
        }
        return ig;
      }));
    }
  }, [integConfigData?.data]);

  // Abre um modal de integração direto via ?open=<id>
  // (ex.: /integracoes?open=stripe abre o painel do Stripe).
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open && INTEG_CARDS.some(c => c.id === open)) {
      setOpenInteg(open as IntegTabId);
    }
  }, []);

  const generateTokenMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tokens", { nome: newTokenName, permissoes: newTokenPerms });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
      setGeneratedToken(data.data.token_completo);
      setCanCloseTokenModal(false);
      setTimeout(() => setCanCloseTokenModal(true), 5000);
    },
  });

  const revokeTokenMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/tokens/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tokens"] });
      toast({ title: "Token revogado" });
    },
  });

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    toast({ title: "Copiado para a área de transferência" });
  }

  const connectedCount = integrations.filter((i) => i.on).length;


  function handleToggle(id: string) {
    const ig = integrations.find((i) => i.id === id);
    const newEnabled = !ig?.on;
    setTogglingId(id);
    setTimeout(() => {
      setIntegrations((prev) => prev.map((ig) => ig.id === id ? { ...ig, on: newEnabled, connected: newEnabled } : ig));
      toast({ title: newEnabled ? `${ig?.name} ativado` : `${ig?.name} desativado` });
      apiRequest("POST", "/api/integrations/config", { integrationId: id, enabled: newEnabled }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/integrations/config"] });
      });
      setTogglingId(null);
    }, 400);
  }

  function getIntegStatus(id: IntegTabId): boolean {
    return integrations.find(i => i.id === id)?.on || false;
  }

  const activeCards = INTEG_CARDS.filter(c => getIntegStatus(c.id));
  const inactiveCards = INTEG_CARDS.filter(c => !getIntegStatus(c.id));
  const displayCards = integSubTab === "ativos" ? activeCards : inactiveCards;

  return (
    <div className="h-full flex flex-col bg-base-200/40" data-testid="page-integracoes">
      <div className="px-6 pt-5 pb-4 flex-shrink-0">
        <PageHeader
          title="Integrações"
          subtitle={`${connectedCount} de ${integrations.length} ativas`}
          actions={
            <Button variant="outline" size="sm" onClick={() => setShowApiDocs(true)} data-testid="button-api-docs" className="h-9 gap-1.5">
              <FileText className="w-3.5 h-3.5" />API Docs
            </Button>
          }
        />
      </div>

      {/* Sub-tabs Ativos/Inativos — abas segmentadas Nexus (.seg-tab / .seg-tab-active) */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border/70 flex-shrink-0">
        {([
          { key: "ativos" as IntegSubTab, label: "Ativos", count: activeCards.length, dotColor: "hsl(var(--primary))" },
          { key: "inativos" as IntegSubTab, label: "Inativos", count: inactiveCards.length, dotColor: "#9CA3AF" },
        ]).map((tab) => {
          const isActive = integSubTab === tab.key;
          return (
            <button
              key={tab.key}
              className={`seg-tab ${isActive ? "seg-tab-active" : ""}`}
              onClick={() => setIntegSubTab(tab.key)}
              data-testid={`subtab-integ-${tab.key}`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isActive ? "currentColor" : tab.dotColor }} />
              {tab.label}
              <span
                className={`text-[9.5px] px-1.5 py-[1px] rounded-full min-w-[18px] text-center tabular-nums font-bold ${isActive ? "bg-white/25 text-primary-content" : "bg-secondary text-muted-foreground"}`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {displayCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Layers className="w-10 h-10 opacity-20 mb-2" />
            <p className="text-[12px]">{integSubTab === "ativos" ? "Nenhuma integração ativa" : "Todas as integrações estão ativas"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {displayCards.map((card) => {
              const isOn = getIntegStatus(card.id);
              const isToggling = togglingId === card.id;
              return (
                <Card
                  key={card.id}
                  className={`overflow-hidden cursor-pointer border-base-200 hover:border-base-300 transition-all duration-200 group ${isToggling ? "scale-75 opacity-0 -translate-y-4 pointer-events-none" : "scale-100 opacity-100 translate-y-0"}`}
                  style={isToggling ? { transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)" } : undefined}
                  onClick={() => setOpenInteg(card.id)}
                  data-testid={`card-integ-${card.id}`}
                >
                  <div className="p-3.5">
                    <div className="flex items-start justify-between mb-3 gap-2">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-border/50"
                          style={{ backgroundColor: card.bg }}
                        >
                          <IntegIcon id={card.brandIcon} size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-semibold tracking-tight truncate">{card.name}</div>
                          <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">{card.desc}</div>
                        </div>
                      </div>
                      {/* Indicador de estado — pulsante quando ativa (glow
                          Norte), neutral fade quando inativa. Substitui o
                          badge "Ativo/Inativo" do rodapé que duplicava info
                          com o toggle. */}
                      <div className="flex-shrink-0 mt-1">
                        {isOn ? (
                          <span className="automation-active-indicator automation-active-indicator-sm" style={{ width: 10, height: 10 }}>
                            <span className="dot-core" />
                            <span className="dot-ring" />
                            <span className="dot-ring-2" />
                          </span>
                        ) : (
                          <span
                            className="block w-2 h-2 rounded-full"
                            style={{ background: "hsl(var(--muted-foreground) / 0.35)" }}
                            aria-label="Integração inativa"
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2.5 border-t border-border/40">
                      <span
                        className="text-[10.5px] font-semibold"
                        style={{ color: isOn ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
                      >
                        {isOn ? "Conectada" : "Desativada"}
                      </span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={isOn}
                          onCheckedChange={() => handleToggle(card.id)}
                          className="scale-90"
                          data-testid={`toggle-card-${card.id}`}
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ FLOATING PANELS ═══ */}

      {/* ── OpenAI ── */}
      <Dialog open={openInteg === "openai"} onOpenChange={(o) => !o && setOpenInteg(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,163,127,.1)" }}>
                <IntegIcon id="openai" size={22} />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-[15px]">OpenAI GPT-4o</DialogTitle>
                <p className="text-[11px] text-muted-foreground">Chave principal para todos os agentes</p>
              </div>
              <Switch checked={getIntegStatus("openai")} onCheckedChange={() => handleToggle("openai")} data-testid="toggle-integ-openai" />
            </div>
          </DialogHeader>
          {getIntegStatus("openai") && (
            <div className="space-y-4 mt-2">
              <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "rgba(16,163,127,.1)" }}>
                <span className="text-[11px] font-semibold" style={{ color: "#10a37f" }}>GPT-4o, GPT-4o Mini, GPT-4.1</span>
              </div>
              <div>
                <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">API Key Principal</label>
                <div className="flex gap-1.5">
                  <Input type={revealedFields["openai_key"] ? "text" : "password"} placeholder="sk-proj-..." className="flex-1 font-mono text-xs" data-testid="input-integ-field-openai_key" />
                  <Button variant="outline" size="icon" onClick={() => setRevealedFields(p => ({ ...p, openai_key: !p.openai_key }))} data-testid="button-toggle-openai_key">
                    {revealedFields["openai_key"] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Esta chave será usada como padrão por todos os agentes de IA que não tiverem chave própria.{" "}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                    Obter no painel OpenAI <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </p>
              </div>
              <div className="rounded-lg p-4 bg-primary/10 border border-primary/20 space-y-2">
                <p className="text-xs font-semibold text-primary">Como funciona?</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Configure aqui sua chave principal da OpenAI. Todos os agentes de IA que não tiverem chave própria usarão automaticamente esta chave.
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Para usar uma chave diferente em um agente específico, acesse: <strong>Automações → Agente → Aba Avançado → Credenciais de IA</strong>.
                </p>
              </div>
              <Card className="p-3 border-dashed">
                <div className="text-[11px] font-bold mb-2" style={{ color: "#10a37f" }}>Modelos disponíveis:</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 text-[11px]"><div className="w-2 h-2 rounded-full bg-emerald-400" /><span className="font-semibold">GPT-4o Mini</span><span className="text-muted-foreground">- rápido</span></div>
                  <div className="flex items-center gap-2 text-[11px]"><div className="w-2 h-2 rounded-full bg-emerald-600" /><span className="font-semibold">GPT-4o</span><span className="text-muted-foreground">- mais capaz</span></div>
                </div>
              </Card>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { toast({ title: "Testando OpenAI..." }); setTimeout(() => toast({ title: "OpenAI OK!" }), 1800); }} data-testid="button-test-openai"><FlaskConical className="w-3.5 h-3.5 mr-1.5" />Testar</Button>
                <Button size="sm" onClick={() => {
                  const keyInput = document.querySelector('[data-testid="input-integ-field-openai_key"]') as HTMLInputElement;
                  apiRequest("POST", "/api/integrations/config", { integrationId: "openai", enabled: true, config: { apiKey: keyInput?.value || "" } }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/integrations/config"] });
                    toast({ title: "OpenAI salva!" });
                  });
                }} data-testid="button-save-openai"><Save className="w-3.5 h-3.5 mr-1.5" />Salvar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* ── Stripe ── */}
      <Dialog open={openInteg === "stripe"} onOpenChange={(o) => !o && setOpenInteg(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(99,91,255,.1)" }}>
                <IntegIcon id="stripe" size={22} />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-[15px]">Stripe</DialogTitle>
                <p className="text-[11px] text-muted-foreground">Billing, assinaturas, checkout</p>
              </div>
              <Switch checked={getIntegStatus("stripe")} onCheckedChange={() => handleToggle("stripe")} data-testid="toggle-integ-stripe" />
            </div>
          </DialogHeader>
          {getIntegStatus("stripe") && (
            <div className="space-y-4 mt-2">
              <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "rgba(99,91,255,.1)" }}>
                <span className="text-sm font-semibold" style={{ color: "#6772e5" }}>R$1.491</span>
                <span className="text-[11px] text-muted-foreground">100% cobrado este mês</span>
              </div>
              {integrations.find(i => i.id === "stripe")?.fields.map((f) => (
                <div key={f.key}>
                  <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">{f.label}</label>
                  <div className="flex gap-1.5">
                    <Input type={f.secret && !revealedFields[f.key] ? "password" : "text"} defaultValue={f.value} placeholder={f.placeholder} className="flex-1 font-mono text-xs" data-testid={`input-integ-field-${f.key}`} />
                    {f.secret && (
                      <Button variant="outline" size="icon" onClick={() => setRevealedFields(p => ({ ...p, [f.key]: !p[f.key] }))} data-testid={`button-toggle-${f.key}`}>
                        {revealedFields[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <div className="bg-muted/30 border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Webhook URL</div>
                <code className="text-[10.5px] text-primary break-all block mb-2">https://api.chatbananacrm.com/webhooks/stripe</code>
                <Button variant="outline" size="sm" onClick={() => handleCopy("https://api.chatbananacrm.com/webhooks/stripe")} data-testid="button-copy-stripe-webhook"><Copy className="w-3 h-3 mr-1.5" />Copiar</Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { toast({ title: "Testando Stripe..." }); setTimeout(() => toast({ title: "Stripe OK!" }), 1800); }} data-testid="button-test-stripe"><FlaskConical className="w-3.5 h-3.5 mr-1.5" />Testar</Button>
                <Button size="sm" onClick={() => {
                  const keyInput = document.querySelector('[data-testid="input-integ-field-stripe_sk"]') as HTMLInputElement;
                  apiRequest("POST", "/api/integrations/config", { integrationId: "stripe", enabled: true, config: { secretKey: keyInput?.value || "" } }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/integrations/config"] });
                    toast({ title: "Stripe salvo!" });
                  });
                }} data-testid="button-save-stripe"><Save className="w-3.5 h-3.5 mr-1.5" />Salvar</Button>
              </div>
            </div>
          )}
          {!getIntegStatus("stripe") && (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <div className="text-[12px]">Ative o toggle acima para configurar</div>
            </div>
          )}
        </DialogContent>
      </Dialog>


      <Dialog open={openInteg === "instagram"} onOpenChange={(o) => { if (!o) setOpenInteg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(225,48,108,.1)" }}>
                <IntegIcon id="instagram" size={22} />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-[15px]">Instagram</DialogTitle>
                <p className="text-[11px] text-muted-foreground">DMs, comentários e prospecção com IA</p>
              </div>
              <Switch checked={getIntegStatus("instagram")} onCheckedChange={() => handleToggle("instagram")} data-testid="toggle-integ-instagram" />
            </div>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Card className="p-3 border-dashed">
              <div className="text-[11px] font-bold mb-1.5" style={{ color: "#E1306C" }}>O que esta integração controla</div>
              <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1">
                <p>• Aba <strong>Instagram</strong> no Motor de Automações</p>
                <p>• Canal <strong>Instagram</strong> na página de Conexões</p>
                <p>• Fluxos de prospecção, DMs e comentários automáticos</p>
              </div>
            </Card>
            {getIntegStatus("instagram") ? (
              <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "rgba(225,48,108,.06)", border: "1px solid rgba(225,48,108,.15)" }}>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#E1306C" }} />
                <span className="text-[11px] text-muted-foreground">Instagram ativo. Configure a conexão em <strong>Conexões → Instagram</strong>.</span>
              </div>
            ) : (
              <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.15)" }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-yellow-500" />
                <span className="text-[11px] text-muted-foreground">Instagram desativado. A aba Instagram e o canal ficam ocultos, mas seus dados estão preservados.</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Token Modal ── */}
      <Dialog open={showTokenModal} onOpenChange={(open) => { if (!open && (!generatedToken || canCloseTokenModal)) { setShowTokenModal(false); setGeneratedToken(null); } }}>
        <DialogContent className="max-w-md">
          {!generatedToken ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">Gerar Novo Token</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Nome do token</label>
                  <Input value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} placeholder="Ex: API Produção" className="text-xs" data-testid="input-token-name" />
                </div>
                <div>
                  <label className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Permissões</label>
                  <div className="space-y-2">
                    {TOKEN_PERMISSIONS.map((p) => (
                      <label key={p.key} className="flex items-center gap-2.5 cursor-pointer" data-testid={`checkbox-perm-${p.key}`}>
                        <Checkbox checked={newTokenPerms.includes(p.key)} onCheckedChange={(checked) => {
                          if (checked) setNewTokenPerms(prev => [...prev, p.key]);
                          else setNewTokenPerms(prev => prev.filter(k => k !== p.key));
                        }} />
                        <span className="text-[12px]">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowTokenModal(false)}>Cancelar</Button>
                <Button onClick={() => generateTokenMut.mutate()} disabled={!newTokenName || generateTokenMut.isPending} data-testid="button-generate-token"><Key className="w-3.5 h-3.5 mr-1.5" />Gerar</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  <DialogTitle className="text-sm">Copie seu token agora</DialogTitle>
                </div>
              </DialogHeader>
              <p className="text-[12px] text-muted-foreground">Este token não será exibido novamente.</p>
              <div className="bg-muted/30 border rounded-lg p-3">
                <code className="text-[11px] font-mono break-all block" data-testid="text-generated-token">{generatedToken}</code>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleCopy(generatedToken)} data-testid="button-copy-generated-token"><Copy className="w-3.5 h-3.5 mr-1.5" />Copiar Token</Button>
                <Button variant="outline" size="sm" disabled={!canCloseTokenModal} onClick={() => { setShowTokenModal(false); setGeneratedToken(null); }} data-testid="button-close-token-modal">Fechar {!canCloseTokenModal && "(aguarde 5s)"}</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={showApiDocs} onOpenChange={(o) => { if (!o) setShowApiDocs(false); }}>
        <DialogContent className="max-w-[900px] max-h-[90vh] overflow-hidden p-0 gap-0">
          <div className="flex h-[85vh]">
            <div className="w-[220px] border-r border-border flex flex-col flex-shrink-0 bg-secondary/30">
              <div className="px-3 pt-4 pb-2">
                <div className="text-[13px] font-bold mb-2">API Reference</div>
                <Input
                  placeholder="Buscar endpoint..."
                  value={apiDocsSearch}
                  onChange={(e) => setApiDocsSearch(e.target.value)}
                  className="h-7 text-[11px]"
                  data-testid="input-api-docs-search"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-1.5 pb-3">
                {API_DOCS_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => { setApiDocsCategory(cat.id); setExpandedEndpoint(null); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-[11px] mb-0.5 transition-colors ${
                      apiDocsCategory === cat.id
                        ? "bg-primary/10 text-primary font-bold"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                    data-testid={`apidocs-cat-${cat.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <cat.icon className="w-3 h-3 flex-shrink-0" />
                      <span>{cat.label}</span>
                      <span className="ml-auto text-[9px] opacity-60">{cat.id === "all" ? API_ENDPOINTS.length : API_ENDPOINTS.filter(e => e.category === cat.id).length}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="px-3 py-2 border-t border-border">
                <div className="text-[9px] text-muted-foreground leading-relaxed">
                  Base URL: <code className="text-[9px] bg-muted px-1 rounded">/api</code>
                </div>
                <div className="text-[9px] text-muted-foreground mt-1">
                  Auth: <code className="text-[9px] bg-muted px-1 rounded">Bearer token</code> ou <code className="text-[9px] bg-muted px-1 rounded">Cookie session</code>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-bold">Documentação da API</div>
                    <div className="text-[11px] text-muted-foreground">{API_ENDPOINTS.length} endpoints disponíveis</div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => {
                      const baseUrl = window.location.origin;
                      handleCopy(baseUrl + "/api");
                    }}>
                      <Copy className="w-3 h-3 mr-1" />Base URL
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-3">
                {(() => {
                  const search = apiDocsSearch.toLowerCase();
                  const endpoints = API_ENDPOINTS.filter((ep) => {
                    const matchCat = apiDocsCategory === "all" || ep.category === apiDocsCategory;
                    const matchSearch = !search || ep.path.toLowerCase().includes(search) || ep.desc.toLowerCase().includes(search) || ep.method.toLowerCase().includes(search);
                    return matchCat && matchSearch;
                  });

                  if (endpoints.length === 0) {
                    return <div className="text-center py-10 text-[12px] text-muted-foreground">Nenhum endpoint encontrado.</div>;
                  }

                  const grouped: Record<string, typeof endpoints> = {};
                  endpoints.forEach((ep) => {
                    const cat = API_DOCS_CATEGORIES.find(c => c.id === ep.category);
                    const label = cat?.label || ep.category;
                    if (!grouped[label]) grouped[label] = [];
                    grouped[label].push(ep);
                  });

                  return Object.entries(grouped).map(([group, eps]) => (
                    <div key={group} className="mb-5">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">{group}</div>
                      <div className="space-y-1.5">
                        {eps.map((ep) => {
                          const epKey = `${ep.method}-${ep.path}`;
                          const isExpanded = expandedEndpoint === epKey;
                          return (
                            <div key={epKey} className="border border-border rounded-lg overflow-hidden" data-testid={`apidocs-ep-${ep.method.toLowerCase()}-${ep.path.replace(/[/:]/g, "-")}`}>
                              <button
                                onClick={() => setExpandedEndpoint(isExpanded ? null : epKey)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/40 transition-colors text-left"
                              >
                                <span className={`text-[9px] font-bold px-1.5 py-[1px] rounded min-w-[42px] text-center ${METHOD_COLORS[ep.method] || "bg-base-200 text-base-content/60"}`}>
                                  {ep.method}
                                </span>
                                <code className="text-[11px] font-mono flex-1 truncate">{ep.path}</code>
                                {ep.auth === "token" && <Shield className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-label="Requer API Token" />}
                                <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">{ep.desc}</span>
                                <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                              </button>

                              {isExpanded && (
                                <div className="px-4 py-3 border-t border-border bg-secondary/20">
                                  <div className="text-[11px] text-foreground mb-3">{ep.desc}</div>

                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[9px] font-bold text-muted-foreground uppercase">Autenticação:</span>
                                    <Badge variant="outline" className="text-[9px]">
                                      {ep.auth === "token" ? "API Token (Bearer)" : ep.auth === "public" ? "Nenhuma" : "Session Cookie / Bearer Token"}
                                    </Badge>
                                  </div>

                                  {ep.params && ep.params.length > 0 && (
                                    <div className="mb-3">
                                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Parâmetros</div>
                                      <div className="bg-muted/30 rounded-lg border border-border overflow-hidden">
                                        <table className="w-full">
                                          <thead>
                                            <tr className="border-b border-border">
                                              <th className="px-2.5 py-1.5 text-left text-[9px] font-bold text-muted-foreground uppercase">Campo</th>
                                              <th className="px-2.5 py-1.5 text-left text-[9px] font-bold text-muted-foreground uppercase">Tipo</th>
                                              <th className="px-2.5 py-1.5 text-left text-[9px] font-bold text-muted-foreground uppercase">Obrigatório</th>
                                              <th className="px-2.5 py-1.5 text-left text-[9px] font-bold text-muted-foreground uppercase">Descrição</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {ep.params.map((p, i) => (
                                              <tr key={i} className="border-b border-border last:border-0">
                                                <td className="px-2.5 py-1.5"><code className="text-[10px] font-mono text-primary">{p.name}</code></td>
                                                <td className="px-2.5 py-1.5 text-[10px] text-muted-foreground">{p.type}</td>
                                                <td className="px-2.5 py-1.5 text-[10px]">{p.required ? <span className="text-rose-600 dark:text-rose-400">sim</span> : <span className="text-muted-foreground">não</span>}</td>
                                                <td className="px-2.5 py-1.5 text-[10px] text-muted-foreground">{p.desc}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}

                                  {ep.response && (
                                    <div className="mb-3">
                                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Resposta</div>
                                      <pre className="bg-muted/40 border border-border rounded-lg p-3 text-[10px] font-mono overflow-x-auto whitespace-pre">{ep.response}</pre>
                                    </div>
                                  )}

                                  {ep.example && (
                                    <div>
                                      <div className="flex items-center justify-between mb-1.5">
                                        <div className="text-[10px] font-bold text-muted-foreground uppercase">Exemplo cURL</div>
                                        <button className="text-[9px] text-primary hover:underline" onClick={() => handleCopy(ep.example!)}>Copiar</button>
                                      </div>
                                      <pre className="bg-muted/40 border border-border rounded-lg p-3 text-[10px] font-mono overflow-x-auto whitespace-pre">{ep.example}</pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
