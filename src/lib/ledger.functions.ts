import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Granularity = "daily" | "weekly" | "monthly";

function startOfWeekUTC(d: Date) {
  const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diff = (dd.getUTCDay() + 6) % 7;
  dd.setUTCDate(dd.getUTCDate() - diff);
  return dd;
}
function endOfWeekUTC(d: Date) {
  const s = startOfWeekUTC(d);
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  return e;
}
function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function bucketKey(dateStr: string, gran: Granularity): { key: string; start: string; end: string; label: string } {
  const d = new Date(dateStr + "T00:00:00Z");
  if (gran === "daily") {
    return { key: dateStr, start: dateStr, end: dateStr, label: dateStr };
  }
  if (gran === "weekly") {
    const s = startOfWeekUTC(d);
    const e = endOfWeekUTC(d);
    return { key: fmt(s), start: fmt(s), end: fmt(e), label: `${fmt(s).slice(5)} – ${fmt(e).slice(5)}` };
  }
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { key: fmt(s).slice(0, 7), start: fmt(s), end: fmt(e), label: fmt(s).slice(0, 7) };
}

function advanceByCadence(d: Date, c: string): Date {
  const dd = new Date(d.getTime());
  if (c === "weekly") dd.setUTCDate(dd.getUTCDate() + 7);
  else if (c === "biweekly") dd.setUTCDate(dd.getUTCDate() + 14);
  else if (c === "monthly") dd.setUTCMonth(dd.getUTCMonth() + 1);
  else if (c === "quarterly") dd.setUTCMonth(dd.getUTCMonth() + 3);
  else if (c === "yearly") dd.setUTCFullYear(dd.getUTCFullYear() + 1);
  else dd.setUTCMonth(dd.getUTCMonth() + 1);
  return dd;
}

type Status = "confirmed" | "scheduled" | "pending" | "projected";
type Source = "real" | "recurrence" | "budget" | "cc_invoice";

/**
 * Extract view: combines real transactions with projected future entries
 * (recurrences, fixed-budget categories, credit-card invoices) and computes
 * a running balance over the visible window.
 *
 * Status legend:
 *  - confirmed: real transaction with date <= today
 *  - scheduled: real transaction with date > today, OR a recurrence/projection in the future
 *  - pending:   a recurrence whose next_date is in the past but no matching real tx exists
 *  - projected: budget-derived line (fixed monthly expense, future cc invoice)
 */
