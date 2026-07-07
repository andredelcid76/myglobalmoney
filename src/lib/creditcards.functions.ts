import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/paginated-query";
import { todayUTCDate, addMonthsClamped } from "@/lib/dates";

// Compute the statement (fatura) period containing `today` for a card with
// the given closing day. The period runs from the day AFTER the previous
// closing to the closing date itself. Due date falls on the next due_day
// after closing. All math in UTC.
function buildStatement(today: Date, closingDay: number, dueDay: number) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const day = today.getUTCDate();

  const lastDayOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const clamp = (yy: number, mm: number, d: number) => Math.min(d, lastDayOfMonth(yy, mm));

  let closeY = y;
  let closeM = m;
  if (day > clamp(y, m, closingDay)) {
    closeM = m + 1;
    if (closeM > 11) { closeM = 0; closeY = y + 1; }
  }
  const closeDate = new Date(Date.UTC(closeY, closeM, clamp(closeY, closeM, closingDay)));

  const prevCloseM0 = closeM - 1;
  const prevCloseY = prevCloseM0 < 0 ? closeY - 1 : closeY;
  const prevCloseM = (prevCloseM0 + 12) % 12;
  const prevClose = new Date(Date.UTC(prevCloseY, prevCloseM, clamp(prevCloseY, prevCloseM, closingDay)));
  const start = new Date(prevClose);
  start.setUTCDate(prevClose.getUTCDate() + 1);

  let dueY = closeY;
  let dueM = closeM;
  if (clamp(dueY, dueM, dueDay) < closeDate.getUTCDate()) {
    dueM += 1;
    if (dueM > 11) { dueM = 0; dueY += 1; }
  }
  const dueDate = new Date(Date.UTC(dueY, dueM, clamp(dueY, dueM, dueDay)));

  return { start, close: closeDate, due: dueDate };
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function shiftMonths(d: Date, months: number) {
  return addMonthsClamped(d, months);
}

export const getCreditCardStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [accRes, allTx] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId).eq("type", "credit_card").eq("is_archived", false),
      fetchAllPages<any>(() => supabase.from("transactions").select("*").eq("user_id", userId)),
    ]);
    if (accRes.error) throw new Error(accRes.error.message);

    const accounts = accRes.data ?? [];
    const today = todayUTCDate();
    const todayStr = ymd(today);

    const cards = accounts.map((a: any) => {
      const currency = (a.currency as string) ?? "USD";
      const closing = a.closing_day ?? null;
      const due = a.due_day ?? null;
      const allCardTx = allTx.filter((t: any) => t.account_id === a.id);

      // Cartão é mono-moeda: toda a conta opera numa moeda só, então tudo é
      // calculado no valor NATIVO (amount) — exato, sem depender da cotação USD.
      const nat = (t: any) => Number(t.amount ?? 0);
      const confirmedCardTx = allCardTx.filter((t: any) => !t.is_pending && t.date <= todayStr);
      const purchases = allCardTx.filter((t: any) => !t.is_transfer && !t.is_pending);

      // Saldo do cartão = saldo inicial + tudo (compras negativas, pagamentos positivos).
      const balance = Number(a.initial_balance || 0) + confirmedCardTx.reduce((s: number, t: any) => s + nat(t), 0);
      const totalOwed = Math.max(0, -balance);

      // Último pagamento: transferência recebida mais recente (pagamento de
      // fatura). Exclui "Ajuste de saldo" (calibração, não pagamento) e
      // estornos de compra (que não são transferência).
      const lastPaymentTx = confirmedCardTx
        .filter((t: any) => nat(t) > 0 && t.is_transfer && t.merchant !== "Ajuste de saldo")
        .sort((x: any, y: any) => (y.date as string).localeCompare(x.date as string))[0];
      const lastPayment = lastPaymentTx ? { date: lastPaymentTx.date as string, amount: nat(lastPaymentTx) } : null;

      const limit = a.credit_limit_usd != null ? Number(a.credit_limit_usd) : null;

      if (!closing || !due) {
        return {
          account: a, configured: false, currency,
          statements: [] as any[], currentTotal: 0, closedUnpaid: 0,
          totalOwed, limit, utilization: limit ? totalOwed / limit : null,
          lastPayment, openTransactions: purchases,
        };
      }

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
        const txs = purchases.filter((t: any) => t.date >= startStr && t.date <= closeStr);
        // Despesa é negativa, estorno positivo abate; clampa em zero.
        const spend = Math.max(0, -txs.reduce((sum: number, t: any) => sum + nat(t), 0));
        return { label, start: startStr, close: closeStr, due: ymd(s.due), transactions: txs, total: spend, count: txs.length };
      };

      const stPrev = buildSt(previous, "Fechada (a pagar)");
      const stCur = buildSt(current, "Em aberto");
      const stNext = buildSt(next, "Próxima");

      // A fatura fechada "a pagar" é o total devido MENOS o que já está no ciclo
      // aberto — não a soma bruta do ciclo passado (que ignora pagamentos feitos).
      const closedUnpaid = Math.max(0, totalOwed - stCur.total);
      stPrev.total = closedUnpaid;

      const hasClosed = closedUnpaid > 0.005 && stPrev.due >= todayStr;
      const utilization = limit ? totalOwed / limit : null;

      return {
        account: a, configured: true, currency,
        statements: [stPrev, stCur, stNext],
        currentTotal: stCur.total,
        closedUnpaid,
        totalOwed,
        limit,
        utilization,
        lastPayment,
        nextDue: hasClosed ? stPrev.due : stCur.due,
        nextDueIsClosed: hasClosed,
        openCycle: { start: stCur.start, close: stCur.close, due: stCur.due },
        previousCycle: { start: stPrev.start, close: stPrev.close, due: stPrev.due },
        openTransactions: stCur.transactions,
      };
    });

    return { cards };
  });
