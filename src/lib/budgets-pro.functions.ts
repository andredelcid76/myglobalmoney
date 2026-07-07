import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/paginated-query";
import { todayUTCDate } from "@/lib/dates";

function endOfMonthStr(monthStart: string) {
  const d = new Date(monthStart + "T00:00:00Z");
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return e.toISOString().slice(0, 10);
}
function prevMonth(monthStart: string) {
  const d = new Date(monthStart + "T00:00:00Z");
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return p.toISOString().slice(0, 10);
}

type Group = "renda" | "fixa" | "variavel" | "poupanca";

/**
 * Monthly Pro view: per-category budgeted + actual + rollover carry-in + pace badge,
 * grouped by budget_group buckets (renda/fixa/variavel/poupanca).
 */
export const getBudgetMonthlyPro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ month: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const monthEnd = endOfMonthStr(data.month);
    const prev = prevMonth(data.month);
    const prevEnd = endOfMonthStr(prev);

    const [catsRes, budgetsRes, prevBudgetsRes, txRows, prevTxRows] = await Promise.all([
      sb.from("categories").select("*").eq("user_id", context.userId),
      sb.from("budgets").select("*").eq("user_id", context.userId).eq("month", data.month),
      sb.from("budgets").select("*").eq("user_id", context.userId).eq("month", prev),
      fetchAllPages<any>(() => sb.from("transactions").select("category_id, amount_usd, date, is_pending")
        .eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", data.month).lte("date", monthEnd)),
      fetchAllPages<any>(() => sb.from("transactions").select("category_id, amount_usd, date, is_pending")
        .eq("user_id", context.userId).eq("is_transfer", false)
        .gte("date", prev).lte("date", prevEnd)),
    ]);

    const cats = (catsRes.data ?? []) as any[];
    const budgets = (budgetsRes.data ?? []) as any[];
    const prevBudgets = (prevBudgetsRes.data ?? []) as any[];

    const parentOf = new Map<string, string | null>();
    for (const c of cats) parentOf.set(c.id, c.parent_id ?? null);

    // Spent maps (current and previous month) — include parent aggregation
    function spentMap(rows: any[]) {
      const m = new Map<string, { income: number; expense: number }>();
      for (const c of cats) m.set(c.id, { income: 0, expense: 0 });
      for (const t of rows) {
        if (!t.category_id) continue;
        const amt = Number(t.amount_usd);
        const targets = [t.category_id, parentOf.get(t.category_id) ?? null].filter(Boolean) as string[];
        for (const id of targets) {
          const v = m.get(id) ?? { income: 0, expense: 0 };
          if (amt >= 0) v.income += amt; else v.expense += -amt;
          m.set(id, v);
        }
      }
      return m;
    }
    const spent = spentMap(txRows.filter((t: any) => !t.is_pending));
    const prevSpent = spentMap(prevTxRows.filter((t: any) => !t.is_pending));

    // Budgets by category
    const budgetByCat = new Map<string, any>();
    for (const b of budgets) budgetByCat.set(b.category_id, b);
    const prevBudgetByCat = new Map<string, any>();
    for (const b of prevBudgets) prevBudgetByCat.set(b.category_id, b);

    // Rollover carry-in: only applies when current month budget has rollover_enabled
    function carryIn(catId: string) {
      const cur = budgetByCat.get(catId);
      if (!cur?.rollover_enabled) return 0;
      const prevB = prevBudgetByCat.get(catId);
      if (!prevB) return 0;
      const prevAmt = Number(prevB.amount_usd ?? 0);
      const prevSp = (prevSpent.get(catId)?.expense ?? 0);
      return prevAmt - prevSp; // positive = leftover; negative = deficit
    }

    // Pace: today's day-of-month / total days
    const today = todayUTCDate();
    const monthStartD = new Date(data.month + "T00:00:00Z");
    const sameMonth = today.getUTCFullYear() === monthStartD.getUTCFullYear()
      && today.getUTCMonth() === monthStartD.getUTCMonth();
    const totalDays = new Date(Date.UTC(monthStartD.getUTCFullYear(), monthStartD.getUTCMonth() + 1, 0)).getUTCDate();
    const dayOfMonth = sameMonth ? today.getUTCDate() : (today < monthStartD ? 0 : totalDays);
    const elapsedRatio = totalDays > 0 ? dayOfMonth / totalDays : 1;

    type Row = {
      id: string; name: string; color: string; parent_id: string | null; isParent: boolean;
      group: Group;
      budgeted: number; carryIn: number; effective: number;
      actual: number; income: number;
      pct: number; pace: "ahead" | "ontrack" | "behind" | "over" | "none";
      rollover_enabled: boolean;
    };

    const rows: Row[] = [];
    for (const c of cats) {
      if (c.is_transfer) continue;
      const b = budgetByCat.get(c.id);
      const budgeted = Number(b?.amount_usd ?? 0);
      const ci = carryIn(c.id);
      const effective = budgeted + ci;
      const sp = spent.get(c.id) ?? { income: 0, expense: 0 };
      const actual = c.is_income ? sp.income : sp.expense;
      const pct = effective > 0 ? actual / effective : (actual > 0 ? Infinity : 0);
      let pace: Row["pace"] = "none";
      if (effective > 0 && !c.is_income) {
        if (pct > 1) pace = "over";
        else if (elapsedRatio > 0) {
          const expected = elapsedRatio;
          if (pct < expected - 0.1) pace = "ahead";
          else if (pct > expected + 0.1) pace = "behind";
          else pace = "ontrack";
        }
      }
      const group: Group = (c.budget_group as Group) ?? (c.is_income ? "renda" : "variavel");
      rows.push({
        id: c.id, name: c.name, color: c.color, parent_id: c.parent_id ?? null,
        isParent: !c.parent_id,
        group,
        budgeted, carryIn: ci, effective, actual,
        income: sp.income, pct: Number.isFinite(pct) ? pct : 0,
        pace,
        rollover_enabled: !!b?.rollover_enabled,
      });
    }

    // Bucket totals
    type BucketTotal = { budgeted: number; actual: number; effective: number };
    const buckets: Record<Group, BucketTotal> = {
      renda: { budgeted: 0, actual: 0, effective: 0 },
      fixa: { budgeted: 0, actual: 0, effective: 0 },
      variavel: { budgeted: 0, actual: 0, effective: 0 },
      poupanca: { budgeted: 0, actual: 0, effective: 0 },
    };
    // Only count leaf (children) to avoid double counting, plus parents that have no children
    const hasChildren = new Set<string>();
    for (const c of cats) if (c.parent_id) hasChildren.add(c.parent_id);
    for (const r of rows) {
      if (r.isParent && hasChildren.has(r.id)) continue;
      buckets[r.group].budgeted += r.budgeted;
      buckets[r.group].effective += r.effective;
      buckets[r.group].actual += r.actual;
    }

    return {
      rows,
      buckets,
      elapsedRatio,
      dayOfMonth,
      totalDays,
    };
  });

export const upsertCategoryGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    budget_group: z.enum(["renda", "fixa", "variavel", "poupanca"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("categories").update({ budget_group: data.budget_group })
      .eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleRollover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    category_id: z.string().uuid(),
    month: z.string(),
    enabled: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: existing } = await sb.from("budgets").select("id, amount_usd")
      .eq("user_id", context.userId).eq("category_id", data.category_id).eq("month", data.month).maybeSingle();
    if (!existing) {
      // Create a zero-budget row carrying the rollover flag so user can enable before setting amount
      const { error } = await sb.from("budgets").insert({
        user_id: context.userId, category_id: data.category_id, month: data.month,
        amount_usd: 0, budget_type: "flex", rollover_enabled: data.enabled,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("budgets").update({ rollover_enabled: data.enabled })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });