import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBudgets, upsertBudget } from "@/lib/finance.functions";
import { formatCurrency, startOfMonth, addMonths, monthLabel } from "@/lib/format";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_app/budgets")({ component: BudgetsPage });

function BudgetsPage() {
  const [month, setMonth] = useState<string>(startOfMonth());
  const fetchBudgets = useServerFn(listBudgets);
  const upsert = useServerFn(upsertBudget);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["budgets", month], queryFn: () => fetchBudgets({ data: { month } }) });

  const save = useMutation({
    mutationFn: (v: { category_id: string; amount_usd: number }) => upsert({ data: { ...v, month } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets", month] }),
  });

  const rows = useMemo(() => {
    const cats = data?.categories ?? [];
    const parents = cats.filter((c: any) => !c.parent_id && !c.is_income && !c.is_transfer);
    const spentByCat = new Map<string, number>();
    for (const t of data?.monthTx ?? []) {
      const amt = Number(t.amount_usd);
      if (amt >= 0 || !t.category_id) continue;
      // attribute subcategory's spend to its parent too
      const cat = cats.find((c: any) => c.id === t.category_id);
      const targetIds = [t.category_id, cat?.parent_id].filter(Boolean) as string[];
      for (const id of targetIds) spentByCat.set(id, (spentByCat.get(id) ?? 0) + -amt);
    }
    const budgetByCat = new Map<string, number>();
    for (const b of data?.budgets ?? []) budgetByCat.set(b.category_id, Number(b.amount_usd));
    return parents.map((c: any) => ({
      id: c.id, name: c.name, color: c.color,
      budget: budgetByCat.get(c.id) ?? 0,
      spent: spentByCat.get(c.id) ?? 0,
    }));
  }, [data]);

  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Orçamentos</h1>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[140px] text-center text-sm font-medium">{monthLabel(month)}</div>
          <Button size="icon" variant="outline" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card label="Orçado" value={formatCurrency(totalBudget)} />
        <Card label="Gasto" value={formatCurrency(totalSpent)} />
        <Card label="Restante" value={formatCurrency(totalBudget - totalSpent)} accent={totalSpent > totalBudget && totalBudget > 0 ? "text-destructive" : "text-emerald-400"} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Categoria</th>
              <th className="text-right px-4 py-2">Orçado (USD)</th>
              <th className="text-right px-4 py-2">Gasto</th>
              <th className="text-left px-4 py-2 w-1/3">Progresso</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.budget > 0 ? Math.min((r.spent / r.budget) * 100, 150) : 0;
              const over = r.budget > 0 && r.spent > r.budget;
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full" style={{ background: r.color }} /> {r.name}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number" step="10" defaultValue={r.budget}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== r.budget) save.mutate({ category_id: r.id, amount_usd: v }); }}
                      className="w-24 bg-input border border-border rounded px-2 py-1 text-right text-sm"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">{formatCurrency(r.spent)}</td>
                  <td className="px-4 py-2">
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}