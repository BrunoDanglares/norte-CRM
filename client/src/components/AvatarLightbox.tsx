// Lightbox simples pra abrir a FOTO do contato em tamanho grande (Bruno 2026-06-18).
// Overlay via portal (escapa de qualquer container), fecha no Esc ou clique no fundo.
// Mesmo estilo do visualizador de mídia do chat. Usado na ficha do contato (CustomerTab).
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { X } from "lucide-react";

export default function AvatarLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
        onClick={onClose}
        aria-label="Fechar"
      >
        <X size={28} />
      </button>
      <img
        src={src}
        alt={alt || "Foto do contato"}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
