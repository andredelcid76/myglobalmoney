import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("goals")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { goals: data ?? [] };
  });

const goalInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  target_amount_usd: z.number().min(0),
  current_amount_usd: z.number().min(0).default(0),
  monthly_contribution_usd: z.number().min(0).default(0),
  target_date: z.string().nullable().optional(),
  color: z.string().default("#10b981"),
  icon: z.string().nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_archived: z.boolean().default(false),
});

export const upsertGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => goalInput.parse(d))
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId };
    const { error } = await context.supabase.from("goals").upsert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("goals")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const contributeToGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), amount_usd: z.number() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: goal, error: gErr } = await context.supabase
      .from("goals").select("current_amount_usd").eq("id", data.id).eq("user_id", context.userId).single();
    if (gErr) throw new Error(gErr.message);
    const next = Math.max(0, Number(goal.current_amount_usd) + data.amount_usd);
    const { error } = await context.supabase.from("goals")
      .update({ current_amount_usd: next }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });