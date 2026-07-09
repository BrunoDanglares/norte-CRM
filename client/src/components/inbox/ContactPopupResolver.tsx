import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetchRaw } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ContactProfilePanel from "@/components/ContactProfilePanel";

// Bruno 2026-06-19: resolve a ficha aberta pelo nome no header da conversa.
// Antes era um IIFE inline no inbox que só casava contra `contactsData`
// (/api/contacts é PAGINADA, teto 100 por createdAt). Em tenant grande tipo a
// Nekt, o contato de uma conversa antiga/resolvida fica FORA da página → a
// ficha dava "Ficha não disponível" mesmo existindo no banco.
//
// Agora, quando o match na lista cacheada falha, busca o contato pontualmente
// por telefone (GET /api/contacts/by-phone). Só desiste (toast) se o fallback
// terminar sem achar — ou se não houver telefone pra buscar (ex: lead de
// Instagram que não bateu por nome).

const normalizeName = (s: string | null | undefined) =>
  (s || "").trim().toLowerCase().replace(/\s+/g, " ");

interface Props {
  selected: any;
  contactsData?: any[];
  leadsData?: any[];
  availableTags?: any[];
  open: boolean;
  onClose: () => void;
}

export default function ContactPopupResolver({
  selected,
  contactsData,
  leadsData,
  availableTags,
  open,
  onClose,
}: Props) {
  const { toast } = useToast();

  const matchPhone = (selected?.telefone || "").replace(/\D/g, "").slice(-10);
  const selectedNomeN = normalizeName(selected?.nome);

  const matchedContact = (contactsData || []).find((c: any) =>
    (c.telefone && matchPhone && matchPhone.length >= 8 && c.telefone.replace(/\D/g, "").slice(-10) === matchPhone) ||
    (selectedNomeN && normalizeName(c.nome) === selectedNomeN),
  );
  const matchedLead = !matchedContact ? (leadsData || []).find((l: any) =>
    (selectedNomeN && (normalizeName(l.nome) === selectedNomeN || normalizeName(l.contato) === selectedNomeN)) ||
    (l.instagramId && selected?.telefone && l.instagramId === selected.telefone) ||
    (l.telefone && matchPhone && matchPhone.length >= 8 && l.telefone.replace(/\D/g, "").slice(-10) === matchPhone),
  ) : null;

  const cachedEntity = matchedContact || matchedLead;

  // Fallback por telefone — só quando a lista cacheada não bateu.
  const phoneDigits = (selected?.telefone || "").replace(/\D/g, "");
  const byPhoneApplicable = phoneDigits.length >= 8;
  const byPhoneQuery = useQuery({
    queryKey: ["/api/contacts/by-phone", phoneDigits],
    enabled: open && !cachedEntity && byPhoneApplicable,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await apiFetchRaw(`/api/contacts/by-phone?telefone=${encodeURIComponent(phoneDigits)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Falha ao buscar contato");
      return res.json();
    },
  });

  const entity = cachedEntity || byPhoneQuery.data || null;
  const kind: "contact" | "lead" = matchedContact ? "contact" : matchedLead ? "lead" : "contact";

  // Desiste quando: não há entidade E (o fallback não se aplica OU já terminou).
  const byPhoneSettled = byPhoneQuery.isSuccess || byPhoneQuery.isError;
  const giveUp = !entity && (!byPhoneApplicable || (byPhoneSettled && !byPhoneQuery.isFetching));

  useEffect(() => {
    if (!open || entity || !giveUp) return;
    console.warn("[ContactPopup] entity não encontrada — selected:", {
      nome: selected?.nome,
      telefone: selected?.telefone,
      contactsCount: contactsData?.length || 0,
      leadsCount: leadsData?.length || 0,
    });
    onClose();
    toast({
      title: "Ficha não disponível",
      description: "Não encontrei o cadastro deste contato. Verifique em /contatos.",
      variant: "destructive",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entity, giveUp]);

  if (!entity) return null;
  return (
    <ContactProfilePanel
      open={open}
      onClose={onClose}
      entity={entity as any}
      entityKind={kind}
      availableTags={availableTags as any}
    />
  );
}
