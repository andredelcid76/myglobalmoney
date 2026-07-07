import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/paginated-query";
import { getLatestUsdBrlRate, initialBalanceUsd } from "@/lib/fx-helpers";
import { todayStr, todayUTCDate, advanceByCadence } from "@/lib/dates";

export const getOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ monthStart: z.string(), monthEnd: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const today = todayStr();
    const [accountsRes, txMonth, catsRes, allTx] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId).eq("is_archived", false),
      fetchAllPages<any>(() => supabase.from("transactions").select("*").eq("user_id", userId).eq("is_transfer", false).gte("date", data.monthStart).lte("date", data.monthEnd)),
      supabase.from("categories").select("*").eq("user_id", userId),
      fetchAllPages<any>(() => supabase.from("transactions").select("account_id, amount, currency, amount_usd, date, is_pending").eq("user_id", userId).lte("date", today)),
    ]);
    return {
      accounts: accountsRes.data ?? [],
      monthTx: txMonth.filter((t: any) => !t.is_pending),
      categories: catsRes.data ?? [],
      allTx: allTx.filter((t: any) => !t.is_pending),
    };
  });

export const listTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    limit: z.number().default(200),
    accountId: z.string().optional(),
    categoryId: z.string().optional(),
    search: z.string().optional(),
    tag: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("transactions").select("*").eq("user_id", context.userId).order("date", { ascending: false }).limit(data.limit);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    if (data.categoryId) q = q.eq("category_id", data.categoryId);
    if (data.search) q = q.ilike("merchant", `%${data.search}%`);
    if (data.tag) q = q.contains("tags", [data.tag]);
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

export const bulkUpdateTxCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500), categoryId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("transactions")
      .update({ category_id: data.categoryId })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, updated: data.ids.length };
  });

export const bulkUpdateTxAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500), accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("transactions")
      .update({ account_id: data.accountId })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, updated: data.ids.length };
  });

export const createTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    date: z.string(),
    from_account_id: z.string().uuid(),
    to_account_id: z.string().uuid(),
    amount: z.number().positive(),
    amount_to: z.number().positive().optional(),
    notes: z.string().max(500).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.from_account_id === data.to_account_id) throw new Error("Contas devem ser diferentes");
    // Fetch both accounts to know their currencies
    const { data: accs, error: accErr } = await context.supabase
      .from("accounts").select("id,currency")
      .in("id", [data.from_account_id, data.to_account_id])
      .eq("user_id", context.userId);
    if (accErr) throw new Error(accErr.message);
    const from = accs?.find((a) => a.id === data.from_account_id);
    const to = accs?.find((a) => a.id === data.to_account_id);
    if (!from || !to) throw new Error("Conta não encontrada");
    const fromCur = (from.currency as string) ?? "USD";
    const toCur = (to.currency as string) ?? "USD";

    // Resolve USD/BRL rate (rate = BRL per USD). For future/missing dates, fall back to latest.
    let usdBrl = 1;
    if (fromCur !== toCur || fromCur === "BRL" || toCur === "BRL") {
      const today = todayStr();
      const lookup = data.date > today ? today : data.date;
      const { data: r1 } = await context.supabase
        .from("exchange_rates").select("rate,date")
        .eq("base", "USD").eq("quote", "BRL")
        .lte("date", lookup)
        .order("date", { ascending: false }).limit(1).maybeSingle();
      if (r1) usdBrl = Number(r1.rate);
      else {
        const { data: r2 } = await context.supabase
          .from("exchange_rates").select("rate,date")
          .eq("base", "USD").eq("quote", "BRL")
          .order("date", { ascending: false }).limit(1).maybeSingle();
        if (r2) usdBrl = Number(r2.rate);
      }
    }
    const toUsd = (amt: number, cur: string) => cur === "USD" ? amt : amt / usdBrl;
    const fromUsd = (amt: number, cur: string) => cur === "USD" ? amt : amt * usdBrl;

    const srcAmount = Math.abs(data.amount);
    const srcUsd = toUsd(srcAmount, fromCur);
    const dstAmount = data.amount_to != null
      ? Math.abs(data.amount_to)
      : (toCur === fromCur ? srcAmount : Number(fromUsd(srcUsd, toCur).toFixed(2)));
    const dstUsd = data.amount_to != null ? toUsd(Math.abs(data.amount_to), toCur) : srcUsd;

    const groupId = crypto.randomUUID();
    const baseCommon = {
      user_id: context.userId,
      date: data.date,
      notes: data.notes ?? null,
      is_transfer: true,
      is_pending: false,
      split_group_id: groupId,
    };
    const fromRate = fromCur === "USD" ? 1 : 1 / usdBrl;
    const toRate = toCur === "USD" ? 1 : 1 / usdBrl;
    const conv = fromCur !== toCur ? ` (1 USD ≈ ${usdBrl.toFixed(4)} BRL)` : "";
    const { error } = await context.supabase.from("transactions").insert([
      {
        ...baseCommon, account_id: data.from_account_id,
        merchant: "Transferência (saída)" + conv,
        amount: -srcAmount, currency: fromCur, exchange_rate: fromRate,
        amount_usd: -Number(srcUsd.toFixed(2)),
      },
      {
        ...baseCommon, account_id: data.to_account_id,
        merchant: "Transferência (entrada)" + conv,
        amount: dstAmount, currency: toCur, exchange_rate: toRate,
        amount_usd: Number(dstUsd.toFixed(2)),
      },
    ]);
    if (error) throw new Error(error.message);
    return { ok: true, usdBrl, dstAmount };
  });