export const getLedgerView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    accountId: z.string().uuid().nullable().optional(),
    from: z.string(),
    to: z.string(),
    granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
    includeProjections: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [accRes, txInRes, txBeforeRes, recRes, budgetsRes, catsRes] = await Promise.all([
      supabase.from("accounts").select("id,name,currency,initial_balance,color").eq("user_id", userId),
      (() => {
        let q = supabase.from("transactions").select("id,date,merchant,amount,amount_usd,currency,category_id,account_id,is_transfer,notes")
          .eq("user_id", userId).gte("date", data.from).lte("date", data.to).order("date");
        if (data.accountId) q = q.eq("account_id", data.accountId);
        return q;
      })(),
      (() => {
        let q = supabase.from("transactions").select("amount,amount_usd,account_id")
          .eq("user_id", userId).lt("date", data.from);
        if (data.accountId) q = q.eq("account_id", data.accountId);
        return q;
      })(),
      supabase.from("recurrences").select("*").eq("user_id", userId).eq("is_active", true),
      supabase.from("budgets").select("month,amount_usd,budget_type,category_id").eq("user_id", userId),
      supabase.from("categories").select("id,name,color,parent_id,is_income,budget_group").eq("user_id", userId),
    ]);

    const accounts = accRes.data ?? [];
    const useUsd = !data.accountId;
    const account = data.accountId ? accounts.find((a) => a.id === data.accountId) : null;
    const currency = useUsd ? "USD" : (account?.currency ?? "USD");

    // Opening balance
    let opening = 0;
    if (useUsd) {
      opening = accounts.reduce((s, a) => s + Number(a.initial_balance ?? 0), 0);
      for (const t of txBeforeRes.data ?? []) opening += Number(t.amount_usd ?? 0);
    } else if (account) {
      opening = Number(account.initial_balance ?? 0);
      for (const t of txBeforeRes.data ?? []) opening += Number(t.amount ?? 0);
    }

    const cats = (catsRes.data ?? []) as any[];
    const catMap = new Map(cats.map((c) => [c.id as string, c]));
    const today = new Date();
    const todayStr = fmt(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
    const fromD = new Date(data.from + "T00:00:00Z");
    const toD = new Date(data.to + "T00:00:00Z");

    // ---- Build raw entry list (real + projected)
    type Entry = {
      id: string; date: string; merchant: string;
      amount: number; currency: string;
      category_id: string | null; category_name: string | null;
      account_id: string | null;
      is_transfer: boolean; notes: string | null;
      status: Status; source: Source;
      balance?: number;
    };
    const entriesRaw: Entry[] = [];

    const realTxByMonth = new Map<string, { merchant: string; cat: string | null }[]>();
    for (const t of txInRes.data ?? []) {
      const amt = useUsd ? Number(t.amount_usd) : Number(t.amount);
      const isFuture = (t.date as string) > todayStr;
      entriesRaw.push({
        id: t.id as string,
        date: t.date as string,
        merchant: t.merchant as string,
        amount: amt,
        currency,
        category_id: (t.category_id as string | null) ?? null,
        category_name: t.category_id ? (catMap.get(t.category_id as string)?.name ?? null) : null,
        account_id: (t.account_id as string | null) ?? null,
        is_transfer: !!(t as any).is_transfer,
        notes: ((t as any).notes ?? null) as string | null,
        status: isFuture ? "scheduled" : "confirmed",
        source: "real",
      });
      const mk = (t.date as string).slice(0, 7);
      const arr = realTxByMonth.get(mk) ?? [];
      arr.push({ merchant: (t.merchant as string)?.toLowerCase() ?? "", cat: (t.category_id as string | null) ?? null });
      realTxByMonth.set(mk, arr);
    }

    if (data.includeProjections) {
      const recs = (recRes.data ?? []) as any[];
      const defaultAccId = (() => {
        if (data.accountId) return data.accountId;
        const nonCC = accounts.filter((a) => true);
        return nonCC[0]?.id ?? null;
      })();

      // ---- Recurrences within window
      for (const r of recs) {
        if (data.accountId && r.account_id && r.account_id !== data.accountId) continue;
        const accId = (r.account_id as string | null) ?? defaultAccId;
        if (data.accountId && !accId) continue;
        // Compute occurrence dates
        let d = new Date((r.next_date as string) + "T00:00:00Z");
        // Roll backward to catch overdue within window if any
        let guard = 0;
        while (d > fromD && guard < 60) {
          const prev = (() => {
            const x = new Date(d);
            if (r.cadence === "weekly") x.setUTCDate(x.getUTCDate() - 7);
            else if (r.cadence === "biweekly") x.setUTCDate(x.getUTCDate() - 14);
            else if (r.cadence === "monthly") x.setUTCMonth(x.getUTCMonth() - 1);
            else if (r.cadence === "quarterly") x.setUTCMonth(x.getUTCMonth() - 3);
            else if (r.cadence === "yearly") x.setUTCFullYear(x.getUTCFullYear() - 1);
            else x.setUTCMonth(x.getUTCMonth() - 1);
            return x;
          })();
          if (prev < fromD) break;
          d = prev;
          guard++;
        }
        // Roll forward to first >= fromD
        guard = 0;
        while (d < fromD && guard < 200) { d = advanceByCadence(d, r.cadence as string); guard++; }
        // Emit while in window
        guard = 0;
        while (d <= toD && guard < 200) {
          const ds = fmt(d);
          const mk = ds.slice(0, 7);
          // Dedupe: if a real tx already exists in same month with matching merchant pattern, skip
          const pattern = ((r.merchant_pattern as string | null) ?? (r.name as string) ?? "").toLowerCase().trim();
          const realInMonth = realTxByMonth.get(mk) ?? [];
          const matched = pattern.length >= 3 && realInMonth.some((rt) =>
            (pattern && rt.merchant.includes(pattern)) ||
            (r.category_id && rt.cat === r.category_id)
          );
          if (!matched) {
            const amt = Math.abs(Number(r.amount_usd ?? 0)) * (r.is_income ? 1 : -1);
            const isPast = ds < todayStr;
            entriesRaw.push({
              id: `rec_${r.id}_${ds}`,
              date: ds,
              merchant: r.name as string,
              amount: amt,
              currency,
              category_id: (r.category_id as string | null) ?? null,
              category_name: r.category_id ? (catMap.get(r.category_id as string)?.name ?? null) : null,
              account_id: accId,
              is_transfer: false,
              notes: null,
              status: isPast ? "pending" : "scheduled",
              source: "recurrence",
            });
          }
          d = advanceByCadence(d, r.cadence as string);
          guard++;
        }
      }

      // ---- Fixed-budget categories: project one entry per month (on day 1) for the
      // budgeted amount minus what was already spent in that month from real txs.
      const budgets = (budgetsRes.data ?? []) as any[];
      // Sum real expense by (category_id, month) for current view
      const realExpByCatMonth = new Map<string, number>(); // key = cat|month
      for (const t of txInRes.data ?? []) {
        if ((t as any).is_transfer) continue;
        const amt = useUsd ? Number(t.amount_usd) : Number(t.amount);
        if (amt >= 0) continue;
        const cat = (t.category_id as string | null) ?? null;
        if (!cat) continue;
        const k = `${cat}|${(t.date as string).slice(0, 7)}`;
        realExpByCatMonth.set(k, (realExpByCatMonth.get(k) ?? 0) + -amt);
      }

      // Find fixed budget rows within visible months
      const visibleMonths = new Set<string>();
      {
        const cur = new Date(Date.UTC(fromD.getUTCFullYear(), fromD.getUTCMonth(), 1));
        while (cur <= toD) {
          visibleMonths.add(fmt(cur).slice(0, 7));
          cur.setUTCMonth(cur.getUTCMonth() + 1);
        }
      }
      for (const b of budgets) {
        const mk = (b.month as string).slice(0, 7);
        if (!visibleMonths.has(mk)) continue;
        const cat = catMap.get(b.category_id as string);
        if (!cat || cat.is_income) continue;
        const isFixed = b.budget_type === "fixed" || cat.budget_group === "fixa";
        if (!isFixed) continue;
        if (data.accountId) continue; // fixed budgets aren't per-account
        const budgeted = Number(b.amount_usd ?? 0);
        const already = realExpByCatMonth.get(`${b.category_id}|${mk}`) ?? 0;
        const remaining = Math.max(0, budgeted - already);
        if (remaining <= 0) continue;
        // Date: pick day matching the budget (default 5th), but only future from today
        const monthStart = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 5));
        const ds = fmt(monthStart);
        if (ds < todayStr && !visibleMonths.has(mk.slice(0, 7))) continue;
        // Skip past months entirely (we only project forward; past is what really happened)
        const monthIsPast = mk < todayStr.slice(0, 7);
        if (monthIsPast) continue;
        // If current month, place on max(today, original date) so it doesn't show "today" again retroactively
        const finalDs = ds < todayStr ? todayStr : ds;
        entriesRaw.push({
          id: `bud_${b.category_id}_${mk}`,
          date: finalDs,
          merchant: `${cat.name} (orçado)`,
          amount: -remaining,
          currency,
          category_id: b.category_id as string,
          category_name: cat.name as string,
          account_id: null,
          is_transfer: false,
          notes: null,
          status: "projected",
          source: "budget",
        });
      }

      // ---- Future credit card invoices (only when viewing "all" or that specific CC)
      if (!data.accountId) {
        // Compute current balance per credit-card account (USD)
        const balByAcc = new Map<string, number>();
        for (const a of accounts) balByAcc.set(a.id, Number(a.initial_balance ?? 0));
        // We need all transactions to compute today balance; reuse before + within
        for (const t of txBeforeRes.data ?? []) {
          balByAcc.set((t as any).account_id, (balByAcc.get((t as any).account_id) ?? 0) + Number((t as any).amount_usd ?? 0));
        }
        for (const t of txInRes.data ?? []) {
          if ((t.date as string) <= todayStr) {
            balByAcc.set(t.account_id as string, (balByAcc.get(t.account_id as string) ?? 0) + Number(t.amount_usd ?? 0));
          }
        }
        for (const a of accounts as any[]) {
          if (a.type !== "credit_card") continue;
          const owed = -(balByAcc.get(a.id) ?? 0);
          if (owed <= 0) continue;
          const dueDay = Math.min(a.due_day ?? 10, 28);
          // Next due >= today
          let due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), dueDay));
          if (fmt(due) < todayStr) due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, dueDay));
          const ds = fmt(due);
          if (ds >= data.from && ds <= data.to) {
            entriesRaw.push({
              id: `cc_${a.id}_${ds}`,
              date: ds,
              merchant: `Fatura ${a.name}`,
              amount: -owed,
              currency,
              category_id: null,
              category_name: "Pagamento de cartão",
              account_id: null,
              is_transfer: false,
              notes: null,
              status: "projected",
              source: "cc_invoice",
            });
          }
        }
      }
    }

    // ---- Sort by date (real confirmed first within same day)
    entriesRaw.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const order: Record<Status, number> = { confirmed: 0, pending: 1, scheduled: 2, projected: 3 };
      return order[a.status] - order[b.status];
    });

    // ---- Running balance + per-period aggregation
    type Bucket = {
      key: string; start: string; end: string; label: string;
      income: number; expense: number; count: number;
      transactions: any[];
    };
    const buckets = new Map<string, Bucket>();
    let transferIn = 0, transferOut = 0, incomeTotal = 0, expenseTotal = 0;
    let projectedIn = 0, projectedOut = 0;
    let running = opening;
    const entries: any[] = [];
    for (const e of entriesRaw) {
      running += e.amount;
      const withBal = { ...e, balance: running };
      entries.push(withBal);
      const b = bucketKey(e.date, data.granularity);
      const cur = buckets.get(b.key) ?? { key: b.key, start: b.start, end: b.end, label: b.label, income: 0, expense: 0, count: 0, transactions: [] };
      if (e.amount >= 0) cur.income += e.amount; else cur.expense += -e.amount;
      cur.count += 1;
      cur.transactions.push(withBal);
      buckets.set(b.key, cur);
      const isReal = e.source === "real";
      const isProj = !isReal;
      if (e.is_transfer) {
        if (e.amount >= 0) transferIn += e.amount; else transferOut += -e.amount;
      } else if (isReal) {
        if (e.amount >= 0) incomeTotal += e.amount; else expenseTotal += -e.amount;
      } else if (isProj) {
        if (e.amount >= 0) projectedIn += e.amount; else projectedOut += -e.amount;
      }
    }

    const periods = Array.from(buckets.values())
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => ({ ...b, net: b.income - b.expense, balance: 0 }));
    // recompute period.balance as last entry balance in the bucket
    for (const p of periods) {
      p.balance = p.transactions.length ? p.transactions[p.transactions.length - 1].balance : opening;
    }

    return {
      opening,
      currency,
      accountName: account?.name ?? "Todas as contas",
      periods,
      closing: running,
      entries,
      totals: {
        income: incomeTotal,
        expense: expenseTotal,
        transferIn,
        transferOut,
        projectedIncome: projectedIn,
        projectedExpense: projectedOut,
        net: incomeTotal + transferIn - expenseTotal - transferOut,
      },
      today: todayStr,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, color: a.color })),
      categories: (catsRes.data ?? []).map((c: any) => ({ id: c.id, name: c.name, color: c.color, parent_id: c.parent_id })),
    };
  });