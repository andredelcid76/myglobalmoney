import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Split a transaction into N parts. Each part becomes its own transaction
 * sharing a `split_group_id`. The original transaction is deleted.
 * Sum of parts (in original currency) must equal the original amount (sign included).
 */
export const splitTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    transaction_id: z.string().uuid(),
    parts: z.array(z.object({
      amount: z.number(),
      category_id: z.string().uuid().nullable().optional(),
      notes: z.string().max(500).optional().nullable(),
      tags: z.array(z.string().min(1).max(40)).max(20).optional().nullable(),
    })).min(2).max(20),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: tx, error: txErr } = await supabase
      .from("transactions").select("*")
      .eq("id", data.transaction_id).eq("user_id", userId).maybeSingle();
    if (txErr) throw new Error(txErr.message);
    if (!tx) throw new Error("Transação não encontrada");

    const original = Number(tx.amount);
    const sum = data.parts.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(sum - original) > 0.01) {
      throw new Error(`Soma das partes (${sum.toFixed(2)}) difere do valor original (${original.toFixed(2)})`);
    }

    // FX ratio to derive amount_usd per part
    const ratio = original !== 0 ? Number(tx.amount_usd) / original : 0;
    const groupId = crypto.randomUUID();
    const rows = data.parts.map((p) => ({
      user_id: userId,
      account_id: tx.account_id,
      date: tx.date,
      merchant: tx.merchant,
      original_statement: tx.original_statement,
      notes: p.notes ?? null,
      amount: p.amount,
      currency: tx.currency,
      amount_usd: Number((p.amount * ratio).toFixed(2)),
      exchange_rate: tx.exchange_rate,
      category_id: p.category_id ?? null,
      is_transfer: tx.is_transfer,
      tags: p.tags ?? null,
      split_group_id: groupId,
    }));

    const { error: insErr } = await supabase.from("transactions").insert(rows);
    if (insErr) throw new Error(insErr.message);
    const { error: delErr } = await supabase
      .from("transactions").delete()
      .eq("id", data.transaction_id).eq("user_id", userId);
    if (delErr) throw new Error(delErr.message);
    return { ok: true, group_id: groupId, parts: rows.length };
  });

/**
 * Collapse a previously-split group back into a single transaction.
 */
export const unsplitTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ split_group_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: parts, error } = await supabase
      .from("transactions").select("*")
      .eq("user_id", userId).eq("split_group_id", data.split_group_id);
    if (error) throw new Error(error.message);
    if (!parts || parts.length === 0) throw new Error("Grupo não encontrado");
    const first = parts[0];
    const amount = parts.reduce((s, p) => s + Number(p.amount), 0);
    const amountUsd = parts.reduce((s, p) => s + Number(p.amount_usd), 0);
    const tagSet = new Set<string>();
    for (const p of parts) for (const t of (p.tags ?? [])) tagSet.add(t);
    const merged = {
      user_id: userId,
      account_id: first.account_id,
      date: first.date,
      merchant: first.merchant,
      original_statement: first.original_statement,
      notes: parts.map((p) => p.notes).filter(Boolean).join(" | ") || null,
      amount,
      currency: first.currency,
      amount_usd: Number(amountUsd.toFixed(2)),
      exchange_rate: first.exchange_rate,
      category_id: null,
      is_transfer: first.is_transfer,
      tags: tagSet.size ? Array.from(tagSet) : null,
    };
    const { error: insErr } = await supabase.from("transactions").insert(merged);
    if (insErr) throw new Error(insErr.message);
    const { error: delErr } = await supabase
      .from("transactions").delete()
      .eq("user_id", userId).eq("split_group_id", data.split_group_id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });

export const updateTxTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    tags: z.array(z.string().min(1).max(40)).max(20),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("transactions").update({ tags: data.tags.length ? data.tags : null })
      .eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAllTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("transactions").select("tags")
      .eq("user_id", context.userId).not("tags", "is", null).limit(5000);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      for (const t of (row.tags ?? []) as string[]) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const tags = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    return { tags };
  });