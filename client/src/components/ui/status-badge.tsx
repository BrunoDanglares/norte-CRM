import { cn } from "@/lib/utils";
import { getSituationTagColor, SITUATION_LABELS } from "@/lib/situation-tags";

type Size = "sm" | "md";

const SIZE = {
  sm: { box: "text-[10px] px-1.5 py-[2px] gap-1", dot: "w-1 h-1" },
  md: { box: "text-[11px] px-2 py-[3px] gap-1.5", dot: "w-1.5 h-1.5" },
} satisfies Record<Size, { box: string; dot: string }>;

type Props = {
  code: string;
  size?: Size;
  showLabel?: boolean;
  onClick?: (code: string) => void;
  className?: string;
};

export function StatusBadge({
  code,
  size = "md",
  showLabel = false,
  onClick,
  className,
}: Props) {
  const { bg, color } = getSituationTagColor(code);
  const label = SITUATION_LABELS[code];
  const dims = SIZE[size];
  const interactive = !!onClick;
  const Tag = interactive ? "button" : "span";

  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              onClick(code);
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border font-semibold tracking-wide tabular-nums transition-all duration-150",
        dims.box,
        interactive &&
          "cursor-pointer hover:-translate-y-px hover:shadow-sm active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className,
      )}
      style={{ backgroundColor: bg, color, borderColor: color }}
      title={label ? `${code} — ${label}` : code}
      aria-label={label ? `${code}: ${label}` : code}
      data-testid={`status-badge-${code}`}
    >
      <span
        className={cn("rounded-full flex-shrink-0", dims.dot)}
        style={{ background: color }}
        aria-hidden="true"
      />
      <span>{code}</span>
      {showLabel && label && (
        <span className="font-normal opacity-70">· {label}</span>
      )}
    </Tag>
  );
}