const CreateTxInput = z.object({
  date: z.string(),
  merchant: z.string().min(1).max(200),
  notes: z.string().max(500).nullable().optional(),
  amount: z.number(),
  currency: z.enum(["USD", "BRL"]).default("USD"),
  account_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  is_transfer: z.boolean().default(false),
  is_pending: z.boolean().default(false),
  tags: z.array(z.string()).optional().nullable(),
});

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateTxInput.parse(d))
  .handler(async ({ data, context }) => {
    let exchange_rate = 1;
    if (data.currency !== "USD") {
      // A tabela guarda apenas USD→moeda; a taxa da transação é moeda→USD (inverso)
      const { data: r1 } = await context.supabase
        .from("exchange_rates")
        .select("rate")
        .eq("base", "USD")
        .eq("quote", data.currency)
        .lte("date", data.date)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      let usdToCur = r1 ? Number(r1.rate) : 0;
      if (!usdToCur) {
        const { data: r2 } = await context.supabase
          .from("exchange_rates")
          .select("rate")
          .eq("base", "USD")
          .eq("quote", data.currency)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (r2) usdToCur = Number(r2.rate);
      }
      if (!usdToCur) throw new Error(`Sem cotação USD/${data.currency} disponível — abra o dashboard para atualizar o câmbio e tente novamente`);
      exchange_rate = 1 / usdToCur;
    }
    const amount_usd = Number((data.amount * exchange_rate).toFixed(2));
    const { error } = await context.supabase.from("transactions").insert({
      user_id: context.userId,
      date: data.date,
      merchant: data.merchant,
      notes: data.notes ?? null,
      amount: data.amount,
      currency: data.currency,
      amount_usd,
      exchange_rate,
      account_id: data.account_id,
      category_id: data.category_id ?? null,
      is_transfer: data.is_transfer,
      is_pending: data.is_pending,
      tags: data.tags ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateTxInput = z.object({
  id: z.string().uuid(),
  date: z.string(),
  merchant: z.string().min(1).max(200),
  notes: z.string().max(500).nullable().optional(),
  amount: z.number(),
  currency: z.enum(["USD", "BRL"]),
  account_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  is_pending: z.boolean().default(false),
});

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateTxInput.parse(d))
  .handler(async ({ data, context }) => {
    // Recalcula amount_usd com a mesma lógica do create (par USD→moeda invertido).
    let exchange_rate = 1;
    if (data.currency !== "USD") {
      const { data: r1 } = await context.supabase
        .from("exchange_rates").select("rate")
        .eq("base", "USD").eq("quote", data.currency)
        .lte("date", data.date).order("date", { ascending: false }).limit(1).maybeSingle();
      let usdToCur = r1 ? Number(r1.rate) : 0;
      if (!usdToCur) {
        const { data: r2 } = await context.supabase
          .from("exchange_rates").select("rate")
          .eq("base", "USD").eq("quote", data.currency)
          .order("date", { ascending: false }).limit(1).maybeSingle();
        if (r2) usdToCur = Number(r2.rate);
      }
      if (!usdToCur) throw new Error(`Sem cotação USD/${data.currency} disponível`);
      exchange_rate = 1 / usdToCur;
    }
    const amount_usd = Number((data.amount * exchange_rate).toFixed(2));
    const { error } = await context.supabase.from("transactions").update({
      date: data.date,
      merchant: data.merchant,
      notes: data.notes ?? null,
      amount: data.amount,
      currency: data.currency,
      amount_usd,
      exchange_rate,
      account_id: data.account_id,
      category_id: data.category_id ?? null,
      is_pending: data.is_pending,
    }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setAccountBalanceToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    account_id: z.string().uuid(),
    target_balance: z.number(),
    date: z.string().optional(),
    notes: z.string().max(500).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const today = data.date ?? todayStr();
    const { data: acc, error: accErr } = await supabase.from("accounts")
      .select("id,currency,initial_balance,name").eq("id", data.account_id).eq("user_id", userId).maybeSingle();
    if (accErr || !acc) throw new Error("Conta não encontrada");
    const cur = (acc.currency as string) ?? "USD";
    // Remove any existing "Ajuste de saldo" rows for this account on this date so the
    // operation is idempotent (no stacking of duplicate adjustments on rapid re-clicks).
    await supabase.from("transactions").delete()
      .eq("user_id", userId).eq("account_id", data.account_id)
      .eq("date", today).eq("merchant", "Ajuste de saldo");
    const tx = await fetchAllPages<any>(() => supabase.from("transactions")
      .select("amount,is_pending").eq("user_id", userId).eq("account_id", data.account_id).lte("date", today));
    const current = Number(acc.initial_balance) + (tx ?? [])
      .filter((t: any) => !t.is_pending)
      .reduce((s, t: any) => s + Number(t.amount ?? 0), 0);
    const delta = Number((data.target_balance - current).toFixed(2));
    if (Math.abs(delta) < 0.005) return { ok: true, delta: 0, current, target: data.target_balance };
    let usdBrl = 1;
    if (cur === "BRL") {
      const { data: r1 } = await supabase.from("exchange_rates").select("rate")
        .eq("base", "USD").eq("quote", "BRL").lte("date", today)
        .order("date", { ascending: false }).limit(1).maybeSingle();
      if (r1) usdBrl = Number(r1.rate);
      else {
        const { data: r2 } = await supabase.from("exchange_rates").select("rate")
          .eq("base", "USD").eq("quote", "BRL").order("date", { ascending: false }).limit(1).maybeSingle();
        if (r2) usdBrl = Number(r2.rate);
      }
    }
    const delta_usd = cur === "USD" ? delta : Number((delta / usdBrl).toFixed(2));
    const exchange_rate = cur === "USD" ? 1 : 1 / usdBrl;
    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      account_id: data.account_id,
      date: today,
      merchant: "Ajuste de saldo",
      notes: data.notes ?? `Ajuste para refletir saldo real em ${today}`,
      amount: delta,
      currency: cur,
      amount_usd: delta_usd,
      exchange_rate,
      // Acerto contábil, não receita/despesa real: como transferência,
      // entra no saldo mas fica fora das estatísticas de receita/gasto
      is_transfer: true,
      is_pending: false,
    });
    if (error) throw new Error(error.message);
    return { ok: true, delta, current, target: data.target_balance };
  });

const TxImport = z.object({
  date: z.string(),
  merchant: z.string(),
  original_statement: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  amount: z.number(),
  currency: z.string().default("USD"),
  amount_usd: z.number(),
  exchange_rate: z.number().nullable().optional(), // convenção: moeda nativa → USD
  account_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  is_transfer: z.boolean().default(false),
  tags: z.array(z.string()).optional().nullable(),
  external_id: z.string().max(200).optional().nullable(),
});

export const importTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ rows: z.array(TxImport) }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.rows.length === 0) return { inserted: 0 };
    const rows = data.rows.map((r) => ({ ...r, user_id: context.userId }));
    // chunk insert; linhas com external_id repetido na mesma conta são ignoradas
    // (índice único transactions_user_acct_ext_uniq protege contra retry/duplo clique)
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error, count } = await context.supabase.from("transactions")
        .upsert(chunk, { onConflict: "user_id,account_id,external_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(error.message);
      inserted += count ?? 0;
    }
    return { inserted };
  });

