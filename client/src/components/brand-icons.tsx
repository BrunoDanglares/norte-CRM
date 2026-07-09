import { SiWhatsapp, SiInstagram, SiOpenai, SiStripe, SiMeta } from "react-icons/si";
export function WhatsAppIcon({ className = "w-4 h-4", style }: { className?: string; style?: React.CSSProperties }) {
  return <SiWhatsapp className={className} style={{ color: "#25d366", ...style }} />;
}

export function InstagramIcon({ className = "w-4 h-4", style }: { className?: string; style?: React.CSSProperties }) {
  return <SiInstagram className={className} style={{ color: "#e1306c", ...style }} />;
}

export function OpenAIIcon({ className = "w-4 h-4", style }: { className?: string; style?: React.CSSProperties }) {
  return <SiOpenai className={className} style={{ color: "#10a37f", ...style }} />;
}

export function StripeIcon({ className = "w-4 h-4", style }: { className?: string; style?: React.CSSProperties }) {
  return <SiStripe className={className} style={{ color: "#6772e5", ...style }} />;
}


export function CanalIcon({ canal, className = "w-4 h-4" }: { canal: string; className?: string }) {
  const lower = canal.toLowerCase();
  if (lower.startsWith("whatsapp")) return <WhatsAppIcon className={className} />;
  if (lower.startsWith("instagram")) return <InstagramIcon className={className} />;
  return null;
}
