import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Calendar, Clock, ChevronLeft, ChevronRight } from "lucide-react";

const QUICK_DATES = [
  { label: "Hoje", offset: 0 },
  { label: "Amanhã", offset: 1 },
  { label: "Em 2 dias", offset: 2 },
  { label: "Em 3 dias", offset: 3 },
  { label: "Em 1 semana", offset: 7 },
  { label: "Em 2 semanas", offset: 14 },
];

// Grade de dia INTEIRO em passos de 30min (00:00 … 23:30) — sem lacunas e cobrindo
// horário nobre (21h/22h) e madrugada. Bruno 2026-07-08.
const QUICK_TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function formatDateBR(dateStr: string): string {
  if (!dateStr) return "";
  if (dateStr.includes("-")) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

function getDateFromOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getDateFromOffsetISO(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useDropdownPosition(triggerRef: React.RefObject<HTMLElement | null>, open: boolean, dropdownHeight: number, dropdownWidth: number) {
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false });

  const update = useCallback(() => {
    if (!triggerRef.current || !open) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < dropdownHeight + 8 && spaceAbove > spaceBelow;
    const top = openUp ? rect.top - dropdownHeight - 4 : rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 8);
    setPos({ top, left: Math.max(8, left), openUp });
  }, [open, dropdownHeight, dropdownWidth, triggerRef]);

  useEffect(() => {
    update();
    if (!open) return;
    // Enquanto aberto, reancora o popup ao rolar/redimensionar. capture:true pega o
    // scroll de containers internos (.overflow-auto), não só o da window. Bruno 2026-07-08.
    const onMove = () => update();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [update, open]);

  return pos;
}

interface MiniCalendarProps {
  value: string;
  onChange: (val: string) => void;
  format?: "br" | "iso";
}

function MiniCalendar({ value, onChange, format = "br" }: MiniCalendarProps) {
  const today = new Date();
  const parsed = value ? (format === "iso" ? new Date(value + "T00:00:00") : (() => {
    const p = value.split("/");
    return p.length >= 2 ? new Date(Number(p[2] || today.getFullYear()), Number(p[1]) - 1, Number(p[0])) : today;
  })()) : today;

  const [viewMonth, setViewMonth] = useState(parsed.getMonth());
  const [viewYear, setViewYear] = useState(parsed.getFullYear());

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    if (format === "iso") onChange(`${viewYear}-${m}-${d}`);
    else onChange(`${d}/${m}/${viewYear}`);
  };

  const isSelected = (day: number) => {
    if (!value) return false;
    if (format === "iso") return value === `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return value === `${String(day).padStart(2, "0")}/${String(viewMonth + 1).padStart(2, "0")}/${viewYear}`;
  };

  const isToday = (day: number) => day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-secondary transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-bold">{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-secondary transition-colors">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-center text-[9px] font-semibold text-muted-foreground py-0.5">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDay }).map((_, i) => <span key={`e-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => selectDay(day)}
            className={`w-7 h-7 rounded-md text-[10.5px] font-medium transition-all ${
              isSelected(day)
                ? "bg-primary text-primary-foreground font-bold"
                : isToday(day)
                ? "bg-primary/15 text-primary font-bold ring-1 ring-primary/30"
                : "hover:bg-secondary text-foreground"
            }`}
          >
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}

interface DatePickerProps {
  value: string;
  onChange: (val: string) => void;
  format?: "br" | "iso";
  placeholder?: string;
  name?: string;
  className?: string;
  "data-testid"?: string;
  required?: boolean;
}

export function DatePicker({ value, onChange, format = "br", placeholder = "DD/MM/AAAA", name, className, required, ...props }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pos = useDropdownPosition(triggerRef, open, 330, 280);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={triggerRef} className="relative">
      <div className="relative">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={format === "iso" ? formatDateBR(value) : value}
          readOnly
          onClick={() => setOpen(!open)}
          placeholder={placeholder}
          className={`w-full bg-secondary border border-border rounded-lg py-1.5 pl-8 pr-3 text-[11.5px] text-foreground outline-none cursor-pointer hover:border-primary/50 focus:border-primary transition-colors ${className || ""}`}
          data-testid={props["data-testid"]}
        />
        {name && <input type="hidden" name={name} value={value} required={required} />}
      </div>
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-background border border-border rounded-xl shadow-2xl w-[280px] overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap gap-1 p-2 border-b border-border">
            {QUICK_DATES.map((q) => (
              <button
                key={q.offset}
                type="button"
                onClick={() => { onChange(format === "iso" ? getDateFromOffsetISO(q.offset) : getDateFromOffset(q.offset)); setOpen(false); }}
                className="px-2 py-1 rounded-md text-[10px] font-medium bg-secondary hover:bg-primary/15 hover:text-primary transition-colors border border-transparent hover:border-primary/20"
              >
                {q.label}
              </button>
            ))}
          </div>
          <MiniCalendar value={value} onChange={(v) => { onChange(v); setOpen(false); }} format={format} />
        </div>,
        document.body
      )}
    </div>
  );
}

