import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/paginated-query";

type Granularity = "weekly" | "monthly" | "quarterly";

function startOfWeekUTC(d: Date) {
  const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diff = (dd.getUTCDay() + 6) % 7;
  dd.setUTCDate(dd.getUTCDate() - diff);
  return dd;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function advanceByCadence(d: Date, c: string): Date {
  const dd = new Date(d.getTime());
  if (c === "weekly") dd.setUTCDate(dd.getUTCDate() + 7);
  else if (c === "biweekly") dd.setUTCDate(dd.getUTCDate() + 14);
  else if (c === "monthly") dd.setUTCMonth(dd.getUTCMonth() + 1);
  else if (c === "quarterly") dd.setUTCMonth(dd.getUTCMonth() + 3);
  else if (c === "yearly") dd.setUTCFullYear(dd.getUTCFullYear() + 1);
  return dd;
}
function fmt(d: Date) { return d.toISOString().slice(0, 10); }

/**
 * Detailed cashflow projection. Returns per-period series with per-account balances,
 * detailed line items (recurrences, budget variable, goal contributions, CC invoices),
 * and overall stats.
 */
export const getCashflowPro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    granularity: z.enum(["weekly", "monthly", "quarterly"]).default("monthly"),
    horizonMonths: z.number().int().min(1).max(24).default(6),
    incomeAdjustPct: z.number().min(-100).max(200).default(0),
    expenseAdjustPct: z.number().min(-100).max(200).default(0),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const horizonEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + data.horizonMonths + 1, 0));

    // Build buckets
    type Bucket = { start: Date; end: Date; label: string; days: number };
    const buckets: Bucket[] = [];
    if (data.granularity === "weekly") {
      const weeks = Math.ceil((horizonEnd.getTime() - today.getTime()) / (7 * 86400000));
      let cur = startOfWeekUTC(today);
      for (let i = 0; i < weeks; i++) {
        const end = addDays(cur, 6);
        buckets.push({ start: cur, end, days: 7, label: `${fmt(cur).slice(5)}` });
        cur = addDays(cur, 7);
      }
    } else if (data.granularity === "monthly") {
      for (let i = 0; i < data.horizonMonths; i++) {
        const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
        const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        buckets.push({ start: s, end: e, days, label: fmt(s).slice(0, 7) });
      }
    } else {
      const qMonth = Math.floor(today.getUTCMonth() / 3) * 3;
      const qs = Math.ceil(data.horizonMonths / 3);
      for (let i = 0; i < qs; i++) {
        const s = new Date(Date.UTC(today.getUTCFullYear(), qMonth + i * 3, 1));
        const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, 0));
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        const q = Math.floor(s.getUTCMonth() / 3) + 1;
        buckets.push({ start: s, end: e, days, label: `${s.getUTCFullYear()} Q${q}` });
      }
    }

    const horizonStop = buckets[buckets.length - 1].end;

    const histStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    const todayStr = fmt(today);
    const [accRes, recsRes, budgetsRes, goalsRes, txRecentRows, allTxRows, ratesRes] = await Promise.all([
      sb.from("accounts").select("*").eq("user_id", userId).eq("is_archived", false),
      sb.from("recurrences").select("*").eq("user_id", userId).eq("is_active", true),
      sb.from("budgets").select("month, amount_usd, budget_type, category_id").eq("user_id", userId),
      sb.from("goals").select("*").eq("user_id", userId).eq("is_archived", false),
      fetchAllPages<any>(() => sb.from("transactions").select("date, amount_usd, account_id, is_transfer, is_pending")
        .eq("user_id", userId).gte("date", fmt(histStart)).lte("date", todayStr)),
      fetchAllPages<any>(() => sb.from("transactions").select("amount_usd, account_id, date, is_pending").eq("user_id", userId).lte("date", todayStr)),
      sb.from("exchange_rates").select("base, quote, rate, date").order("date", { ascending: false }).limit(200),
    ]);

    const accounts = (accRes.data ?? []) as any[];
    const recs = (recsRes.data ?? []) as any[];
    const budgets = (budgetsRes.data ?? []) as any[];
    const goals = (goalsRes.data ?? []) as any[];

    // Latest FX rate per currency → USD
    const latestToUsd = new Map<string, number>();
    latestToUsd.set("USD", 1);
    for (const r of ratesRes.data ?? []) {
      const base = r.base as string, quote = r.quote as string;
      const rate = Number(r.rate);
      if (base === "USD" && !latestToUsd.has(quote)) latestToUsd.set(quote, 1 / rate);
      if (quote === "USD" && !latestToUsd.has(base)) latestToUsd.set(base, rate);
    }
    const toUsd = (amount: number, currency: string) => {
      const f = latestToUsd.get(currency);
      return f != null ? amount * f : amount;
    };

    // ---- Per-account opening balance (today)
    const balByAccount = new Map<string, number>();
    for (const a of accounts) balByAccount.set(a.id, Number(a.initial_balance ?? 0));
    for (const t of allTxRows) {
      if (t.is_pending) continue;
      const cur = balByAccount.get(t.account_id) ?? 0;
      balByAccount.set(t.account_id, cur + Number(t.amount_usd ?? 0));
    }
    const startBalances: Record<string, number> = {};
    for (const a of accounts) startBalances[a.id] = balByAccount.get(a.id) ?? 0;

    // ---- Historical daily averages (per all accounts, USD)
    const hist = txRecentRows.filter((t) => !t.is_transfer && !t.is_pending);
    const histDays = Math.max(1, Math.round((today.getTime() - histStart.getTime()) / 86400000));
    let hIn = 0, hOut = 0;
    for (const t of hist) {
      const amt = Number(t.amount_usd);
      if (amt >= 0) hIn += amt; else hOut += -amt;
    }
    const avgInPerDay = hIn / histDays;
    const avgOutPerDay = hOut / histDays;

    // ---- Default account: pick primary (largest balance, non-credit) for unassigned recurrences/budgets
    const defaultAcc = accounts
      .filter((a) => a.type !== "credit_card")
      .sort((a, b) => (balByAccount.get(b.id) ?? 0) - (balByAccount.get(a.id) ?? 0))[0]?.id
      ?? accounts[0]?.id ?? null;

    // ---- Recurrence occurrences within horizon
    type Item = {
      date: string; bucket: number;
      account_id: string | null; amount: number; isIncome: boolean;
      source: "recurrence" | "budget" | "goal" | "cc_invoice"; label: string;
    };
    const items: Item[] = [];
    function bucketOf(d: Date): number {
      for (let i = 0; i < buckets.length; i++) {
        if (d >= buckets[i].start && d <= buckets[i].end) return i;
      }
      return -1;
    }

    const incAdj = 1 + data.incomeAdjustPct / 100;
    const expAdj = 1 + data.expenseAdjustPct / 100;

    for (const r of recs) {
      const cad = r.cadence as string;
      const endDate = r.end_date ? new Date((r.end_date as string) + "T00:00:00Z") : null;
      let d = new Date((r.next_date as string) + "T00:00:00Z");
      while (d < buckets[0].start) d = advanceByCadence(d, cad);
      let guard = 0;
      while (d <= horizonStop && guard < 500) {
        if (endDate && d > endDate) break;
        const b = bucketOf(d);
        if (b >= 0) {
          const rawAmt = r.amount != null && r.currency && r.currency !== "USD"
            ? toUsd(Number(r.amount), r.currency as string)
            : Number(r.amount_usd);
          const amt = Math.abs(rawAmt) * (r.is_income ? incAdj : expAdj);
          items.push({
            date: fmt(d), bucket: b,
            account_id: r.account_id ?? defaultAcc,
            amount: amt, isIncome: !!r.is_income,
            source: "recurrence", label: r.name,
          });
        }
        d = advanceByCadence(d, cad);
        guard++;
      }
    }

    // ---- Budget variable & fixed → distribute across bucket overlap with the month
    const fixedByMonth = new Map<string, number>();
    const variableByMonth = new Map<string, number>();
    for (const b of budgets) {
      const mk = (b.month as string).slice(0, 7);
      const amt = Number(b.amount_usd) || 0;
      if (b.budget_type === "fixed") fixedByMonth.set(mk, (fixedByMonth.get(mk) ?? 0) + amt);
      else variableByMonth.set(mk, (variableByMonth.get(mk) ?? 0) + amt);
    }

    for (let bi = 0; bi < buckets.length; bi++) {
      const b = buckets[bi];
      let bvar = 0, bfix = 0;
      const cursor = new Date(Date.UTC(b.start.getUTCFullYear(), b.start.getUTCMonth(), 1));
      while (cursor <= b.end) {
        const mEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
        const oStart = cursor > b.start ? cursor : b.start;
        const oEnd = mEnd < b.end ? mEnd : b.end;
        const oDays = Math.max(0, Math.round((oEnd.getTime() - oStart.getTime()) / 86400000) + 1);
        const mDays = Math.round((mEnd.getTime() - cursor.getTime()) / 86400000) + 1;
        const mk = cursor.toISOString().slice(0, 7);
        bvar += (variableByMonth.get(mk) ?? 0) * (oDays / mDays);
        bfix += (fixedByMonth.get(mk) ?? 0) * (oDays / mDays);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      // Fallback for variable when no budget present: historical average
      if (bvar === 0) {
        const histExp = avgOutPerDay * b.days;
        bvar = Math.max(0, histExp);
      }
      if (bvar > 0) items.push({
        date: fmt(b.start), bucket: bi, account_id: defaultAcc,
        amount: bvar * expAdj, isIncome: false, source: "budget", label: "Orçamento variável",
      });
      if (bfix > 0) items.push({
        date: fmt(b.start), bucket: bi, account_id: defaultAcc,
        amount: bfix * expAdj, isIncome: false, source: "budget", label: "Orçamento fixo",
      });
    }

    // ---- Goals: monthly contribution charged on day 1 of each month, debited from linked account
    for (const g of goals) {
      const contribMonthly = Number(g.monthly_contribution_usd ?? 0);
      if (contribMonthly <= 0) continue;
      for (let i = 0; i < data.horizonMonths; i++) {
        const m = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
        const b = bucketOf(m);
        if (b >= 0) {
          items.push({
            date: fmt(m), bucket: b, account_id: g.account_id ?? defaultAcc,
            amount: contribMonthly * expAdj, isIncome: false,
            source: "goal", label: `Meta: ${g.name}`,
          });
        }
      }
    }

    // ---- Credit card future invoices: balance currently owed on the card pays out on due_day
    for (const a of accounts) {
      if (a.type !== "credit_card") continue;
      const owed = -(balByAccount.get(a.id) ?? 0); // credit card balance is typically negative
      if (owed <= 0) continue;
      const dueDay = a.due_day ?? 10;
      // Next due date: this month if dueDay >= today, else next month
      let due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), Math.min(dueDay, 28)));
      if (due < today) due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, Math.min(dueDay, 28)));
      const b = bucketOf(due);
      if (b >= 0) {
        items.push({
          date: fmt(due), bucket: b, account_id: defaultAcc,
          amount: owed * expAdj, isIncome: false,
          source: "cc_invoice", label: `Fatura ${a.name}`,
        });
      }
    }

    // ---- Aggregate per bucket and per account
    const runningPerAcc: Record<string, number> = { ...startBalances };
    let cumulative = Object.values(startBalances).reduce((s, v) => s + v, 0);

    const series = buckets.map((b, bi) => {
      const bItems = items.filter((it) => it.bucket === bi);
      const income = bItems.filter((it) => it.isIncome).reduce((s, it) => s + it.amount, 0);
      const expense = bItems.filter((it) => !it.isIncome).reduce((s, it) => s + it.amount, 0);
      // per-account deltas
      const perAccDelta: Record<string, number> = {};
      for (const it of bItems) {
        const aid = it.account_id ?? defaultAcc ?? "_unassigned";
        perAccDelta[aid] = (perAccDelta[aid] ?? 0) + (it.isIncome ? it.amount : -it.amount);
      }
      const perAccBalance: Record<string, number> = {};
      for (const a of accounts) {
        runningPerAcc[a.id] = (runningPerAcc[a.id] ?? 0) + (perAccDelta[a.id] ?? 0);
        perAccBalance[a.id] = runningPerAcc[a.id];
      }
      const net = income - expense;
      cumulative += net;
      return {
        label: b.label, start: fmt(b.start), end: fmt(b.end),
        income, expense, net, cumulative,
        perAccBalance,
        items: bItems.map((it) => ({
          date: it.date, amount: it.amount, isIncome: it.isIncome,
          source: it.source, label: it.label, account_id: it.account_id,
        })),
      };
    });

    // Per-account alerts
    const accountAlerts = accounts.map((a) => {
      const traj = series.map((s) => ({ label: s.label, balance: s.perAccBalance[a.id] ?? startBalances[a.id] ?? 0 }));
      const negativeAt = traj.find((p) => p.balance < 0);
      return {
        id: a.id, name: a.name, currency: a.currency, color: a.color, type: a.type,
        currentBalance: startBalances[a.id] ?? 0,
        endBalance: traj[traj.length - 1]?.balance ?? startBalances[a.id] ?? 0,
        goesNegativeAt: negativeAt?.label ?? null,
        trajectory: traj,
      };
    });

    return {
      buckets: buckets.map((b) => ({ label: b.label, start: fmt(b.start), end: fmt(b.end) })),
      series,
      accounts: accountAlerts,
      startTotal: Object.values(startBalances).reduce((s, v) => s + v, 0),
      endTotal: cumulative,
      goalsCount: goals.length,
      recurrencesCount: recs.length,
    };
  });