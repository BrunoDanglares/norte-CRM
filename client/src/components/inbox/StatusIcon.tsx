import { Check, CheckCheck } from "lucide-react";

export default function StatusIcon({ status }: { status: string | null }) {
  if (status === "read") {
    return <CheckCheck className="msg-status-icon msg-status-read" />;
  }
  if (status === "delivered") {
    return <CheckCheck className="msg-status-icon msg-status-delivered" />;
  }
  if (status === "failed") {
    return <span className="text-[9px] text-red-500 leading-none">!</span>;
  }
  return <Check className="msg-status-icon msg-status-sent" />;
}
