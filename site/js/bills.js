const timeZone = 'America/Sao_Paulo';
const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

// Mês no formato "AAAA-MM"; valores inválidos caem no mês atual.
export function parseMonth(value, now = new Date()) {
  const match = monthPattern.exec(String(value ?? ''));
  if (match) return `${match[1]}-${match[2]}`;
  return todayIso(now).slice(0, 7);
}

export function shiftMonth(month, delta) {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month) {
  const label = monthName.format(new Date(`${month}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
