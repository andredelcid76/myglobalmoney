// Datas do app. O dia "de hoje" segue o fuso do usuário (America/Sao_Paulo),
// não UTC — com toISOString(), entre 21h e meia-noite no Brasil o app já
// considerava "amanhã" (ajuste de saldo no dia errado, transação de hoje
// aparecendo como agendada).
const APP_TZ = "America/Sao_Paulo";

// YYYY-MM-DD de hoje no fuso do app (en-CA formata exatamente assim)
export function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(new Date());
}

// "Hoje" como Date UTC à meia-noite — para aritmética com getUTC*/setUTC*
export function todayUTCDate(): Date {
  return new Date(todayStr() + "T00:00:00Z");
}

// Avança meses preservando o dia e clampando ao fim do mês de destino.
// Evita o overflow do JS (31/jan + 1 mês → 3/mar) que fazia recorrências
// de dia 29–31 pularem fevereiro e derivarem de dia para sempre.
export function addMonthsClamped(d: Date, months: number, anchorDay?: number): Date {
  const day = anchorDay ?? d.getUTCDate();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base;
}

// Próxima ocorrência de uma recorrência. anchorDay mantém o dia-âncora
// original (ex.: dia 31) mesmo depois de atravessar meses curtos.
export function advanceByCadence(d: Date, cadence: string, anchorDay?: number): Date {
  if (cadence === "weekly") { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + 7); return x; }
  if (cadence === "biweekly") { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + 14); return x; }
  if (cadence === "quarterly") return addMonthsClamped(d, 3, anchorDay);
  if (cadence === "yearly") return addMonthsClamped(d, 12, anchorDay);
  return addMonthsClamped(d, 1, anchorDay); // monthly (default)
}

// Ocorrência anterior (usado para recuar até o início da janela do extrato)
export function retreatByCadence(d: Date, cadence: string, anchorDay?: number): Date {
  if (cadence === "weekly") { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() - 7); return x; }
  if (cadence === "biweekly") { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() - 14); return x; }
  if (cadence === "quarterly") return addMonthsClamped(d, -3, anchorDay);
  if (cadence === "yearly") return addMonthsClamped(d, -12, anchorDay);
  return addMonthsClamped(d, -1, anchorDay);
}
