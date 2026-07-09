// Catálogo OFICIAL de planos do SaaS — FONTE DE VERDADE única, compartilhada
// entre o seed do banco (server/seed.ts → tabela `planos`) e a página de Planos
// (client billing.tsx). Espelha a grade da landing page.
//
// Bruno 2026-06-19: a landing, o seed e o banco de PRODUÇÃO tinham divergido — a
// prod ficou com uma grade ANTIGA (Starter/Professional/Business) porque o seed
// só inseria com a tabela vazia. Centralizar aqui evita nova divergência.
// (A landing ainda tem um array próprio idêntico a este — migrar pra cá quando
//  não houver edição concorrente no landing.tsx.)

export interface PlanCatalogEntry {
  nome: string;
  slug: string;
  /** Mensal; string pro `numeric` do Postgres. null = sob consulta (Enterprise). */
  preco: string | null;
  /** null = ilimitado. */
  limiteCanais: number | null;
  limiteClientes: number | null;
  limiteUsuarios: number | null;
  descricao: string;
  features: string[];
  popular?: boolean;
}

export const PLANS_CATALOG: PlanCatalogEntry[] = [
  {
    nome: "Essencial", slug: "essencial", preco: "297.00",
    limiteCanais: 1, limiteClientes: 1500, limiteUsuarios: 3,
    descricao: "Para times pequenos — até 1.500 contatos",
    features: [
      "1 conexão de WhatsApp",
      "Até 1.500 contatos na base",
      "3 usuários",
      "CRM com funil de vendas (Kanban)",
      "Automações de atendimento",
      "Respostas rápidas",
      "CSAT automático",
    ],
  },
  {
    nome: "Crescimento", slug: "crescimento", preco: "497.00",
    limiteCanais: 2, limiteClientes: 5000, limiteUsuarios: 8,
    descricao: "Em expansão — até 5.000 contatos",
    popular: true,
    features: [
      "2 conexões de WhatsApp",
      "Até 5.000 contatos na base",
      "8 usuários",
      "Tudo do Essencial +",
      "Instagram Direct integrado",
      "Automações visuais (builder de fluxos)",
      "NPS + CSAT automáticos",
    ],
  },
  {
    nome: "Profissional", slug: "profissional", preco: "897.00",
    limiteCanais: 4, limiteClientes: 15000, limiteUsuarios: 20,
    descricao: "Estruturados — até 15.000 contatos",
    features: [
      "4 conexões de WhatsApp",
      "Até 15.000 contatos na base",
      "20 usuários",
      "Tudo do Crescimento +",
      "Campanhas em massa + disparos programados",
      "Relatórios avançados",
      "API + Webhooks",
    ],
  },
  {
    nome: "Enterprise", slug: "enterprise", preco: null,
    limiteCanais: null, limiteClientes: null, limiteUsuarios: null,
    descricao: "Grandes operações e grupos — sem limite",
    features: [
      "Conexões e base ILIMITADAS",
      "Usuários ilimitados",
      "Tudo do Profissional +",
      "White-label (multi-marca / filial)",
      "Integrações sob medida",
      "Gerente de conta dedicado",
      "SLA 99,9%",
    ],
  },
];

/** slug → features, pra a página de Planos mostrar a MESMA lista da landing. */
export const PLAN_FEATURES: Record<string, string[]> = Object.fromEntries(
  PLANS_CATALOG.map((p) => [p.slug, p.features]),
);

/** slug → descrição do catálogo. A grade de Planos prefere isto ao `descricao`
 * que veio do banco (linhas seedadas antes da virada CRM ainda trazem texto ISP). */
export const PLAN_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  PLANS_CATALOG.map((p) => [p.slug, p.descricao]),
);

/** Slugs da grade vigente — qualquer plano fora disso é desativado no seed. */
export const CANONICAL_PLAN_SLUGS: string[] = PLANS_CATALOG.map((p) => p.slug);
