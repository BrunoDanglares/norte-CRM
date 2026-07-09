// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — PERFIS DE SEGMENTO (Fase 1, Bruno 2026-07-09).
//
// O pipeline hoje assume UM mundo: delivery de comida. Isso trava o Diretor de Arte
// (foto de comida) e o "cardápio" (sorteia um prato). Um Perfil de Segmento dá "a
// cara" de cada nicho: quem é o HERÓI da imagem, o gênero fotográfico, a luz, se pode
// mostrar TELA (crítico p/ SaaS), como usar produtosServicos e quais estilos aparecem.
//
// São PRESETS curados em código (não tabela por-tenant). Adicionar segmento = adicionar
// um objeto aqui. O tenant escolhe o slug no brand kit (coluna `segmento`); sem escolha,
// cai em `generico` (neutro premium) — nada muda no comportamento até ele escolher.
//
// Módulo-folha: zero deps de app (só o tipo do schema), pra ser importado pelo pipeline
// sem risco de ciclo.
// ═══════════════════════════════════════════════════════════════════════════

import type { InstaflixBrandKit } from "@shared/schema";

// Como o pipeline deve tratar produtosServicos por segmento:
//   rotaciona → sorteia 1 item p/ destacar (delivery: cardápio)
//   catalogo  → catálogo de produtos físicos (moda, eletrônicos)
//   planos    → planos/modalidades/serviços (academia, serviço local)
//   features  → recursos/benefícios (SaaS) — NÃO é "produto apetitoso", é dor resolvida
//   nenhum    → não usa
export type CardapioMode = "rotaciona" | "catalogo" | "planos" | "features" | "nenhum";

export interface SegmentoPerfil {
  slug: string;
  nome: string;                 // rótulo na UI

  heroiPT: string;              // pt-BR (estrategista/copy): "o prato", "a peça de roupa"…
  heroiEN: string;              // EN (prompt de imagem): "the dish", "the garment worn by a model"…

  arte: {
    generoFoto: string;         // EN: gênero fotográfico
    descritores: string;        // EN: descritores premium ESPECÍFICOS do segmento (quando a cena é do herói)
    cenaTipica: string;         // EN: cenário/contexto default
    luz: string;                // EN: regra de luz/fundo (varia! moda quer editorial, tech quer minimal)
    evitar: string;             // EN: "avoid: ..."
    heroiEhTela: boolean;       // libera mostrar tela/UI limpa (SaaS/eletrônicos precisam)
  };

  // Como tratar produtosServicos (resolve o "cardápio atropela pilar" por segmento).
  cardapioMode: CardapioMode;
  cardapioLabel: string;        // "cardápio" | "catálogo" | "recursos" | "planos/serviços"
  focoVerboPT: string;          // pt: como pedir o destaque no estado "foco forçado"

  estilosAplicaveis: string[];  // subset de estilos que fazem sentido no segmento
  tomDefaultPT: string;         // tom sugerido se o brand kit não tiver tomVoz
}

