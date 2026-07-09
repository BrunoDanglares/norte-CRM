import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-base-200 px-4">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-6">
          <div className="w-24 h-24 rounded-full grid place-items-center" style={{ background: "hsl(var(--primary) / 0.10)" }}>
            <Compass className="w-11 h-11 text-primary" strokeWidth={1.6} />
          </div>
        </div>

        <h1 className="text-7xl font-bold text-base-content mb-2 tabular-nums tracking-tight">
          4<span className="text-primary">0</span>4
        </h1>
        <h2 className="text-xl font-bold text-base-content mb-3">
          Essa página não foi encontrada
        </h2>
        <p className="text-sm text-base-content/60 leading-relaxed mb-8 max-w-sm mx-auto">
          O endereço que você tentou acessar não existe (ou ainda não foi criado). Volte pra home que a gente te encaminha pro lugar certo.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/">
            <Button className="h-11 px-6 font-bold">
              <Home className="w-4 h-4 mr-2" />Ir pra home
            </Button>
          </Link>
          <Button
            variant="outline"
            className="h-11 px-6 font-semibold"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />Voltar
          </Button>
        </div>
      </div>
    </div>
  );
}
