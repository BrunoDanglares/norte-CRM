// Bruno 2026-05-21: picker de localização pra enviar via composer.
// Sem deps adicionais (sem Leaflet) — usa OSM Nominatim pra geocoder + tile
// estático pra preview. Atendente digita endereço, clica "Buscar", confirma.
// Custo: 1 fetch público no Nominatim por busca. Sem chave de API, mas tem
// rate limit ~1 req/s — adequado pra uso humano.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, X, MapPin, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LocationPickerDialogProps {
  open: boolean;
  conversationId: number;
  onClose: () => void;
}

interface GeocodeResult {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

function lngToTileX(lng: number, z: number): number {
  return Math.floor((lng + 180) / 360 * Math.pow(2, z));
}
function latToTileY(lat: number, z: number): number {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
}

export default function LocationPickerDialog({ open, conversationId, onClose }: LocationPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const [searching, setSearching] = useState(false);
  const { toast } = useToast();

  const search = async () => {
    const q = query.trim();
    if (q.length < 3) {
      toast({ title: "Digite um endereço", description: "Mínimo 3 caracteres.", variant: "destructive" });
      return;
    }
    setSearching(true);
    setResult(null);
    try {
      // Nominatim — User-Agent obrigatório, limite ~1 req/s (uso humano OK).
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) {
        toast({ title: "Endereço não encontrado", description: "Tente ser mais específico.", variant: "destructive" });
        return;
      }
      const hit = arr[0];
      setResult({
        latitude: parseFloat(hit.lat),
        longitude: parseFloat(hit.lon),
        name: hit.display_name.split(",").slice(0, 2).join(",").trim() || q,
        address: hit.display_name,
      });
    } catch (err: any) {
      toast({ title: "Erro na busca", description: err?.message || "Falha ao consultar mapa.", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("Nenhuma localização selecionada");
      return apiRequest("POST", `/api/conversations/${conversationId}/send-location`, {
        latitude: result.latitude,
        longitude: result.longitude,
        name: result.name,
        address: result.address,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      toast({ title: "Localização enviada", description: "Cliente vai receber agora." });
      setQuery("");
      setResult(null);
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });

  if (!open) return null;
  const z = 14;
  const tileX = result ? lngToTileX(result.longitude, z) : 0;
  const tileY = result ? latToTileY(result.latitude, z) : 0;
  const tileUrl = result ? `https://tile.openstreetmap.org/${z}/${tileX}/${tileY}.png` : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-rose-500" />
            <h3 className="text-[13px] font-semibold">Enviar localização</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-3 border-b border-border/70">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                placeholder="Endereço (ex: Av. Paulista, 1000, São Paulo)"
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                data-testid="input-location-query"
              />
            </div>
            <button
              type="button"
              onClick={search}
              disabled={searching || query.trim().length < 3}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              data-testid="btn-search-location"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Buscar"}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">Dica: inclua cidade/estado pra precisão maior.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[180px]">
          {!result && !searching && (
            <div className="text-center py-8 text-muted-foreground text-[12px]">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Digite um endereço e clique em buscar.
            </div>
          )}
          {result && (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-lg border border-border">
                <img
                  src={tileUrl}
                  alt="Mapa"
                  className="w-full h-[160px] object-cover bg-muted"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <MapPin className="w-9 h-9 text-rose-500 drop-shadow-lg" fill="currentColor" />
                </div>
              </div>
              <div className="text-[12.5px] font-semibold">{result.name}</div>
              <div className="text-[11px] text-muted-foreground">{result.address}</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {result.latitude.toFixed(5)}, {result.longitude.toFixed(5)}
              </div>
            </div>
          )}
        </div>

        {result && (
          <div className="px-4 py-3 border-t border-border/70 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResult(null)}
              className="px-3 py-1.5 rounded-md text-[11.5px] font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              Buscar outro
            </button>
            <button
              type="button"
              onClick={() => sendMut.mutate()}
              disabled={sendMut.isPending}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity inline-flex items-center gap-1.5"
              data-testid="btn-send-location"
            >
              {sendMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
              Enviar localização
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
