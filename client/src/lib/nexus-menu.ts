// Menu do CRM na estrutura do Nexus (ISidebarMenuItem[]): título + folhas +
// grupos COLAPSÁVEIS (children), como o ERP (Operação/Financeiro). Ícones iconify.
import { ISidebarMenuItem } from "@/components/nexus/SidebarMenuItem";

export function getNexusMenu(opts: { chatUnread?: number; isSuperAdmin?: boolean }): ISidebarMenuItem[] {
  const { chatUnread = 0, isSuperAdmin = false } = opts;

  const menu: ISidebarMenuItem[] = [
    { id: "menu-title", isTitle: true, label: "Menu" },
    { id: "inicio", icon: "lucide--house", label: "Início", url: "/inicio" },
    { id: "crm", icon: "lucide--kanban", label: "CRM", url: "/crm" },
    {
      id: "comunicacao",
      icon: "lucide--messages-square",
      label: "Comunicação",
      children: [
        {
          id: "atendimento",
          icon: "lucide--headset",
          label: "Atendimento",
          url: "/atendimento",
          badges: chatUnread > 0 ? [String(chatUnread)] : undefined,
        },
        { id: "gestao-conversas", icon: "lucide--message-square-text", label: "Gestão de Conversa", url: "/gestao-conversas" },
        { id: "automacoes", icon: "lucide--zap", label: "Automações", url: "/automacoes" },
        { id: "instaflix", icon: "lucide--clapperboard", label: "Instaflix", url: "/instaflix" },
      ],
    },
    { id: "relatorios", icon: "lucide--chart-column", label: "Relatórios", url: "/relatorios" },
    {
      id: "config",
      icon: "lucide--settings",
      label: "Configuração",
      children: [
        { id: "conexoes", icon: "lucide--radio", label: "Canais", url: "/conexoes" },
        { id: "integracoes", icon: "lucide--link", label: "Integrações", url: "/integracoes" },
      ],
    },
    { id: "suporte", icon: "lucide--headphones", label: "Suporte", url: "/suporte" },
  ];

  if (isSuperAdmin) {
    menu.push({ id: "plataforma-title", isTitle: true, label: "Plataforma" });
    menu.push({ id: "super-admin", icon: "lucide--shield-check", label: "Super Gerencial", url: "/super-admin" });
  }

  return menu;
}
