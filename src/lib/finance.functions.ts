import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ monthStart: z.string(), monthEnd: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [accountsRes, txMonthRes, catsRes, allTxRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId).eq("is_archived", false),
      supabase.from("transactions").select("*").eq("user_id", userId).eq("is_transfer", false).gte("date", data.monthStart).lte("date", data.monthEnd),
      supabase.from("categories").select("*").eq("user_id", userId),
      supabase.from("transactions").select("account_id, amount, currency, amount_usd").eq("user_id", userId),
    ]);
    return {
      accounts: accountsRes.data ?? [],
      monthTx: txMonthRes.data ?? [],
      categories: catsRes.data ?? [],
      allTx: allTxRes.data ?? [],
    };
  });

export const listTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    limit: z.number().default(200),
    accountId: z.string().optional(),
    categoryId: z.string().optional(),
    search: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("transactions").select("*").eq("user_id", context.userId).order("date", { ascending: false }).limit(data.limit);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    if (data.categoryId) q = q.eq("category_id", data.categoryId);
    if (data.search) q = q.ilike("merchant", `%${data.search}%`);
    const [tx, accounts, categories] = await Promise.all([
      q,
      context.supabase.from("accounts").select("id,name,currency,color").eq("user_id", context.userId),
      context.supabase.from("categories").select("id,name,color,parent_id").eq("user_id", context.userId),
    ]);
    return { transactions: tx.data ?? [], accounts: accounts.data ?? [], categories: categories.data ?? [] };
  });

export const updateTxCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), categoryId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("transactions").update({ category_id: data.categoryId }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const TxImport = z.object({
  date: z.string(),
  merchant: z.string(),
  original_statement: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  amount: z.number(),
  currency: z.string().default("USD"),
  amount_usd: z.number(),
  exchange_rate: z.number().nullable().optional(),
  account_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  is_transfer: z.boolean().default(false),
  tags: z.array(z.string()).optional().nullable(),
});

export const importTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rows: z.array(TxImport) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.rows.length === 0) return { inserted: 0 };
    const rows = data.rows.map((r) => ({ ...r, user_id: context.userId }));
    // chunk insert
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error, count } = await context.supabase.from("transactions").insert(chunk, { count: "exact" });
      if (error) throw new Error(error.message);
      inserted += count ?? chunk.length;
    }
    return { inserted };
  });

// ---------- Accounts ----------
export const listAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("accounts").select("*").eq("user_id", context.userId).order("created_at");
    if (error) throw new Error(error.message);
    return { accounts: data ?? [] };
  });

export const upsertAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(100),
    type: z.enum(["checking", "savings", "credit_card", "cash", "investment"]),
    currency: z.enum(["USD", "BRL"]),
    institution: z.string().max(100).optional().nullable(),
    color: z.string().max(20).optional(),
    initial_balance: z.number().default(0),
    is_archived: z.boolean().optional(),
    closing_day: z.number().int().min(1).max(31).nullable().optional(),
    due_day: z.number().int().min(1).max(31).nullable().optional(),
    credit_limit_usd: z.number().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    const { error } = data.id
      ? await context.supabase.from("accounts").update(payload).eq("id", data.id).eq("user_id", context.userId)
      : await context.supabase.from("accounts").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Categories ----------
export const listCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("categories").select("*").eq("user_id", context.userId).order("name");
    if (error) throw new Error(error.message);
    return { categories: data ?? [] };
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(100),
    parent_id: z.string().uuid().nullable().optional(),
    color: z.string().max(20).optional(),
    is_income: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    const { error } = data.id
      ? await context.supabase.from("categories").update(payload).eq("id", data.id).eq("user_id", context.userId)
      : await context.supabase.from("categories").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("categories").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Budgets ----------
export const listBudgets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ month: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const [budgets, categories, tx] = await Promise.all([
      context.supabase.from("budgets").select("*").eq("user_id", context.userId).eq("month", data.month),
      context.supabase.from("categories").select("*").eq("user_id", context.userId),
      context.supabase.from("transactions").select("category_id, amount_usd").eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", data.month).lte("date", endOfMonth(data.month)),
    ]);
    return { budgets: budgets.data ?? [], categories: categories.data ?? [], monthTx: tx.data ?? [] };
  });

export const upsertBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    category_id: z.string().uuid(),
    month: z.string(),
    amount_usd: z.number().min(0),
    budget_type: z.enum(["fixed", "flex", "annual"]).optional(),
    rollover_enabled: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase.from("budgets").select("id").eq("user_id", context.userId)
      .eq("category_id", data.category_id).eq("month", data.month).maybeSingle();
    const payload = { ...data, user_id: context.userId };
    const { error } = existing
      ? await context.supabase.from("budgets").update(payload).eq("id", existing.id)
      : await context.supabase.from("budgets").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ category_id: z.string().uuid(), month: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("budgets").delete()
      .eq("user_id", context.userId).eq("category_id", data.category_id).eq("month", data.month);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Budget suggestions & reallocation ----------
