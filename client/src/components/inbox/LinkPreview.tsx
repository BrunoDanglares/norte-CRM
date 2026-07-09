import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// Bruno 2026-05-20: card de preview Open Graph pra URLs em mensagens. Consulta
// /api/link-preview (que tem cache em memória no backend) e renderiza title +
// descrição + imagem. Fica visualmente discreto na bolha — quando o fetch falha
// ou OG está vazio, o componente simplesmente não renderiza nada (o link já
// aparece como <a> normal no corpo da mensagem).

interface LinkPreviewProps {
  url: string;
  isOut: boolean;
}

interface PreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export default function LinkPreview({ url, isOut }: LinkPreviewProps) {
  const { data, isLoading } = useQuery<{ ok: boolean; data?: PreviewData }>({
    queryKey: ["link-preview", url],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/link-preview?url=${encodeURIComponent(url)}`);
      return r.json();
    },
    staleTime: 12 * 60 * 60 * 1000, // 12h — bate com o cache do backend
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className={`mt-1.5 rounded-md overflow-hidden border-l-[3px] ${isOut ? "border-black/50 bg-black/5" : "border-primary bg-foreground/5"}`}>
        <div className="px-2.5 py-2 text-[11px] opacity-60">Carregando preview…</div>
      </div>
    );
  }

  const preview = data?.ok ? data.data : undefined;
  if (!preview || (!preview.title && !preview.image)) return null;

  const accent = isOut ? "border-black/60" : "border-primary";
  const bg = isOut ? "bg-black/10 hover:bg-black/15" : "bg-foreground/8 hover:bg-foreground/12";
  const labelColor = isOut ? "text-black/70" : "text-primary";
  const titleColor = isOut ? "text-black/90" : "text-foreground";
  const descColor = isOut ? "text-black/65" : "text-foreground/75";

  return (
    <a
      href={preview.url || url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block mt-1.5 rounded-md overflow-hidden border-l-[3px] ${accent} ${bg} transition-colors no-underline max-w-[280px]`}
      data-testid={`link-preview-${url}`}
    >
      {preview.image && (
        <div className="relative w-full h-[120px] bg-black/5 overflow-hidden">
          <img
            src={preview.image}
            alt={preview.title || "Preview"}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            loading="lazy"
          />
        </div>
      )}
      <div className="px-2.5 py-2">
        {preview.siteName && (
          <div className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 inline-flex items-center gap-1 ${labelColor}`}>
            <ExternalLink className="w-2.5 h-2.5" />
            {preview.siteName}
          </div>
        )}
        {preview.title && (
          <div className={`text-[12.5px] font-semibold leading-snug line-clamp-2 ${titleColor}`}>
            {preview.title}
          </div>
        )}
        {preview.description && (
          <div className={`text-[11px] mt-0.5 leading-snug line-clamp-2 ${descColor}`}>
            {preview.description}
          </div>
        )}
      </div>
    </a>
  );
}
