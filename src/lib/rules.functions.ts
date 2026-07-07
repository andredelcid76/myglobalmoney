import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/paginated-query";

function matches(merchant: string, pattern: string, matchType: string): boolean {
  const m = merchant.toLowerCase();
  const p = pattern.toLowerCase();
  if (matchType === "exact") return m === p;
  if (matchType === "regex") {
    try { return new RegExp(pattern, "i").test(merchant); } catch { return false; }
  }
  return m.includes(p);
}

export const listRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [rulesRes, catsRes] = await Promise.all([
      supabase.from("categorization_rules").select("*").eq("user_id", userId).order("priority", { ascending: false }),
      supabase.from("categories").select("id, name, parent_id").eq("user_id", userId).order("name"),
    ]);
    if (rulesRes.error) throw new Error(rulesRes.error.message);
    return { rules: rulesRes.data ?? [], categories: catsRes.data ?? [] };
  });

export const upsertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    pattern: z.string().min(1).max(200),
    match_type: z.enum(["contains", "exact", "regex"]).default("contains"),
    category_id: z.string().uuid(),
    priority: z.number().int().default(100),
    is_active: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    const { error } = data.id
      ? await context.supabase.from("categorization_rules").update(payload).eq("id", data.id).eq("user_id", context.userId)
      : await context.supabase.from("categorization_rules").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("categorization_rules").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Apply all active rules to all transactions matching scope.
// scope='uncategorized' (default): only tx without category_id.
// scope='all': re-apply rules over every transaction (overrides).
export const applyRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ scope: z.enum(["uncategorized", "all"]).default("uncategorized") }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [rulesRes, txs] = await Promise.all([
      supabase.from("categorization_rules").select("*").eq("user_id", userId).eq("is_active", true).order("priority", { ascending: false }),
      fetchAllPages<any>(() => data.scope === "uncategorized"
        ? supabase.from("transactions").select("id, merchant, category_id").eq("user_id", userId).is("category_id", null).eq("is_transfer", false).order("id")
        : supabase.from("transactions").select("id, merchant, category_id").eq("user_id", userId).eq("is_transfer", false).order("id")),
    ]);
    if (rulesRes.error) throw new Error(rulesRes.error.message);
    const rules = rulesRes.data ?? [];

    let updated = 0;
    const updates: { id: string; category_id: string }[] = [];
    for (const tx of txs) {
      for (const r of rules) {
        if (matches(tx.merchant ?? "", r.pattern, r.match_type)) {
          if (tx.category_id !== r.category_id) {
            updates.push({ id: tx.id, category_id: r.category_id });
            updated++;
          }
          break;
        }
      }
    }
    // Batch update via individual upserts (Supabase has no IN UPDATE with values)
    for (const u of updates) {
      await supabase.from("transactions").update({ category_id: u.category_id }).eq("id", u.id).eq("user_id", userId);
    }
    return { matched: updated, scanned: txs.length };
  });

// AI-assisted suggestions for uncategorized transactions.
// Returns suggestions WITHOUT applying them, so user can review.
export const suggestCategoriesAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    limit: z.number().int().min(1).max(100).default(50),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada");

    const [txRes, catsRes] = await Promise.all([
      supabase.from("transactions").select("id, merchant, amount_usd, original_statement").eq("user_id", userId).is("category_id", null).eq("is_transfer", false).order("date", { ascending: false }).limit(data.limit),
      supabase.from("categories").select("id, name, parent_id, is_income, is_transfer").eq("user_id", userId),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);
    if (catsRes.error) throw new Error(catsRes.error.message);
    const txs = txRes.data ?? [];
    const cats = (catsRes.data ?? []).filter((c) => !c.is_transfer);
    if (txs.length === 0) return { suggestions: [] as any[] };

    // Build catalog with hierarchy
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const catalog = cats.map((c) => {
      const parent = c.parent_id ? catMap.get(c.parent_id) : null;
      return { id: c.id, label: parent ? `${(parent as any).name} > ${c.name}` : c.name };
    });

    const prompt = `You are a financial categorization assistant. For each transaction, pick the BEST matching category id from the list. If unsure, return null.

Available categories (id → label):
${catalog.map((c) => `${c.id} → ${c.label}`).join("\n")}

Transactions to categorize (id | merchant | amount_usd):
${txs.map((t) => `${t.id} | ${t.merchant} | ${t.amount_usd}`).join("\n")}

Respond with a JSON object: {"suggestions":[{"transaction_id":"...","category_id":"..." or null,"confidence":0-1}]}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (res.status === 429) throw new Error("Limite de uso da IA excedido. Tente novamente em alguns minutos.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
    if (!res.ok) throw new Error(`IA erro ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const suggestions = (parsed.suggestions ?? []) as Array<{ transaction_id: string; category_id: string | null; confidence: number }>;

    // Enrich with merchant + category label so UI can render without extra round-trips
    const txMap = new Map(txs.map((t) => [t.id, t]));
    const catLabelMap = new Map(catalog.map((c) => [c.id, c.label]));
    const enriched = suggestions
      .filter((s) => txMap.has(s.transaction_id))
      .map((s) => ({
        transaction_id: s.transaction_id,
        merchant: txMap.get(s.transaction_id)!.merchant,
        amount_usd: txMap.get(s.transaction_id)!.amount_usd,
        category_id: s.category_id,
        category_label: s.category_id ? (catLabelMap.get(s.category_id) ?? null) : null,
        confidence: s.confidence ?? 0,
      }));
    return { suggestions: enriched };
  });

// Accept a batch of suggestions: assign categories AND optionally create rules
export const acceptSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    items: z.array(z.object({
      transaction_id: z.string().uuid(),
      category_id: z.string().uuid(),
      create_rule: z.boolean().default(false),
      rule_pattern: z.string().optional(),
    })).min(1).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let categorized = 0;
    let rulesCreated = 0;
    for (const item of data.items) {
      const { error } = await supabase.from("transactions").update({ category_id: item.category_id }).eq("id", item.transaction_id).eq("user_id", userId);
      if (!error) categorized++;
      if (item.create_rule && item.rule_pattern) {
        const { error: rerr } = await supabase.from("categorization_rules").insert({
          user_id: userId,
          pattern: item.rule_pattern,
          match_type: "contains",
          category_id: item.category_id,
          priority: 100,
          is_active: true,
        });
        if (!rerr) rulesCreated++;
      }
    }
    return { categorized, rulesCreated };
  });