function medianOf(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const getBudgetSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ months: z.number().int().min(1).max(24).default(6) }).parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - data.months, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const [txRes, catsRes] = await Promise.all([
      context.supabase.from("transactions")
        .select("category_id, amount_usd, date")
        .eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", start.toISOString().slice(0, 10))
        .lte("date", end.toISOString().slice(0, 10)),
      context.supabase.from("categories").select("id, parent_id").eq("user_id", context.userId),
    ]);
    const cats = catsRes.data ?? [];
    const parentOf = new Map<string, string | null>();
    for (const c of cats) parentOf.set(c.id, c.parent_id ?? null);

    // monthly[catId][monthKey] = spent
    const monthly = new Map<string, Map<string, number>>();
    for (const t of txRes.data ?? []) {
      const amt = Number(t.amount_usd);
      if (amt >= 0 || !t.category_id) continue;
      const spent = -amt;
      const mk = (t.date as string).slice(0, 7);
      const targets = [t.category_id, parentOf.get(t.category_id) ?? null].filter(Boolean) as string[];
      for (const id of targets) {
        const m = monthly.get(id) ?? new Map<string, number>();
        m.set(mk, (m.get(mk) ?? 0) + spent);
        monthly.set(id, m);
      }
    }
    const stats: Record<string, { avg: number; median: number; max: number; last: number; months: number }> = {};
    for (const [catId, m] of monthly) {
      const vals = Array.from(m.values());
      // pad with zeros for months observed window
      while (vals.length < data.months) vals.push(0);
      const sum = vals.reduce((s, n) => s + n, 0);
      const avg = sum / vals.length;
      const med = medianOf(vals);
      const max = Math.max(...vals);
      // last closed month
      const lastKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
      const last = m.get(lastKey) ?? 0;
      stats[catId] = { avg, median: med, max, last, months: vals.length };
    }
    return { stats, windowMonths: data.months };
  });

export const reallocateBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    from_category_id: z.string().uuid(),
    to_category_id: z.string().uuid(),
    month: z.string(),
    amount_usd: z.number().positive(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.from_category_id === data.to_category_id) throw new Error("Categorias iguais");
    const sb = context.supabase;
    const [fromRes, toRes] = await Promise.all([
      sb.from("budgets").select("*").eq("user_id", context.userId).eq("category_id", data.from_category_id).eq("month", data.month).maybeSingle(),
      sb.from("budgets").select("*").eq("user_id", context.userId).eq("category_id", data.to_category_id).eq("month", data.month).maybeSingle(),
    ]);
    const fromAmt = Number(fromRes.data?.amount_usd ?? 0);
    const toAmt = Number(toRes.data?.amount_usd ?? 0);
    const newFrom = Math.max(0, fromAmt - data.amount_usd);
    const newTo = toAmt + data.amount_usd;
    if (fromRes.data) {
      await sb.from("budgets").update({ amount_usd: newFrom }).eq("id", fromRes.data.id);
    } else {
      await sb.from("budgets").insert({ user_id: context.userId, category_id: data.from_category_id, month: data.month, amount_usd: newFrom, budget_type: "flex" });
    }
    if (toRes.data) {
      await sb.from("budgets").update({ amount_usd: newTo }).eq("id", toRes.data.id);
    } else {
      await sb.from("budgets").insert({ user_id: context.userId, category_id: data.to_category_id, month: data.month, amount_usd: newTo, budget_type: "flex" });
    }
    return { ok: true, from: newFrom, to: newTo };
  });