// Fetch existing transactions for an account within a date window,
// used by the Nubank raw-CSV importer to detect duplicates client-side.
export const listAccountTxForDedup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    accountId: z.string().uuid(),
    sinceDate: z.string(),
    untilDate: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: tx, error } = await context.supabase
      .from("transactions")
      .select("id, date, merchant, amount, currency")
      .eq("user_id", context.userId)
      .eq("account_id", data.accountId)
      .gte("date", data.sinceDate)
      .lte("date", data.untilDate);
    if (error) throw new Error(error.message);
    return { transactions: tx ?? [] };
  });

// ---------- Accounts ----------
export const listAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("accounts").select("*").eq("user_id", context.userId).order("created_at");
    if (error) throw new Error(error.message);
    const today = todayStr();
    const tx = await fetchAllPages<any>(() => context.supabase.from("transactions")
      .select("account_id, amount, is_pending").eq("user_id", context.userId).lte("date", today));
    const sumByAcc = new Map<string, number>();
    for (const t of tx ?? []) {
      if ((t as any).is_pending) continue;
      const k = (t as any).account_id as string;
      sumByAcc.set(k, (sumByAcc.get(k) ?? 0) + Number((t as any).amount ?? 0));
    }
    const accounts = (data ?? []).map((a: any) => ({
      ...a,
      current_balance: Number(a.initial_balance) + (sumByAcc.get(a.id) ?? 0),
    }));
    return { accounts };
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
    budget_group: z.enum(["fixa", "variavel"]).optional(),
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
      fetchAllPages<any>(() => context.supabase.from("transactions").select("category_id, amount_usd, is_pending").eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", data.month).lte("date", endOfMonth(data.month))),
    ]);
    return { budgets: budgets.data ?? [], categories: categories.data ?? [], monthTx: tx.filter((t: any) => !t.is_pending) };
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
    const now = todayUTCDate();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - data.months, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const [txRows, catsRes] = await Promise.all([
      fetchAllPages<any>(() => context.supabase.from("transactions")
        .select("category_id, amount_usd, date, is_pending")
        .eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", start.toISOString().slice(0, 10))
        .lte("date", end.toISOString().slice(0, 10))),
      context.supabase.from("categories").select("id, parent_id").eq("user_id", context.userId),
    ]);
    const cats = catsRes.data ?? [];
    const parentOf = new Map<string, string | null>();
    for (const c of cats) parentOf.set(c.id, c.parent_id ?? null);

    // monthly[catId][monthKey] = spent
    const monthly = new Map<string, Map<string, number>>();
    for (const t of txRows) {
      if (t.is_pending) continue;
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
      fetchAllPages<any>(() => context.supabase.from("transactions").select("category_id, amount_usd, date, is_pending")
        .eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", start).lte("date", end)),
    ]);
    return { budgets: budgets.data ?? [], categories: categories.data ?? [], tx: tx.filter((t: any) => !t.is_pending) };
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
    const now = todayUTCDate();
    const startHist = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const startStr = startHist.toISOString().slice(0, 10);
    const [tx, accountsRes, recsRes, budgetsRes] = await Promise.all([
      fetchAllPages<any>(() => context.supabase.from("transactions").select("date, amount_usd, is_pending").eq("user_id", context.userId).eq("is_transfer", false).gte("date", startStr)),
      context.supabase.from("accounts").select("currency, initial_balance").eq("user_id", context.userId).eq("is_archived", false),
      context.supabase.from("recurrences").select("amount_usd, cadence, is_income, is_active, next_date").eq("user_id", context.userId).eq("is_active", true),
      context.supabase.from("budgets").select("month, amount_usd, budget_type").eq("user_id", context.userId),
    ]);
    const confirmedTx = tx.filter((t: any) => !t.is_pending);
    const recs = recsRes.data ?? [];
    const budgets = budgetsRes.data ?? [];
    // Group historical tx by month
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const t of confirmedTx) {
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

    // Current net worth in USD (initial balances converted to USD + sum of all amount_usd)
    const usdBrl = await getLatestUsdBrlRate(context.supabase);
    const initial = (accountsRes.data ?? []).reduce((s, a) => s + initialBalanceUsd(a, usdBrl), 0);
    const totalTx = confirmedTx.reduce((s, t) => s + Number(t.amount_usd ?? 0), 0);
    // include older tx too
    const older = await fetchAllPages<any>(() => context.supabase.from("transactions").select("amount_usd, is_pending").eq("user_id", context.userId).lt("date", startStr));
    const olderSum = (older ?? []).filter((t: any) => !t.is_pending).reduce((s, t) => s + Number(t.amount_usd ?? 0), 0);
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

export const getCashflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    granularity: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
    periods: z.number().int().min(2).max(365).default(12),
    includeProjections: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const now = todayUTCDate();
    const today = now;

    // Build period buckets starting from current period
    const buckets: { start: Date; end: Date; label: string; days: number }[] = [];
    if (data.granularity === "daily") {
      for (let i = 0; i < data.periods; i++) {
        const s = addDaysUTC(today, i);
        buckets.push({ start: s, end: s, days: 1, label: s.toISOString().slice(5, 10) });
      }
    } else if (data.granularity === "weekly") {
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
    } else if (data.granularity === "quarterly") {
      // quarterly: anchor to current quarter start
      const qMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      for (let i = 0; i < data.periods; i++) {
        const s = new Date(Date.UTC(now.getUTCFullYear(), qMonth + i * 3, 1));
        const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, 0));
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        const q = Math.floor(s.getUTCMonth() / 3) + 1;
        buckets.push({ start: s, end: e, days, label: `${s.getUTCFullYear()} Q${q}` });
      }
    } else {
      // yearly
      for (let i = 0; i < data.periods; i++) {
        const s = new Date(Date.UTC(now.getUTCFullYear() + i, 0, 1));
        const e = new Date(Date.UTC(s.getUTCFullYear(), 11, 31));
        const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
        buckets.push({ start: s, end: e, days, label: `${s.getUTCFullYear()}` });
      }
    }

    const horizonEnd = buckets[buckets.length - 1].end;
    const histStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    const histStartStr = histStart.toISOString().slice(0, 10);
    const todayStr0 = today.toISOString().slice(0, 10);
    const horizonEndStr = horizonEnd.toISOString().slice(0, 10);

    const [txRows, accRes, recsRes, budgetsRes, allTxRows, futureTxRows] = await Promise.all([
      fetchAllPages<any>(() => context.supabase.from("transactions").select("date, amount_usd, category_id, is_pending").eq("user_id", context.userId).eq("is_transfer", false).gte("date", histStartStr).lte("date", todayStr0)),
      context.supabase.from("accounts").select("currency, initial_balance").eq("user_id", context.userId).eq("is_archived", false),
      context.supabase.from("recurrences").select("name, amount_usd, cadence, is_income, next_date, is_active").eq("user_id", context.userId).eq("is_active", true),
      context.supabase.from("budgets").select("month, amount_usd, budget_type"),
      fetchAllPages<any>(() => context.supabase.from("transactions").select("amount_usd, is_pending, date").eq("user_id", context.userId)),
      fetchAllPages<any>(() => context.supabase.from("transactions").select("date, amount_usd, is_pending, is_transfer").eq("user_id", context.userId).gt("date", todayStr0).lte("date", horizonEndStr)),
    ]);
    const hist = txRows.filter((t: any) => !t.is_pending);
    const recs = recsRes.data ?? [];
    const budgets = (budgetsRes.data ?? []).filter((b: any) => true);
    const futureTx = futureTxRows.filter((t: any) => data.includeProjections ? true : !t.is_pending);

    // Historical daily average expense (last 3 closed months)
    const histDays = Math.max(1, Math.round((today.getTime() - histStart.getTime()) / 86400000));
    let histIncome = 0, histExpense = 0;
    for (const t of hist) {
      const amt = Number(t.amount_usd);
      if (amt >= 0) histIncome += amt; else histExpense += -amt;
    }
    const avgIncomePerDay = histIncome / histDays;
    const avgExpensePerDay = histExpense / histDays;

    // Current net worth (USD): initial balances converted to USD + sum of confirmed tx up to today
    const usdBrl = await getLatestUsdBrlRate(context.supabase);
    const initial = (accRes.data ?? []).reduce((s, a) => s + initialBalanceUsd(a, usdBrl), 0);
    const allTxSum = allTxRows
      .filter((t: any) => !t.is_pending && (t.date as string) <= todayStr0)
      .reduce((s: number, t: any) => s + Number(t.amount_usd ?? 0), 0);
    const currentNet = initial + allTxSum;

    // Build occurrences for each recurrence within horizon
    type Occ = { date: Date; amount: number; isIncome: boolean; name: string };
    const occurrences: Occ[] = [];
    for (const r of recs) {
      const cad = r.cadence as string;
      let d = new Date((r.next_date as string) + "T00:00:00Z");
      const anchor = d.getUTCDate();
      // Roll forward to first bucket start if behind
      while (d < buckets[0].start) d = advanceByCadence(d, cad, anchor);
      // Safety cap
      let guard = 0;
      while (d <= horizonEnd && guard < 500) {
        occurrences.push({
          date: d,
          amount: Math.abs(Number(r.amount_usd)),
          isIncome: !!r.is_income,
          name: r.name as string,
        });
        d = advanceByCadence(d, cad, anchor);
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

    // Realized variable expenses per month (up to today), from historical tx
    const realizedVariableByMonth = new Map<string, number>();
    const todayStr = today.toISOString().slice(0, 10);
    for (const t of hist) {
      const amt = Number(t.amount_usd);
      if (amt >= 0) continue;
      const ds = t.date as string;
      if (ds > todayStr) continue;
      const mk = ds.slice(0, 7);
      realizedVariableByMonth.set(mk, (realizedVariableByMonth.get(mk) ?? 0) + -amt);
    }

    let cumulative = currentNet;
    const series = buckets.map((b) => {
      const inOcc = occurrences.filter((o) => o.date >= b.start && o.date <= b.end);
      const recIncome = inOcc.filter((o) => o.isIncome).reduce((s, o) => s + o.amount, 0);
      const recExpense = inOcc.filter((o) => !o.isIncome).reduce((s, o) => s + o.amount, 0);

      // Future transactions (confirmed always; pending only when includeProjections)
      const bStart = b.start.toISOString().slice(0, 10);
      const bEnd = b.end.toISOString().slice(0, 10);
      let txIncome = 0, txExpense = 0;
      for (const t of futureTx) {
        const ds = t.date as string;
        if (ds < bStart || ds > bEnd) continue;
        const amt = Number(t.amount_usd);
        if (amt >= 0) txIncome += amt; else txExpense += -amt;
      }

      // Apportion budgets across overlap (for weekly buckets, slice month by days).
      // Variable budget: distribute the *remaining* budget of each month
      // (max(0, monthly - realized-so-far)) across the *remaining* days of the
      // month (from today onward). Days that already elapsed contribute 0 to
      // the forward projection since they show up in real transactions.
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

        // Variable: only project the portion of the overlap that is today-or-later.
        const futureStart = today > overlapStart ? today : overlapStart;
        const futureDaysInOverlap = overlapEnd >= futureStart
          ? Math.round((overlapEnd.getTime() - futureStart.getTime()) / 86400000) + 1
          : 0;
        const futureMonthStart = today > monthCursor ? today : monthCursor;
        const remainingMonthDays = mEnd >= futureMonthStart
          ? Math.round((mEnd.getTime() - futureMonthStart.getTime()) / 86400000) + 1
          : 0;
        const monthlyBudget = variableBudgetByMonth.get(mk) ?? 0;
        const realized = realizedVariableByMonth.get(mk) ?? 0;
        const remainingBudget = Math.max(0, monthlyBudget - realized);
        if (remainingMonthDays > 0 && futureDaysInOverlap > 0) {
          budgetVariable += remainingBudget * (futureDaysInOverlap / remainingMonthDays);
        }
        monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
      }

      const fixed = recExpense + budgetFixed + txExpense;
      // Variable: prefer budget; fallback to hist avg (minus fixed already covered)
      const histExpBucket = avgExpensePerDay * b.days;
      const variable = budgetVariable > 0 ? budgetVariable : Math.max(0, histExpBucket - fixed);
      const expense = fixed + variable;

      // Income: recurring + uncovered hist avg
      const histIncBucket = avgIncomePerDay * b.days;
      const income = Math.max(recIncome + txIncome, histIncBucket);

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