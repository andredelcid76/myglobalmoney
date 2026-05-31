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

/**
 * Extract view: groups transactions by day/week/month and computes running balance.
 * Balance is computed in USD when accountId is "all", otherwise in the account currency.
 */
export const getLedgerView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    accountId: z.string().uuid().nullable().optional(),
    from: z.string(),
    to: z.string(),
    granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [accRes, txInRes, txBeforeRes] = await Promise.all([
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

    // Group
    type Bucket = {
      key: string; start: string; end: string; label: string;
      income: number; expense: number; count: number;
      transactions: any[];
    };
    const buckets = new Map<string, Bucket>();
    const txList = txInRes.data ?? [];
    // Categories for label lookup
    const catRes = await supabase.from("categories").select("id,name").eq("user_id", userId);
    const catMap = new Map((catRes.data ?? []).map((c) => [c.id, c.name as string]));

    let transferIn = 0, transferOut = 0, incomeTotal = 0, expenseTotal = 0;
    // Flat entries with running balance
    const entries: any[] = [];
    let runningTx = opening;
    for (const t of txList) {
      const b = bucketKey(t.date as string, data.granularity);
      const cur = buckets.get(b.key) ?? { key: b.key, start: b.start, end: b.end, label: b.label, income: 0, expense: 0, count: 0, transactions: [] };
      const amt = useUsd ? Number(t.amount_usd) : Number(t.amount);
      if (amt >= 0) cur.income += amt; else cur.expense += -amt;
      cur.count += 1;
      if ((t as any).is_transfer) {
        if (amt >= 0) transferIn += amt; else transferOut += -amt;
      } else {
        if (amt >= 0) incomeTotal += amt; else expenseTotal += -amt;
      }
      runningTx += amt;
      const entry = {
        id: t.id, date: t.date, merchant: t.merchant,
        amount: amt, currency,
        category_id: t.category_id,
        category_name: t.category_id ? (catMap.get(t.category_id as string) ?? null) : null,
        account_id: t.account_id,
        is_transfer: !!(t as any).is_transfer,
        notes: (t as any).notes ?? null,
        balance: runningTx,
      };
      entries.push(entry);
      cur.transactions.push({
        id: t.id, date: t.date, merchant: t.merchant,
        amount: useUsd ? Number(t.amount_usd) : Number(t.amount),
        currency, category_id: t.category_id, account_id: t.account_id,
        category_name: entry.category_name,
        is_transfer: entry.is_transfer,
        balance: runningTx,
      });
      buckets.set(b.key, cur);
    }

    const sorted = Array.from(buckets.values()).sort((a, b) => a.start.localeCompare(b.start));
    let running = opening;
    const periods = sorted.map((b) => {
      const net = b.income - b.expense;
      running += net;
      return { ...b, net, balance: running };
    });

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
        net: incomeTotal + transferIn - expenseTotal - transferOut,
      },
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, color: a.color })),
    };
  });