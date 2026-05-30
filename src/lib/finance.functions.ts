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
    const [txRes, accountsRes, recsRes] = await Promise.all([
      context.supabase.from("transactions").select("date, amount_usd").eq("user_id", context.userId).eq("is_transfer", false).gte("date", startStr),
      context.supabase.from("accounts").select("currency, initial_balance").eq("user_id", context.userId).eq("is_archived", false),
      context.supabase.from("recurrences").select("amount_usd, cadence, is_income, is_active, next_date").eq("user_id", context.userId).eq("is_active", true),
    ]);
    const tx = txRes.data ?? [];
    const recs = recsRes.data ?? [];
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
    const useRecs = recs.length > 0;
    const projIncome = useRecs ? recIncome : avgIncome;
    const projExpense = useRecs ? recExpense : avgExpense;

    const projection: { month: string; income: number; expense: number; net: number; cumulative: number }[] = [];
    let cumulative = currentNet;
    for (let i = 0; i < data.months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const key = d.toISOString().slice(0, 7);
      const net = projIncome - projExpense;
      cumulative += net;
      projection.push({ month: key, income: projIncome, expense: projExpense, net, cumulative });
    }
    return { currentNet, avgIncome, avgExpense, history, projection, basis: useRecs ? "recurrences" : "average", recurrencesCount: recs.length };
  });