interface TimePickerProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  name?: string;
  className?: string;
  "data-testid"?: string;
  required?: boolean;
}

export function TimePicker({ value, onChange, placeholder = "HH:MM", name, className, required, ...props }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const pos = useDropdownPosition(triggerRef, open, 230, 180);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [open]);

  return (
    <div ref={triggerRef} className="relative">
      <div className="relative">
        <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={value}
          readOnly
          onClick={() => setOpen(!open)}
          placeholder={placeholder}
          className={`w-full bg-secondary border border-border rounded-lg py-1.5 pl-8 pr-3 text-[11.5px] text-foreground outline-none cursor-pointer hover:border-primary/50 focus:border-primary transition-colors ${className || ""}`}
          data-testid={props["data-testid"]}
        />
        {name && <input type="hidden" name={name} value={value} required={required} />}
      </div>
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-background border border-border rounded-xl shadow-2xl w-[180px] overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-h-[220px] overflow-y-auto p-1.5 grid grid-cols-3 gap-0.5">
            {/* Inclui o valor atual mesmo se fora da grade (ex.: 14:37) pra não perdê-lo. */}
            {(value && !QUICK_TIMES.includes(value) ? [value, ...QUICK_TIMES] : QUICK_TIMES).map((t) => (
              <button
                key={t}
                type="button"
                ref={value === t ? selectedRef : undefined}
                onClick={() => { onChange(t); setOpen(false); }}
                className={`px-1.5 py-1.5 rounded-md text-[10.5px] font-medium transition-all ${
                  value === t
                    ? "bg-primary text-primary-foreground font-bold"
                    : "hover:bg-secondary text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

interface DateTimePickerProps {
  dateValue: string;
  timeValue: string;
  onDateChange: (val: string) => void;
  onTimeChange: (val: string) => void;
  dateFormat?: "br" | "iso";
  dateName?: string;
  timeName?: string;
  dateTestId?: string;
  timeTestId?: string;
  required?: boolean;
}

export function DateTimePicker({ dateValue, timeValue, onDateChange, onTimeChange, dateFormat = "br", dateName, timeName, dateTestId, timeTestId, required }: DateTimePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Data</label>
        <DatePicker value={dateValue} onChange={onDateChange} format={dateFormat} name={dateName} data-testid={dateTestId} required={required} />
      </div>
      <div className="space-y-1">
        <label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Hora</label>
        <TimePicker value={timeValue} onChange={onTimeChange} name={timeName} data-testid={timeTestId} required={required} />
      </div>
    </div>
  );
}

interface DateTimeLocalPickerProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  className?: string;
  "data-testid"?: string;
}

export function DateTimeLocalPicker({ value, onChange, label, className, ...props }: DateTimeLocalPickerProps) {
  const dateVal = value ? value.split("T")[0] : "";
  const timeVal = value ? value.split("T")[1]?.substring(0, 5) || "" : "";

  return (
    <div className={className}>
      {label && <label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">{label}</label>}
      <div className="grid grid-cols-2 gap-2">
        <DatePicker
          value={dateVal}
          onChange={(d) => onChange(`${d}T${timeVal || "09:00"}`)}
          format="iso"
          data-testid={props["data-testid"] ? `${props["data-testid"]}-date` : undefined}
        />
        <TimePicker
          value={timeVal}
          onChange={(t) => onChange(`${dateVal || getDateFromOffsetISO(0)}T${t}`)}
          data-testid={props["data-testid"] ? `${props["data-testid"]}-time` : undefined}
        />
      </div>
    </div>
  );
}
