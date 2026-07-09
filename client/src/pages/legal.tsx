// Páginas PÚBLICAS de Termos (/termos) e Privacidade (/privacidade) — acessíveis
// sem login. A URL pública da política é exigida pela verificação OAuth do Google
// e por boas práticas de transparência (LGPD). Bruno 2026-06-18.
import { Link } from "wouter";
import {
  LEGAL_ATUALIZADO,
  TERMOS_TITULO, TERMOS_SUBTITULO, TERMOS_SECTIONS,
  PRIVACIDADE_TITULO, PRIVACIDADE_SUBTITULO, PRIVACIDADE_INTRO, PRIVACIDADE_SECTIONS,
  type LegalSection,
} from "@/lib/legalContent";

export default function LegalPage({ doc }: { doc: "termos" | "privacidade" }) {
  const isPriv = doc === "privacidade";
  const titulo = isPriv ? PRIVACIDADE_TITULO : TERMOS_TITULO;
  const subtitulo = isPriv ? PRIVACIDADE_SUBTITULO : TERMOS_SUBTITULO;
  const sections: LegalSection[] = isPriv ? PRIVACIDADE_SECTIONS : TERMOS_SECTIONS;

  return (
    <div className="min-h-screen w-full bg-background text-foreground overflow-y-auto">
      {/* Topo */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
          <a href="/" className="font-extrabold tracking-tight text-base">
            Norte <span className="text-primary">Gestão</span>
          </a>
          <nav className="flex items-center gap-1 text-[12px] font-semibold">
            <Link href="/termos" className={`px-3 py-1.5 rounded-md ${!isPriv ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Termos</Link>
            <Link href="/privacidade" className={`px-3 py-1.5 rounded-md ${isPriv ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Privacidade</Link>
          </nav>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        <p className="text-[12px] text-muted-foreground mt-1">{subtitulo} · Última atualização: {LEGAL_ATUALIZADO}</p>

        {isPriv && (
          <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-[13px] leading-relaxed text-foreground/80">{PRIVACIDADE_INTRO}</p>
          </div>
        )}

        <div className="mt-5 space-y-3">
          {sections.map((section, i) => (
            <section key={i} className="rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-2.5 border-b border-border bg-muted/30">
                <span className="text-[13px] font-semibold">{section.title}</span>
              </div>
              <div className="px-5 py-3.5">
                <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-8 pt-5 border-t border-border text-center">
          <p className="text-[11px] text-muted-foreground">© 2026 Norte Gestão. Todos os direitos reservados.</p>
          <a href="/" className="inline-block mt-2 text-[12px] text-primary font-semibold hover:underline">← Voltar para o site</a>
        </footer>
      </main>
    </div>
  );
}