export const bulkUpsertBudgets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    items: z.array(z.object({
      category_id: z.string().uuid(),
      month: z.string(),
      amount_usd: z.number().min(0),
      budget_type: z.enum(["fixed", "flex", "annual"]).default("flex"),
      rollover_enabled: z.boolean().default(false),
    })).min(1).max(2000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.items.map((r) => ({ ...r, user_id: context.userId }));
    const { error } = await context.supabase.from("budgets").upsert(rows, { onConflict: "user_id,category_id,month" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

export const applyBudgetToYear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    category_id: z.string().uuid(),
    year: z.number().int(),
    amount_usd: z.number().min(0),
    budget_type: z.enum(["fixed", "flex"]).default("fixed"),
    rollover_enabled: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      user_id: context.userId,
      category_id: data.category_id,
      month: `${data.year}-${String(i + 1).padStart(2, "0")}-01`,
      amount_usd: data.amount_usd,
      budget_type: data.budget_type,
      rollover_enabled: data.rollover_enabled,
    }));
    const { error } = await context.supabase.from("budgets").upsert(rows, { onConflict: "user_id,category_id,month" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBudgetsYear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ year: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    const start = `${data.year}-01-01`;
    const end = `${data.year}-12-31`;
    const [budgets, categories, tx] = await Promise.all([
      context.supabase.from("budgets").select("*").eq("user_id", context.userId)
        .gte("month", start).lte("month", end),
      context.supabase.from("categories").select("*").eq("user_id", context.userId),
      context.supabase.from("transactions").select("category_id, amount_usd, date")
        .eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", start).lte("date", end),
    ]);
    return { budgets: budgets.data ?? [], categories: categories.data ?? [], tx: tx.data ?? [] };
  });

// ---------- Projections ----------
function endOfMonth(monthStart: string) {
  const d = new Date(monthStart + "T00:00:00Z");
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return e.toISOString().slice(0, 10);
}

export const getProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ months: z.number().min(1).max(24).default(6) }).parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date();
    const startHist = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const startStr = startHist.toISOString().slice(0, 10);
    const [txRes, accountsRes, recsRes, budgetsRes] = await Promise.all([
      context.supabase.from("transactions").select("date, amount_usd").eq("user_id", context.userId).eq("is_transfer", false).gte("date", startStr),
      context.supabase.from("accounts").select("currency, initial_balance").eq("user_id", context.userId).eq("is_archived", false),
      context.supabase.from("recurrences").select("amount_usd, cadence, is_income, is_active, next_date").eq("user_id", context.userId).eq("is_active", true),
      context.supabase.from("budgets").select("month, amount_usd, budget_type").eq("user_id", context.userId),
    ]);
    const tx = txRes.data ?? [];
    const recs = recsRes.data ?? [];
    const budgets = budgetsRes.data ?? [];
    // Group historical tx by month
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const t of tx) {
      const key = (t.date as string).slice(0, 7);
      const v = byMonth.get(key) ?? { income: 0, expense: 0 };
      const amt = Number(t.amount_usd);
      if (amt >= 0) v.income += amt; else v.expense += -amt;
      byMonth.set(key, v);
    }
    // Last 3 closed months for averages
    const histKeys: string[] = [];
    for (let i = 3; i >= 1; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      histKeys.push(d.toISOString().slice(0, 7));
    }
    const avgIncome = histKeys.reduce((s, k) => s + (byMonth.get(k)?.income ?? 0), 0) / Math.max(histKeys.length, 1);
    const avgExpense = histKeys.reduce((s, k) => s + (byMonth.get(k)?.expense ?? 0), 0) / Math.max(histKeys.length, 1);

    // Current net worth in USD (initial balances + sum of all amount_usd)
    const initial = (accountsRes.data ?? []).reduce((s, a) => s + Number(a.initial_balance ?? 0), 0);
    const totalTx = tx.reduce((s, t) => s + Number(t.amount_usd ?? 0), 0);
    // include older tx too
    const { data: older } = await context.supabase.from("transactions").select("amount_usd").eq("user_id", context.userId).lt("date", startStr);
    const olderSum = (older ?? []).reduce((s, t) => s + Number(t.amount_usd ?? 0), 0);
    const currentNet = initial + totalTx + olderSum;

    const history = histKeys.map((k) => ({
      month: k,
      income: byMonth.get(k)?.income ?? 0,
      expense: byMonth.get(k)?.expense ?? 0,
      net: (byMonth.get(k)?.income ?? 0) - (byMonth.get(k)?.expense ?? 0),
    }));

    // Monthly equivalent of each recurrence
    const cadenceFactor: Record<string, number> = {
      weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12,
    };
    let recIncome = 0, recExpense = 0;
    for (const r of recs) {
      const monthly = Math.abs(Number(r.amount_usd)) * (cadenceFactor[r.cadence as string] ?? 1);
      if (r.is_income) recIncome += monthly; else recExpense += monthly;
    }

    // Budgets by month-key (sum of all budgets for that month)
    const budgetByMonth = new Map<string, { fixed: number; total: number }>();
    for (const b of budgets) {
      const mk = (b.month as string).slice(0, 7);
      const v = budgetByMonth.get(mk) ?? { fixed: 0, total: 0 };
      const amt = Number(b.amount_usd) || 0;
      v.total += amt;
      if (b.budget_type === "fixed") v.fixed += amt;
      budgetByMonth.set(mk, v);
    }

    const projection: { month: string; income: number; expense: number; fixed: number; variable: number; net: number; cumulative: number }[] = [];
    let cumulative = currentNet;
    for (let i = 0; i < data.months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const key = d.toISOString().slice(0, 7);
      const bm = budgetByMonth.get(key);
      // Fixed = recurrences + budgeted fixed (no double-count safeguard: recurrences usually aren't budgeted)
      const fixed = recExpense + (bm?.fixed ?? 0);
      // Variable target = sum of non-fixed budgets if defined, else fallback to hist avg minus fixed
      const variableBudgeted = bm ? Math.max(0, bm.total - bm.fixed) : 0;
      const variable = bm ? variableBudgeted : Math.max(0, avgExpense - fixed);
      const expense = fixed + variable;
      const income = recs.length > 0 ? Math.max(recIncome, avgIncome) : avgIncome;
      const net = income - expense;
      cumulative += net;
      projection.push({ month: key, income, expense, fixed, variable, net, cumulative });
    }
    return { currentNet, avgIncome, avgExpense, history, projection, basis: recs.length > 0 ? "recurrences+budgets" : "average", recurrencesCount: recs.length };
  });

