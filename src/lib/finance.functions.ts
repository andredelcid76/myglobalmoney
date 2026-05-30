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
      supabase.from("transactions").select("*").eq("user_id", userId).gte("date", data.monthStart).lte("date", data.monthEnd),
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