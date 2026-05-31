import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Compute the statement (fatura) period containing `today` for a card with
// the given closing day. The period runs from the day AFTER the previous
// closing to the closing date itself. Due date falls on the next due_day
// after closing.
function buildStatement(today: Date, closingDay: number, dueDay: number) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const day = today.getDate();

  const lastDayOfMonth = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();
  const clamp = (yy: number, mm: number, d: number) => Math.min(d, lastDayOfMonth(yy, mm));

  // Closing date of the current cycle: if today already past this month's
  // closing, the cycle closes next month; otherwise it closes this month.
  let closeY = y;
  let closeM = m;
  if (day > clamp(y, m, closingDay)) {
    closeM = m + 1;
    if (closeM > 11) { closeM = 0; closeY = y + 1; }
  }
  const closeDate = new Date(closeY, closeM, clamp(closeY, closeM, closingDay));

  // Cycle start: day after the previous closing
  const prevCloseM0 = closeM - 1;
  const prevCloseY = prevCloseM0 < 0 ? closeY - 1 : closeY;
  const prevCloseM = (prevCloseM0 + 12) % 12;
  const prevClose = new Date(prevCloseY, prevCloseM, clamp(prevCloseY, prevCloseM, closingDay));
  const start = new Date(prevClose);
  start.setDate(prevClose.getDate() + 1);

  // Due date: next due_day on/after closeDate
  let dueY = closeY;
  let dueM = closeM;
  if (clamp(dueY, dueM, dueDay) < closeDate.getDate()) {
    dueM += 1;
    if (dueM > 11) { dueM = 0; dueY += 1; }
  }
  const dueDate = new Date(dueY, dueM, clamp(dueY, dueM, dueDay));

  return { start, close: closeDate, due: dueDate };
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftMonths(d: Date, months: number) {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

export const getCreditCardStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [accRes, txRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId).eq("type", "credit_card").eq("is_archived", false),
      supabase.from("transactions").select("*").eq("user_id", userId).eq("is_transfer", false),
    ]);
    if (accRes.error) throw new Error(accRes.error.message);
    if (txRes.error) throw new Error(txRes.error.message);

    const accounts = accRes.data ?? [];
    const allTx = txRes.data ?? [];
    const today = new Date();

    const cards = accounts.map((a: any) => {
      const closing = a.closing_day ?? null;
      const due = a.due_day ?? null;
      const cardTx = allTx.filter((t: any) => t.account_id === a.id);

      if (!closing || !due) {
        return {
          account: a,
          configured: false,
          statements: [] as any[],
          currentTotalUsd: 0,
          openTransactions: cardTx,
        };
      }

      // Build 3 statements: previous, current (open), next
      const current = buildStatement(today, closing, due);
      const previous = {
        start: shiftMonths(current.start, -1),
        close: shiftMonths(current.close, -1),
        due: shiftMonths(current.due, -1),
      };
      const next = {
        start: shiftMonths(current.start, 1),
        close: shiftMonths(current.close, 1),
        due: shiftMonths(current.due, 1),
      };

      const buildSt = (s: typeof current, label: string) => {
        const startStr = ymd(s.start);
        const closeStr = ymd(s.close);
        const txs = cardTx.filter((t: any) => t.date >= startStr && t.date <= closeStr);
        const totalUsd = txs.reduce((sum: number, t: any) => sum + Math.abs(Number(t.amount_usd) || 0), 0);
        return {
          label,
          start: startStr,
          close: closeStr,
          due: ymd(s.due),
          transactions: txs,
          totalUsd,
          count: txs.length,
        };
      };

      const stPrev = buildSt(previous, "Anterior");
      const stCur = buildSt(current, "Atual (em aberto)");
      const stNext = buildSt(next, "Próxima");

      const utilization = a.credit_limit_usd ? stCur.totalUsd / Number(a.credit_limit_usd) : null;

      return {
        account: a,
        configured: true,
        statements: [stPrev, stCur, stNext],
        currentTotalUsd: stCur.totalUsd,
        utilization,
        nextDue: stCur.due,
        openTransactions: stCur.transactions,
      };
    });

    return { cards };
  });