// ---------- Cashflow (weekly/monthly/quarterly) ----------
function startOfWeekUTC(d: Date) {
  const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = dd.getUTCDay(); // 0 Sun
  const diff = (dow + 6) % 7; // monday
  dd.setUTCDate(dd.getUTCDate() - diff);
  return dd;
}
function addDaysUTC(d: Date, n: number) {
  const dd = new Date(d.getTime());
  dd.setUTCDate(dd.getUTCDate() + n);
  return dd;
}
function cadenceDays(c: string): number {
  return ({ weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 } as Record<string, number>)[c] ?? 30;
}
function advanceByCadence(d: Date, c: string): Date {
  const dd = new Date(d.getTime());
  if (c === "weekly") dd.setUTCDate(dd.getUTCDate() + 7);
  else if (c === "biweekly") dd.setUTCDate(dd.getUTCDate() + 14);
  else if (c === "monthly") dd.setUTCMonth(dd.getUTCMonth() + 1);
  else if (c === "quarterly") dd.setUTCMonth(dd.getUTCMonth() + 3);
  else if (c === "yearly") dd.setUTCFullYear(dd.getUTCFullYear() + 1);
  return dd;
}

export const getCashflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    granularity: z.enum(["weekly", "monthly", "quarterly"]).default("monthly"),
    periods: z.number().int().min(2).max(52).default(12),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Build period buckets starting from current period
    const buckets: { start: Date; end: Date; label: string; days: number }[] = [];
    if (data.granularity === "weekly") {
      let cur = startOfWeekUTC(today);
      for (let i = 0; i < data.periods; i++) {
        const end = addDaysUTC(cur, 6);
        buckets.push({ start: cur, end, days: 7, label: `${cur.toISOString().slice(5, 10)}` });
        cur = addDaysUTC(cur, 7);
      }
    } else if (data.granularity === "monthly") {
      for (let i = 0; i < data.periods; i++) {
        const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
        const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        buckets.push({ start: s, end: e, days, label: s.toISOString().slice(0, 7) });
      }
    } else {
      // quarterly: anchor to current quarter start
      const qMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      for (let i = 0; i < data.periods; i++) {
        const s = new Date(Date.UTC(now.getUTCFullYear(), qMonth + i * 3, 1));
        const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, 0));
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        const q = Math.floor(s.getUTCMonth() / 3) + 1;
        buckets.push({ start: s, end: e, days, label: `${s.getUTCFullYear()} Q${q}` });
      }
    }

    const horizonEnd = buckets[buckets.length - 1].end;
    const histStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    const histStartStr = histStart.toISOString().slice(0, 10);

    const [txRes, accRes, recsRes, budgetsRes, allTxRes] = await Promise.all([
      context.supabase.from("transactions").select("date, amount_usd").eq("user_id", context.userId).eq("is_transfer", false).gte("date", histStartStr),
      context.supabase.from("accounts").select("initial_balance").eq("user_id", context.userId).eq("is_archived", false),
      context.supabase.from("recurrences").select("name, amount_usd, cadence, is_income, next_date, is_active").eq("user_id", context.userId).eq("is_active", true),
      context.supabase.from("budgets").select("month, amount_usd, budget_type"),
      context.supabase.from("transactions").select("amount_usd").eq("user_id", context.userId),
    ]);
    const hist = txRes.data ?? [];
    const recs = recsRes.data ?? [];
    const budgets = (budgetsRes.data ?? []).filter((b: any) => true);

    // Historical daily average expense (last 3 closed months)
    const histDays = Math.max(1, Math.round((today.getTime() - histStart.getTime()) / 86400000));
    let histIncome = 0, histExpense = 0;
    for (const t of hist) {
      const amt = Number(t.amount_usd);
      if (amt >= 0) histIncome += amt; else histExpense += -amt;
    }
    const avgIncomePerDay = histIncome / histDays;
    const avgExpensePerDay = histExpense / histDays;

    // Current net worth (USD): initial balances + sum of all amount_usd
    const initial = (accRes.data ?? []).reduce((s, a) => s + Number(a.initial_balance ?? 0), 0);
    const allTxSum = (allTxRes.data ?? []).reduce((s, t) => s + Number(t.amount_usd ?? 0), 0);
    const currentNet = initial + allTxSum;

    // Build occurrences for each recurrence within horizon
    type Occ = { date: Date; amount: number; isIncome: boolean; name: string };
    const occurrences: Occ[] = [];
    for (const r of recs) {
      const cad = r.cadence as string;
      let d = new Date((r.next_date as string) + "T00:00:00Z");
      // Roll forward to first bucket start if behind
      while (d < buckets[0].start) d = advanceByCadence(d, cad);
      // Safety cap
      let guard = 0;
      while (d <= horizonEnd && guard < 500) {
        occurrences.push({
          date: d,
          amount: Math.abs(Number(r.amount_usd)),
          isIncome: !!r.is_income,
          name: r.name as string,
        });
        d = advanceByCadence(d, cad);
        guard++;
      }
    }

    // Budgeted fixed totals by month-key
    const fixedByMonth = new Map<string, number>();
    const variableBudgetByMonth = new Map<string, number>();
    for (const b of budgets) {
      const mk = (b.month as string).slice(0, 7);
      const amt = Number(b.amount_usd) || 0;
      if (b.budget_type === "fixed") {
        fixedByMonth.set(mk, (fixedByMonth.get(mk) ?? 0) + amt);
      } else {
        variableBudgetByMonth.set(mk, (variableBudgetByMonth.get(mk) ?? 0) + amt);
      }
    }

    let cumulative = currentNet;
    const series = buckets.map((b) => {
      const inOcc = occurrences.filter((o) => o.date >= b.start && o.date <= b.end);
      const recIncome = inOcc.filter((o) => o.isIncome).reduce((s, o) => s + o.amount, 0);
      const recExpense = inOcc.filter((o) => !o.isIncome).reduce((s, o) => s + o.amount, 0);

      // Apportion budgets across overlap (for weekly buckets, slice month by days)
      let budgetFixed = 0;
      let budgetVariable = 0;
      // iterate months that overlap this bucket
      const monthCursor = new Date(Date.UTC(b.start.getUTCFullYear(), b.start.getUTCMonth(), 1));
      while (monthCursor <= b.end) {
        const mEnd = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 0));
        const overlapStart = monthCursor > b.start ? monthCursor : b.start;
        const overlapEnd = mEnd < b.end ? mEnd : b.end;
        const overlapDays = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1);
        const monthDays = Math.round((mEnd.getTime() - monthCursor.getTime()) / 86400000) + 1;
        const mk = monthCursor.toISOString().slice(0, 7);
        budgetFixed += (fixedByMonth.get(mk) ?? 0) * (overlapDays / monthDays);
        budgetVariable += (variableBudgetByMonth.get(mk) ?? 0) * (overlapDays / monthDays);
        monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
      }

      const fixed = recExpense + budgetFixed;
      // Variable: prefer budget; fallback to hist avg (minus fixed already covered)
      const histExpBucket = avgExpensePerDay * b.days;
      const variable = budgetVariable > 0 ? budgetVariable : Math.max(0, histExpBucket - fixed);
      const expense = fixed + variable;

      // Income: recurring + uncovered hist avg
      const histIncBucket = avgIncomePerDay * b.days;
      const income = Math.max(recIncome, histIncBucket);

      const net = income - expense;
      cumulative += net;
      return {
        label: b.label,
        start: b.start.toISOString().slice(0, 10),
        end: b.end.toISOString().slice(0, 10),
        income, fixed, variable, expense, net, cumulative,
        recCount: inOcc.length,
      };
    });

    // Upcoming recurrences list (next 30 in horizon)
    const upcoming = occurrences
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 30)
      .map((o) => ({ date: o.date.toISOString().slice(0, 10), name: o.name, amount: o.amount, isIncome: o.isIncome }));

    return { series, upcoming, currentNet, avgExpensePerDay, avgIncomePerDay };
  });