// ── Os 6 segmentos + fallback genérico ────────────────────────────────────────
export const SEGMENTOS: Record<string, SegmentoPerfil> = {
  delivery: {
    slug: "delivery",
    nome: "Delivery / Comida",
    heroiPT: "o prato / produto",
    heroiEN: "the dish or food product, hero shot",
    arte: {
      generoFoto: "professional food photography",
      descritores: "mouth-watering hero shot, premium food styling, glossy highlights, steam and freshness cues, crisp macro texture, 45-degree or top-down hero angle",
      cenaTipica: "the dish beautifully plated, or premium delivery packaging (kraft box) at the moment of receiving the order",
      luz: "bright natural daylight, neutral white balance, clean bright airy background, true-to-life food colors",
      evitar: "homemade, amateur, casual kitchen snapshot, cluttered table, warm/golden/dark moody lighting",
      heroiEhTela: false,
    },
    cardapioMode: "rotaciona",
    cardapioLabel: "cardápio",
    focoVerboPT: "destaque e ofereça de forma apetitosa (dê água na boca, porção generosa)",
    estilosAplicaveis: ["promocional", "engajamento", "informativo", "institucional", "prova_social", "sazonal", "bastidores"],
    tomDefaultPT: "descontraído, apetitoso e convidativo",
  },

  saas: {
    slug: "saas",
    nome: "Software / SaaS",
    heroiPT: "a tela do produto ou o resultado que ele entrega",
    heroiEN: "a clean abstract app dashboard on a device, or the outcome it delivers",
    arte: {
      generoFoto: "modern tech product photography and clean UI mockup",
      descritores: "sleek minimal composition, floating device mockup, crisp vector-clean interface elements, subtle depth shadow, generous negative space, modern SaaS aesthetic",
      cenaTipica: "a floating laptop/phone showing a clean abstract dashboard, or a 'before: chaotic paperwork → after: organized panel' concept",
      luz: "bright neutral studio light, cool clean palette, lots of white space, soft gradient background",
      evitar: "food, generic stock businesspeople shaking hands, cheesy corporate clichés, real customer data, real competitor logos",
      heroiEhTela: true,
    },
    cardapioMode: "features",
    cardapioLabel: "recursos do produto",
    focoVerboPT: "destaque este recurso pela DOR que ele resolve (não como 'produto apetitoso')",
    estilosAplicaveis: ["informativo", "promocional", "institucional", "engajamento", "prova_social", "comparativo", "tutorial", "bastidores", "antes_depois"],
    tomDefaultPT: "claro, confiável e direto ao ponto",
  },

  moda: {
    slug: "moda",
    nome: "Moda / Loja de roupa",
    heroiPT: "a peça vestida em uma modelo / o look",
    heroiEN: "the garment worn by a model, full styled look",
    arte: {
      generoFoto: "fashion editorial / lookbook photography",
      descritores: "editorial fashion shot, model wearing the outfit with a confident pose, fabric texture and drape visible, magazine cover quality, styled full look",
      cenaTipica: "a model wearing the outfit in a clean studio or stylish urban backdrop; or an elegant styled flat-lay",
      luz: "editorial lighting (may be bold/directional), studio backdrop or urban context, fashion-magazine mood",
      evitar: "food, clothing tossed with no context, unnatural body proportions, dull hanger-only shots",
      heroiEhTela: false,
    },
    cardapioMode: "catalogo",
    cardapioLabel: "catálogo de peças",
    focoVerboPT: "destaque a peça como objeto de desejo (caimento, textura, styling)",
    estilosAplicaveis: ["lookbook", "promocional", "engajamento", "informativo", "institucional", "prova_social", "sazonal", "bastidores"],
    tomDefaultPT: "estiloso, aspiracional e próximo",
  },

  eletronicos: {
    slug: "eletronicos",
    nome: "Celular / Eletrônicos",
    heroiPT: "o aparelho / gadget",
    heroiEN: "the device or gadget, hero product shot",
    arte: {
      generoFoto: "premium product photography on a seamless backdrop",
      descritores: "hero product shot, floating device, dramatic rim light, glossy reflective surface, tech-premium look, macro detail on ports and screen edges",
      cenaTipica: "the device floating on a seamless gradient backdrop, Apple-style hero angle; screen may show an abstract wallpaper (never a real app or brand)",
      luz: "studio light, can be high-contrast/dramatic tech mood, seamless gradient backdrop",
      evitar: "food, device on a messy desk, real competitor logos or app UIs, amateur snapshot",
      heroiEhTela: true,
    },
    cardapioMode: "catalogo",
    cardapioLabel: "catálogo de modelos",
    focoVerboPT: "destaque o aparelho como objeto de desejo premium (design, tela, specs visuais)",
    estilosAplicaveis: ["promocional", "comparativo", "informativo", "engajamento", "institucional", "prova_social", "tutorial", "sazonal"],
    tomDefaultPT: "moderno, técnico e desejável",
  },

  fitness: {
    slug: "fitness",
    nome: "Academia / Fitness",
    heroiPT: "o corpo em ação / o resultado / o ambiente da academia",
    heroiEN: "an athlete mid-workout, a body transformation, or the gym space",
    arte: {
      generoFoto: "energetic fitness action photography",
      descritores: "dynamic athletic shot, motion and effort, sweat and determination, aspirational physique, gym environment, high-energy angle",
      cenaTipica: "an athlete mid-lift or in dynamic motion in an energetic gym; or a clean 'before/after' aspirational transformation",
      luz: "high-energy, can be bold and contrasty, gym lighting",
      evitar: "food (unless clean nutrition), static lifeless poses, unrealistic bodies, dull environment",
      heroiEhTela: false,
    },
    cardapioMode: "planos",
    cardapioLabel: "planos e modalidades",
    focoVerboPT: "mostre o resultado/transformação aspiracional que o plano entrega",
    estilosAplicaveis: ["antes_depois", "engajamento", "informativo", "promocional", "institucional", "prova_social", "tutorial", "sazonal", "bastidores"],
    tomDefaultPT: "motivador, energético e encorajador",
  },

  servico_local: {
    slug: "servico_local",
    nome: "Serviço local (barbearia, clínica, salão)",
    heroiPT: "o resultado do serviço / o ambiente / o profissional em ação",
    heroiEN: "the service result, the space, or the professional at work",
    arte: {
      generoFoto: "warm lifestyle service photography",
      descritores: "inviting professional environment, clean modern space, the professional at work, visible client satisfaction, trustworthy premium feel",
      cenaTipica: "the professional working in a stylish modern space, a satisfied client, or a clean 'before/after' of the service result",
      luz: "clean and welcoming (clinic = clinical/bright; barbershop/salon may be more stylish/moody)",
      evitar: "food, empty lifeless space, amateur appearance, clutter",
      heroiEhTela: false,
    },
    cardapioMode: "planos",
    cardapioLabel: "serviços e procedimentos",
    focoVerboPT: "mostre o resultado do serviço e o cuidado/experiência do cliente",
    estilosAplicaveis: ["antes_depois", "prova_social", "institucional", "informativo", "promocional", "engajamento", "sazonal", "bastidores"],
    tomDefaultPT: "acolhedor, profissional e confiável",
  },

  barbearia: {
    slug: "barbearia",
    nome: "Barbearia",
    heroiPT: "o corte/barba pronto no cliente / o ambiente estiloso da barbearia",
    heroiEN: "a fresh haircut or sharp beard on a confident client, or the stylish barbershop",
    arte: {
      generoFoto: "stylish barbershop grooming lifestyle photography",
      descritores: "sharp fresh haircut and beard detail, confident client, stylish modern barbershop, masculine premium grooming, crisp texture",
      cenaTipica: "the barber finishing a cut while the client admires the result, or a stylish barbershop interior",
      luz: "stylish and modern; may be moody/directional (barbershop vibe) or clean and bright",
      evitar: "food, sterile clinical look, empty lifeless chair, amateur snapshot",
      heroiEhTela: false,
    },
    cardapioMode: "planos",
    cardapioLabel: "serviços (corte, barba, combos)",
    focoVerboPT: "mostre o resultado do corte/barba e o estilo do cliente",
    estilosAplicaveis: ["antes_depois", "prova_social", "engajamento", "promocional", "institucional", "informativo", "sazonal", "bastidores"],
    tomDefaultPT: "estiloso, masculino e descolado",
  },

  clinica_medica: {
    slug: "clinica_medica",
    nome: "Clínica médica",
    heroiPT: "o cuidado / o profissional acolhedor / o ambiente moderno da clínica",
    heroiEN: "a caring doctor reassuring a patient, or a clean modern medical clinic",
    arte: {
      generoFoto: "clean and warm healthcare lifestyle photography",
      descritores: "trustworthy caring professional, modern clean clinic, reassuring warmth, health and wellbeing, human and approachable",
      cenaTipica: "a friendly doctor talking calmly with a reassured patient, or a bright welcoming clinic reception",
      luz: "clean, bright, calm and trustworthy — soft natural light, never cold or scary",
      evitar: "food, blood or graphic medical scenes, scary hospital mood, cold sterile look, real identifiable patients",
      heroiEhTela: false,
    },
    cardapioMode: "planos",
    cardapioLabel: "especialidades e serviços",
    focoVerboPT: "comunique cuidado e confiança sobre a especialidade/serviço, sem sensacionalismo nem promessa de cura",
    estilosAplicaveis: ["informativo", "prova_social", "institucional", "engajamento", "promocional", "sazonal", "bastidores"],
    tomDefaultPT: "acolhedor, confiável e cuidadoso",
  },

  clinica_odonto: {
    slug: "clinica_odonto",
    nome: "Clínica odontológica",
    heroiPT: "o sorriso do paciente / o resultado / o consultório moderno",
    heroiEN: "a bright confident smile, or a clean modern dental office",
    arte: {
      generoFoto: "clean bright dental and smile lifestyle photography",
      descritores: "bright healthy smile, confident happy patient, spotless modern dental office, fresh and hygienic, reassuring",
      cenaTipica: "a patient with a radiant smile, the dentist reassuring a patient, or an immaculate modern office",
      luz: "very clean, bright, white and fresh, hygienic feel",
      evitar: "food, scary drills or graphic procedures, cold sterile look, any gore",
      heroiEhTela: false,
    },
    cardapioMode: "planos",
    cardapioLabel: "tratamentos (clareamento, implante, ortodontia…)",
    focoVerboPT: "destaque o resultado (sorriso) e a confiança do tratamento",
    estilosAplicaveis: ["antes_depois", "prova_social", "informativo", "institucional", "promocional", "engajamento", "sazonal", "bastidores"],
    tomDefaultPT: "confiável, cuidadoso e otimista",
  },

  laboratorio: {
    slug: "laboratorio",
    nome: "Laboratório (análises clínicas)",
    heroiPT: "a precisão/tecnologia do laboratório / o cuidado com a prevenção",
    heroiEN: "a modern clinical lab with precise clean technology, or a calm caring collection moment",
    arte: {
      generoFoto: "clean clinical laboratory photography",
      descritores: "precise modern laboratory, clean advanced technology, trustworthy accuracy, health and prevention, sterile-clean but human",
      cenaTipica: "a modern lab with clean equipment, or a friendly professional during a calm, non-graphic collection",
      luz: "very clean and bright, cool-clinical but never cold or scary",
      evitar: "food, graphic blood/needle close-ups, scary mood, mess or clutter",
      heroiEhTela: false,
    },
    cardapioMode: "planos",
    cardapioLabel: "exames e check-ups",
    focoVerboPT: "comunique precisão, prevenção e cuidado sobre o exame/check-up",
    estilosAplicaveis: ["informativo", "prova_social", "institucional", "promocional", "engajamento", "sazonal", "bastidores"],
    tomDefaultPT: "preciso, confiável e preventivo",
  },

  contabilidade: {
    slug: "contabilidade",
    nome: "Escritório de contabilidade",
    heroiPT: "a tranquilidade de estar em dia / a organização financeira / o contador parceiro",
    heroiEN: "a relieved organized business owner, or a clean concept of financial clarity",
    arte: {
      generoFoto: "clean professional business services photography and concept",
      descritores: "organized professional, clean modern office, trust and relief, financial clarity, tidy charts and documents, confident business owner",
      cenaTipica: "a calm business owner in control of organized finances, or a clean 'paper chaos → organized panel' concept",
      luz: "clean bright professional, neutral corporate palette, generous space",
      evitar: "food, cheesy stock handshakes, messy paper piles (unless the 'before'), cold or dull",
      heroiEhTela: true,
    },
    cardapioMode: "features",
    cardapioLabel: "serviços contábeis",
    focoVerboPT: "destaque o serviço pela DOR que resolve (tranquilidade fiscal, tempo, evitar multa) — não como 'produto apetitoso'",
    estilosAplicaveis: ["informativo", "institucional", "prova_social", "promocional", "engajamento", "comparativo", "tutorial", "bastidores"],
    tomDefaultPT: "confiável, claro e tranquilizador",
  },

  supermercado: {
    slug: "supermercado",
    nome: "Supermercado",
    heroiPT: "os produtos frescos / a variedade / a oferta do dia",
    heroiEN: "fresh appealing groceries or a product on offer, abundant and fresh",
    arte: {
      generoFoto: "fresh retail grocery product photography",
      descritores: "fresh vibrant groceries, abundant variety, appetizing produce, clean bright supermarket feel, everyday value",
      cenaTipica: "fresh produce beautifully arranged, a featured product hero, or an abundant basket of variety",
      luz: "bright fresh clean daylight, vibrant true-to-life colors",
      evitar: "amateur, dull, cluttered messy shelves, warm/dark moody lighting",
      heroiEhTela: false,
    },
    cardapioMode: "rotaciona",
    cardapioLabel: "produtos e ofertas",
    focoVerboPT: "destaque o produto de forma fresca e apetitosa, com sensação de variedade e valor",
    estilosAplicaveis: ["promocional", "informativo", "engajamento", "prova_social", "institucional", "sazonal", "bastidores"],
    tomDefaultPT: "próximo, econômico e do dia a dia",
  },

  drogaria: {
    slug: "drogaria",
    nome: "Drogaria / Farmácia",
    heroiPT: "o produto de saúde/beleza / o cuidado / a conveniência",
    heroiEN: "a health or beauty product hero shot, clean and trustworthy",
    arte: {
      generoFoto: "clean pharmacy health & beauty product photography",
      descritores: "clean product hero shot, health and wellbeing, trustworthy and fresh, dermocosmetic premium, hygienic clean",
      cenaTipica: "a health or beauty product on a clean bright surface, or a caring, convenient pharmacy moment",
      luz: "clean bright white, fresh and hygienic, true-to-life",
      evitar: "food, scary medical imagery, clutter, dark or warm moody lighting",
      heroiEhTela: false,
    },
    cardapioMode: "catalogo",
    cardapioLabel: "produtos e ofertas",
    focoVerboPT: "destaque o produto de saúde/beleza de forma limpa, confiável e desejável",
    estilosAplicaveis: ["promocional", "informativo", "prova_social", "institucional", "engajamento", "sazonal", "tutorial", "bastidores"],
    tomDefaultPT: "cuidadoso, confiável e acessível",
  },

  motopecas: {
    slug: "motopecas",
    nome: "Motopeças",
    heroiPT: "a peça/acessório de moto / a moto / o desempenho",
    heroiEN: "a motorcycle part or accessory hero shot, or a motorcycle",
    arte: {
      generoFoto: "automotive product and motorcycle lifestyle photography",
      descritores: "hero product shot of the part, precise mechanical detail, rugged premium quality, chrome and metal texture, motorcycle-culture energy",
      cenaTipica: "the part on a clean or industrial backdrop with dramatic light, or a motorcycle in a stylish garage",
      luz: "may be dramatic and industrial, high contrast, metallic reflections (garage/asphalt vibe)",
      evitar: "food, dull flat lighting, greasy messy clutter, amateur snapshot",
      heroiEhTela: false,
    },
    cardapioMode: "catalogo",
    cardapioLabel: "peças e acessórios",
    focoVerboPT: "destaque a peça pela qualidade/desempenho (detalhe mecânico, encaixe, durabilidade)",
    estilosAplicaveis: ["promocional", "comparativo", "informativo", "engajamento", "prova_social", "institucional", "tutorial", "sazonal"],
    tomDefaultPT: "direto, técnico e apaixonado por moto",
  },

  autopecas: {
    slug: "autopecas",
    nome: "Autopeças",
    heroiPT: "a peça automotiva / o carro / a confiança da manutenção",
    heroiEN: "an auto part hero shot, or a car in a clean modern workshop",
    arte: {
      generoFoto: "automotive product photography",
      descritores: "hero product shot of the auto part, precise mechanical detail, durable premium quality, metal and chrome texture, clean or industrial backdrop",
      cenaTipica: "the auto part on a seamless or industrial backdrop with dramatic light, or a car in a clean modern workshop",
      luz: "studio or industrial, may be dramatic high contrast with metallic reflections",
      evitar: "food, greasy messy clutter (unless intentional), dull flat lighting, amateur",
      heroiEhTela: false,
    },
    cardapioMode: "catalogo",
    cardapioLabel: "peças",
    focoVerboPT: "destaque a peça pela qualidade/confiança (compatibilidade, durabilidade, desempenho)",
    estilosAplicaveis: ["promocional", "comparativo", "informativo", "engajamento", "prova_social", "institucional", "tutorial", "sazonal"],
    tomDefaultPT: "confiável, técnico e direto",
  },

  generico: {
    slug: "generico",
    nome: "Outro / Genérico",
    heroiPT: "o produto ou serviço em destaque",
    heroiEN: "the product or lifestyle scene, premium and versatile",
    arte: {
      generoFoto: "premium commercial product/lifestyle photography",
      descritores: "clean premium composition, crisp detail, appealing styling, editorial quality",
      cenaTipica: "the product or the moment of use, presented in a clean premium way",
      luz: "bright natural light, neutral white balance, clean versatile background",
      evitar: "amateur, cluttered, dull, washed-out, warm/dark moody lighting",
      heroiEhTela: false,
    },
    cardapioMode: "catalogo",
    cardapioLabel: "produtos/serviços",
    focoVerboPT: "destaque o produto/serviço de forma premium e desejável",
    estilosAplicaveis: ["informativo", "promocional", "institucional", "engajamento", "prova_social", "sazonal"],
    tomDefaultPT: "profissional, claro e próximo",
  },
};

// Slugs válidos (para validar entrada e montar o dropdown da UI).
export const SEGMENTO_SLUGS = Object.keys(SEGMENTOS);

// Resolve o perfil do tenant a partir do brand kit. Sem `segmento` (ou inválido) →
// 'generico' (neutro premium). O pipeline decide, com base no perfil, se templatiza a
// direção de arte ou mantém o comportamento atual (ver instaflixStudio).
export function resolveSegmento(bk: InstaflixBrandKit | null | undefined): SegmentoPerfil {
  const slug = String((bk as any)?.segmento || "").trim();
  return SEGMENTOS[slug] || SEGMENTOS.generico;
}

// O tenant escolheu um segmento explicitamente? (define se o pipeline usa o template
// por-segmento ou mantém o prompt food-first legado até o cliente optar).
export function temSegmentoDefinido(bk: InstaflixBrandKit | null | undefined): boolean {
  const slug = String((bk as any)?.segmento || "").trim();
  return !!SEGMENTOS[slug];
}
