import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listRecurrences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [recs, accounts, categories] = await Promise.all([
      context.supabase.from("recurrences").select("*").eq("user_id", context.userId).order("next_date"),
      context.supabase.from("accounts").select("id,name,currency,color").eq("user_id", context.userId),
      context.supabase.from("categories").select("id,name,color,parent_id").eq("user_id", context.userId),
    ]);
    return { recurrences: recs.data ?? [], accounts: accounts.data ?? [], categories: categories.data ?? [] };
  });

const RecInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  merchant_pattern: z.string().max(200).nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  amount_usd: z.number(),
  cadence: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]),
  day_of_month: z.number().min(1).max(31).nullable().optional(),
  next_date: z.string(),
  is_income: z.boolean().default(false),
  is_active: z.boolean().default(true),
  source: z.enum(["manual", "auto"]).default("manual"),
  notes: z.string().max(500).nullable().optional(),
});

export const upsertRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RecInput.parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    const { error } = data.id
      ? await context.supabase.from("recurrences").update(payload).eq("id", data.id).eq("user_id", context.userId)
      : await context.supabase.from("recurrences").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recurrences").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function median(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function snapCadence(days: number): { cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly"; days: number } | null {
  if (days >= 5 && days <= 9) return { cadence: "weekly", days: 7 };
  if (days >= 12 && days <= 17) return { cadence: "biweekly", days: 14 };
  if (days >= 26 && days <= 34) return { cadence: "monthly", days: 30 };
  if (days >= 80 && days <= 100) return { cadence: "quarterly", days: 91 };
  if (days >= 350 && days <= 380) return { cadence: "yearly", days: 365 };
  return null;
}

export const detectRecurrences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Pull last 9 months of non-transfer transactions
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 9);
    const sinceStr = since.toISOString().slice(0, 10);
    const { data: txs, error } = await context.supabase
      .from("transactions")
      .select("date, merchant, amount_usd, account_id, category_id")
      .eq("user_id", context.userId)
      .eq("is_transfer", false)
      .gte("date", sinceStr)
      .order("date");
    if (error) throw new Error(error.message);

    // Group by normalized merchant
    const groups = new Map<string, typeof txs>();
    for (const t of txs ?? []) {
      const key = (t.merchant ?? "").trim().toLowerCase().replace(/\s+#?\d{3,}.*$/, "").replace(/\s+/g, " ");
      if (key.length < 3) continue;
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }

    // Existing recurrences to avoid dupes
    const { data: existing } = await context.supabase
      .from("recurrences").select("merchant_pattern").eq("user_id", context.userId);
    const existingPatterns = new Set((existing ?? []).map((r) => (r.merchant_pattern ?? "").toLowerCase()));

    const suggestions: any[] = [];
    for (const [key, arr] of groups) {
      if (arr.length < 3) continue;
      if (existingPatterns.has(key)) continue;
      const dates = arr.map((t) => new Date((t.date as string) + "T00:00:00Z").getTime() / 86400000);
      const intervals: number[] = [];
      for (let i = 1; i < dates.length; i++) intervals.push(dates[i] - dates[i - 1]);
      const med = median(intervals);
      const snap = snapCadence(med);
      if (!snap) continue;
      const amounts = arr.map((t) => Number(t.amount_usd));
      const medAmt = median(amounts);
      // Reject if amounts vary too much (coefficient > 0.4)
      const avg = amounts.reduce((s, n) => s + n, 0) / amounts.length;
      const variance = amounts.reduce((s, n) => s + (n - avg) ** 2, 0) / amounts.length;
      const stdev = Math.sqrt(variance);
      if (Math.abs(avg) > 0 && stdev / Math.abs(avg) > 0.4) continue;

      const lastDate = arr[arr.length - 1].date as string;
      const next = new Date(lastDate + "T00:00:00Z");
      next.setUTCDate(next.getUTCDate() + snap.days);
      const last = arr[arr.length - 1];

      suggestions.push({
        name: (arr[arr.length - 1].merchant ?? key).slice(0, 60),
        merchant_pattern: key,
        amount_usd: Number(medAmt.toFixed(2)),
        cadence: snap.cadence,
        day_of_month: snap.cadence === "monthly" ? next.getUTCDate() : null,
        next_date: next.toISOString().slice(0, 10),
        is_income: medAmt > 0,
        account_id: last.account_id,
        category_id: last.category_id,
        occurrences: arr.length,
      });
    }
    suggestions.sort((a, b) => Math.abs(b.amount_usd) - Math.abs(a.amount_usd));
    return { suggestions };
  });

const SaveDetectedInput = z.object({
  items: z.array(z.object({
    name: z.string(),
    merchant_pattern: z.string().nullable().optional(),
    amount_usd: z.number(),
    cadence: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]),
    day_of_month: z.number().nullable().optional(),
    next_date: z.string(),
    is_income: z.boolean(),
    account_id: z.string().uuid().nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
  })),
});

export const saveDetectedRecurrences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveDetectedInput.parse(d))
  .handler(async ({ data, context }) => {
    if (!data.items.length) return { inserted: 0 };
    const rows = data.items.map((r) => ({ ...r, user_id: context.userId, source: "auto" as const, is_active: true }));
    const { error, count } = await context.supabase.from("recurrences").insert(rows, { count: "exact" });
    if (error) throw new Error(error.message);
    return { inserted: count ?? rows.length };
  });