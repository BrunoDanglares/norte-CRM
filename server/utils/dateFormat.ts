export function formatDateBR(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';

  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (yyyymmdd) return `${yyyymmdd[3]}/${yyyymmdd[2]}/${yyyymmdd[1]}`;

  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateStr);
  if (ddmmyyyy) return dateStr;

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');

  return dateStr;
}
