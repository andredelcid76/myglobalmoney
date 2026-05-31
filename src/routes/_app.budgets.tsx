import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBudgetsYear, upsertBudget, applyBudgetToYear, deleteBudget, getBudgetSuggestions, reallocateBudget, bulkUpsertBudgets } from "@/lib/finance.functions";
import { formatCurrency } from "@/lib/format";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronRightIcon, Copy, Trash2, ArrowLeftRight, Sparkles } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/budgets")({ component: BudgetsPage });

type BudgetType = "fixed" | "flex" | "annual";
const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthKey(year: number, idx: number) {
  return `${year}-${String(idx + 1).padStart(2, "0")}-01`;
}

function BudgetsPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const fetchYear = useServerFn(listBudgetsYear);
  const upsert = useServerFn(upsertBudget);
  const applyAll = useServerFn(applyBudgetToYear);
  const del = useServerFn(deleteBudget);
  const fetchSugg = useServerFn(getBudgetSuggestions);
  const realloc = useServerFn(reallocateBudget);
  const bulk = useServerFn(bulkUpsertBudgets);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["budgets-year", year],
    queryFn: () => fetchYear({ data: { year } }),
  });
  const { data: sugg } = useQuery({
    queryKey: ["budget-suggestions", 6],
    queryFn: () => fetchSugg({ data: { months: 6 } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["budgets-year", year] });

  const upsertMut = useMutation({
    mutationFn: (v: { category_id: string; month: string; amount_usd: number; budget_type?: BudgetType; rollover_enabled?: boolean }) => upsert({ data: v }),
    onSuccess: invalidate,
  });
  const applyMut = useMutation({
    mutationFn: (v: { category_id: string; amount_usd: number; budget_type: "fixed" | "flex"; rollover_enabled: boolean }) =>
      applyAll({ data: { ...v, year } }),
    onSuccess: invalidate,
  });
  const delMut = useMutation({
    mutationFn: (v: { category_id: string; month: string }) => del({ data: v }),
    onSuccess: invalidate,
  });
  const reallocMut = useMutation({
    mutationFn: (v: { from_category_id: string; to_category_id: string; month: string; amount_usd: number }) => realloc({ data: v }),
    onSuccess: invalidate,
  });
  const bulkMut = useMutation({
    mutationFn: (items: { category_id: string; month: string; amount_usd: number; budget_type: BudgetType; rollover_enabled: boolean }[]) => bulk({ data: { items } }),
    onSuccess: invalidate,
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { groups, monthlyTotals, monthlySpent } = useMemo(() => {
    const cats = data?.categories ?? [];
    const budgets = data?.budgets ?? [];
    const tx = data?.tx ?? [];
    const parents = cats.filter((c: any) => !c.parent_id && !c.is_income && !c.is_transfer);
    const childrenByParent = new Map<string, any[]>();
    for (const c of cats) {
      if (c.parent_id) {
        const arr = childrenByParent.get(c.parent_id) ?? [];
        arr.push(c);
        childrenByParent.set(c.parent_id, arr);
      }
    }

    // spent[catId][monthIdx] — sub gets its own; parent gets aggregate of self + children
    const spent: Record<string, number[]> = {};
    for (const c of cats) spent[c.id] = Array(12).fill(0);
    for (const t of tx) {
      const amt = Number(t.amount_usd);
      if (amt >= 0 || !t.category_id) continue;
      const cat = cats.find((c: any) => c.id === t.category_id);
      const targets = [t.category_id, cat?.parent_id].filter(Boolean) as string[];
      const m = new Date((t.date as string) + "T00:00:00Z").getUTCMonth();
      for (const id of targets) {
        if (spent[id]) spent[id][m] += -amt;
      }
    }

    type Row = {
      id: string; name: string; color: string; isParent: boolean;
      budgets: (number | null)[];
      types: (BudgetType | null)[];
      rollovers: boolean[];
      spent: number[];
    };
    const mkRow = (c: any, isParent: boolean): Row => ({
      id: c.id, name: c.name, color: c.color, isParent,
      budgets: Array(12).fill(null),
      types: Array(12).fill(null),
      rollovers: Array(12).fill(false),
      spent: spent[c.id] ?? Array(12).fill(0),
    });
    type Group = { parent: Row; children: Row[]; parentTotalBudget: number[] };
    const groups: Group[] = parents.map((c: any) => ({
      parent: mkRow(c, true),
      children: (childrenByParent.get(c.id) ?? []).map((sc) => mkRow(sc, false)),
      parentTotalBudget: Array(12).fill(0),
    }));
    const rowsById = new Map<string, Row>();
    for (const g of groups) {
      rowsById.set(g.parent.id, g.parent);
      for (const ch of g.children) rowsById.set(ch.id, ch);
    }
    for (const b of budgets) {
      const r = rowsById.get(b.category_id);
      if (!r) continue;
      const m = new Date((b.month as string) + "T00:00:00Z").getUTCMonth();
      r.budgets[m] = Number(b.amount_usd);
      r.types[m] = (b.budget_type as BudgetType) ?? "flex";
      r.rollovers[m] = !!b.rollover_enabled;
    }
    // Aggregate per-group total budget (parent's own + children) for the grid totals
    for (const g of groups) {
      for (let m = 0; m < 12; m++) {
        let sum = g.parent.budgets[m] ?? 0;
        for (const ch of g.children) sum += ch.budgets[m] ?? 0;
        g.parentTotalBudget[m] = sum;
      }
    }

    const monthlyTotals = Array(12).fill(0);
    const monthlySpent = Array(12).fill(0);
    for (const g of groups) {
      for (let m = 0; m < 12; m++) {
        monthlyTotals[m] += g.parentTotalBudget[m];
        monthlySpent[m] += g.parent.spent[m];
      }
    }
    return { groups, monthlyTotals, monthlySpent };
  }, [data]);

  const suggStats = sugg?.stats ?? {};
  const allCategories = (data?.categories ?? []) as any[];

  function applySuggestionsToYear(useMedian: boolean) {
    // Apply median (or avg) of last 6 months to every leaf category, every month of `year`,
    // only filling cells that are currently empty (null) to preserve manual edits.
    const items: { category_id: string; month: string; amount_usd: number; budget_type: BudgetType; rollover_enabled: boolean }[] = [];
    const budgetSet = new Set(
      (data?.budgets ?? []).map((b: any) => `${b.category_id}|${(b.month as string).slice(0, 7)}`)
    );
    for (const c of allCategories) {
      if (c.is_income || c.is_transfer) continue;
      const s = suggStats[c.id];
      if (!s) continue;
      const amt = Math.round((useMedian ? s.median : s.avg) * 100) / 100;
      if (amt <= 0) continue;
      for (let m = 0; m < 12; m++) {
        const monthKeyShort = `${year}-${String(m + 1).padStart(2, "0")}`;
        if (budgetSet.has(`${c.id}|${monthKeyShort}`)) continue;
        items.push({
          category_id: c.id,
          month: monthKey(year, m),
          amount_usd: amt,
          budget_type: "flex",
          rollover_enabled: false,
        });
      }
    }
    if (items.length === 0) return;
    bulkMut.mutate(items);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orçamentos {year}</h1>
          <p className="text-sm text-muted-foreground">Grid anual com tipos (fixo/variável/anual) e rollover</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SuggestAllPopover onApply={applySuggestionsToYear} />
          <ReallocatePopover
            year={year}
            categories={allCategories}
            onSubmit={(v) => reallocMut.mutate(v)}
          />
          <Button size="icon" variant="outline" onClick={() => setYear(year - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[80px] text-center text-sm font-medium">{year}</div>
          <Button size="icon" variant="outline" onClick={() => setYear(year + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <Legend />

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead className="bg-secondary/40 text-muted-foreground sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 bg-secondary/40 z-10 min-w-[180px]">Categoria</th>
              {MONTHS_PT.map((m, i) => (
                <th key={m} className="text-center px-2 py-2 min-w-[80px]">{m}</th>
              ))}
              <th className="text-right px-3 py-2 min-w-[90px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = !!expanded[g.parent.id];
              const total = g.parentTotalBudget.reduce((s, v) => s + v, 0);
              return (
                <FragmentRows
                  key={g.parent.id}
                  group={g}
                  isOpen={isOpen}
                  onToggle={() => setExpanded((s) => ({ ...s, [g.parent.id]: !s[g.parent.id] }))}
                  total={total}
                  year={year}
                  suggStats={suggStats}
                  onUpsert={(v) => upsertMut.mutate(v)}
                  onDelete={(v) => delMut.mutate(v)}
                  onApplyYear={(v) => applyMut.mutate(v)}
                />
              );
            })}
          </tbody>
          <tfoot className="bg-secondary/30 border-t border-border">
            <tr>
              <td className="px-3 py-2 sticky left-0 bg-secondary/30 z-10 font-semibold">Total mês</td>
              {monthlyTotals.map((v: number, i: number) => (
                <td key={i} className="px-2 py-2 text-center tabular-nums">
                  <div className="font-medium">{formatCurrency(v)}</div>
                  <div className="text-[10px] text-muted-foreground">gasto {formatCurrency(monthlySpent[i])}</div>
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums font-semibold">
                {formatCurrency(monthlyTotals.reduce((s: number, v: number) => s + v, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> Fixo: mesmo valor todo mês</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Variável: ajusta por mês</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Anual: orçamento do ano</span>
      <span className="inline-flex items-center gap-1">↻ Rollover: sobra/déficit passa pro próximo mês</span>
    </div>
  );
}

type Row = {
  id: string; name: string; color: string; isParent: boolean;
  budgets: (number | null)[];
  types: (BudgetType | null)[];
  rollovers: boolean[];
  spent: number[];
};
type Group = { parent: Row; children: Row[]; parentTotalBudget: number[] };

type UpsertPayload = { category_id: string; month: string; amount_usd: number; budget_type?: BudgetType; rollover_enabled?: boolean };
type DeletePayload = { category_id: string; month: string };
type ApplyYearPayload = { category_id: string; amount_usd: number; budget_type: "fixed" | "flex"; rollover_enabled: boolean };

function FragmentRows({
  group, isOpen, onToggle, total, year, suggStats, onUpsert, onDelete, onApplyYear,
}: {
  group: Group; isOpen: boolean; onToggle: () => void; total: number; year: number;
  suggStats: Record<string, { avg: number; median: number; max: number; last: number; months: number }>;
  onUpsert: (v: UpsertPayload) => void;
  onDelete: (v: DeletePayload) => void;
  onApplyYear: (v: ApplyYearPayload) => void;
}) {
  const { parent, children, parentTotalBudget } = group;
  const parentSugg = suggStats[parent.id];
  // Aggregate spent for parent already includes children; aggregate budgets via parentTotalBudget.
  // For the parent row cells, show aggregated total (read-only when there are children with budgets),
  // but always allow editing the parent's own budget for that month.
  return (
    <>
      <tr className="border-t border-border hover:bg-secondary/20 bg-secondary/5">
        <td className="px-3 py-2 sticky left-0 bg-card z-10">
          <div className="flex items-center justify-between gap-2">
            <button onClick={onToggle} className="flex items-center gap-2 text-left">
              {children.length > 0 ? (
                isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
              ) : <span className="w-3.5" />}
              <div className="h-3 w-3 rounded-full" style={{ background: parent.color }} />
              <span className="font-semibold">{parent.name}</span>
              {children.length > 0 && <span className="text-[10px] text-muted-foreground">({children.length})</span>}
            </button>
            <ApplyToYearPopover
              onApply={(amount, type, rollover) =>
                onApplyYear({ category_id: parent.id, amount_usd: amount, budget_type: type, rollover_enabled: rollover })
              }
              suggestion={parentSugg}
            />
          </div>
        </td>
        {Array.from({ length: 12 }).map((_, m) => {
          const aggBudget = parentTotalBudget[m];
          const spent = parent.spent[m];
          const over = aggBudget > 0 && spent > aggBudget;
          const ratio = aggBudget > 0 ? Math.min(spent / aggBudget, 1.5) : 0;
          // Parent cell edits parent's own budget (separate from children's)
          return (
            <td key={m} className="px-1.5 py-1 align-top">
              <CellEditor
                value={parent.budgets[m]}
                type={parent.types[m] ?? "flex"}
                rollover={parent.rollovers[m]}
                displayValue={aggBudget > 0 ? aggBudget : null}
                suggestion={parentSugg}
                onSave={(amt, t, ro) =>
                  onUpsert({
                    category_id: parent.id,
                    month: monthKey(year, m),
                    amount_usd: amt,
                    budget_type: t,
                    rollover_enabled: ro,
                  })
                }
                onClear={() => onDelete({ category_id: parent.id, month: monthKey(year, m) })}
              />
              <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
                <div className={`h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${ratio * 100}%` }} />
              </div>
              <div className={`mt-0.5 text-[10px] tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
                {spent > 0 ? formatCurrency(spent) : "—"}
              </div>
            </td>
          );
        })}
        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(total)}</td>
      </tr>
      {isOpen && children.map((ch) => {
        const childSugg = suggStats[ch.id];
        const subTotal = ch.budgets.reduce<number>((s, v) => s + (v ?? 0), 0);
        return (
          <tr key={ch.id} className="border-t border-border/50 hover:bg-secondary/10">
            <td className="px-3 py-2 sticky left-0 bg-card z-10">
              <div className="flex items-center justify-between gap-2 pl-7">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full opacity-70" style={{ background: ch.color }} />
                  <span className="text-muted-foreground">{ch.name}</span>
                  {childSugg && childSugg.avg > 0 && (
                    <span className="text-[10px] text-muted-foreground/70">méd {formatCurrency(childSugg.median)}/mês</span>
                  )}
                </div>
                <ApplyToYearPopover
                  onApply={(amount, type, rollover) =>
                    onApplyYear({ category_id: ch.id, amount_usd: amount, budget_type: type, rollover_enabled: rollover })
                  }
                  suggestion={childSugg}
                />
              </div>
            </td>
            {ch.budgets.map((b, m) => {
              const spent = ch.spent[m];
              const avail = b ?? 0;
              const over = avail > 0 && spent > avail;
              const ratio = avail > 0 ? Math.min(spent / avail, 1.5) : 0;
              return (
                <td key={m} className="px-1.5 py-1 align-top">
                  <CellEditor
                    value={b}
                    type={ch.types[m] ?? "flex"}
                    rollover={ch.rollovers[m]}
                    suggestion={childSugg}
                    onSave={(amt, t, ro) =>
                      onUpsert({
                        category_id: ch.id,
                        month: monthKey(year, m),
                        amount_usd: amt,
                        budget_type: t,
                        rollover_enabled: ro,
                      })
                    }
                    onClear={() => onDelete({ category_id: ch.id, month: monthKey(year, m) })}
                  />
                  <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${ratio * 100}%` }} />
                  </div>
                  <div className={`mt-0.5 text-[10px] tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
                    {spent > 0 ? formatCurrency(spent) : "—"}
                  </div>
                </td>
              );
            })}
            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(subTotal)}</td>
          </tr>
        );
      })}
    </>
  );
}

function CellEditor({
  value, type, rollover, onSave, onClear, displayValue, suggestion,
}: {
  value: number | null;
  type: BudgetType;
  rollover: boolean;
  onSave: (amount: number, type: BudgetType, rollover: boolean) => void;
  onClear: () => void;
  displayValue?: number | null;
  suggestion?: { avg: number; median: number; max: number; last: number; months: number };
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");
  const [t, setT] = useState<BudgetType>(type);
  const [ro, setRo] = useState(rollover);

  const indicator = type === "fixed" ? "bg-primary" : type === "annual" ? "bg-emerald-500" : "bg-amber-500";

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setDraft(value != null ? String(value) : ""); setT(type); setRo(rollover); } }}>
      <PopoverTrigger asChild>
        <button className="w-full rounded border border-border bg-input px-2 py-1 text-right tabular-nums hover:border-primary/60 transition">
          <div className="flex items-center justify-between gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${value != null ? indicator : "bg-muted"}`} />
            <span className={(displayValue ?? value) != null ? "" : "text-muted-foreground"}>
              {(displayValue ?? value) != null ? formatCurrency((displayValue ?? value) as number) : "—"}
            </span>
            {rollover && <span className="text-[9px] text-muted-foreground">↻</span>}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="space-y-1.5">
          <Label className="text-xs">Valor (USD)</Label>
          <input
            type="number" step="10" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
            autoFocus
          />
          {suggestion && suggestion.avg > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              <button type="button" onClick={() => setDraft(String(Math.round(suggestion.median * 100) / 100))}
                className="text-[10px] rounded border border-border bg-secondary/40 px-1.5 py-0.5 hover:bg-secondary">
                méd {formatCurrency(suggestion.median)}
              </button>
              <button type="button" onClick={() => setDraft(String(Math.round(suggestion.avg * 100) / 100))}
                className="text-[10px] rounded border border-border bg-secondary/40 px-1.5 py-0.5 hover:bg-secondary">
                avg {formatCurrency(suggestion.avg)}
              </button>
              <button type="button" onClick={() => setDraft(String(Math.round(suggestion.max * 100) / 100))}
                className="text-[10px] rounded border border-border bg-secondary/40 px-1.5 py-0.5 hover:bg-secondary">
                máx {formatCurrency(suggestion.max)}
              </button>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <Select value={t} onValueChange={(v) => setT(v as BudgetType)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Mensal fixo</SelectItem>
              <SelectItem value="flex">Mensal variável</SelectItem>
              <SelectItem value="annual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="rollover" className="text-xs">Rollover sobra/déficit</Label>
          <Switch id="rollover" checked={ro} onCheckedChange={setRo} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1" onClick={() => { const n = Number(draft); if (!isFinite(n) || n < 0) return; onSave(n, t, ro); setOpen(false); }}>
            Salvar
          </Button>
          {value != null && (
            <Button size="sm" variant="outline" onClick={() => { onClear(); setOpen(false); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ApplyToYearPopover({ onApply, suggestion }: {
  onApply: (amount: number, type: "fixed" | "flex", rollover: boolean) => void;
  suggestion?: { avg: number; median: number; max: number; last: number; months: number };
}) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const [t, setT] = useState<"fixed" | "flex">("fixed");
  const [ro, setRo] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button title="Aplicar a todos os meses do ano" className="text-muted-foreground hover:text-foreground p-1">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-3">
        <div className="text-xs font-medium">Aplicar ao ano inteiro</div>
        <input type="number" step="10" placeholder="Valor mensal (USD)" value={amt} onChange={(e) => setAmt(e.target.value)}
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm" autoFocus />
        {suggestion && suggestion.avg > 0 && (
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setAmt(String(Math.round(suggestion.median * 100) / 100))}
              className="text-[10px] rounded border border-border bg-secondary/40 px-1.5 py-0.5 hover:bg-secondary">méd {formatCurrency(suggestion.median)}</button>
            <button type="button" onClick={() => setAmt(String(Math.round(suggestion.avg * 100) / 100))}
              className="text-[10px] rounded border border-border bg-secondary/40 px-1.5 py-0.5 hover:bg-secondary">avg {formatCurrency(suggestion.avg)}</button>
          </div>
        )}
        <Select value={t} onValueChange={(v) => setT(v as "fixed" | "flex")}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Mensal fixo</SelectItem>
            <SelectItem value="flex">Mensal variável</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Rollover</Label>
          <Switch checked={ro} onCheckedChange={setRo} />
        </div>
        <Button size="sm" className="w-full" onClick={() => { const n = Number(amt); if (!isFinite(n) || n < 0) return; onApply(n, t, ro); setOpen(false); }}>
          Aplicar aos 12 meses
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SuggestAllPopover({ onApply }: { onApply: (useMedian: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Sugestões</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div className="text-sm font-medium">Preencher pela média histórica</div>
        <p className="text-xs text-muted-foreground">
          Usa os últimos 6 meses de gastos para preencher cada categoria do ano. Só preenche células vazias — seus valores manuais ficam.
        </p>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => { onApply(true); setOpen(false); }}>
            Usar mediana
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => { onApply(false); setOpen(false); }}>
            Usar média
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReallocatePopover({ year, categories, onSubmit }: {
  year: number;
  categories: { id: string; name: string; color: string; parent_id: string | null; is_income?: boolean; is_transfer?: boolean }[];
  onSubmit: (v: { from_category_id: string; to_category_id: string; month: string; amount_usd: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [m, setM] = useState(new Date().getMonth());
  const [amt, setAmt] = useState("");
  const opts = categories.filter((c) => !c.is_income && !c.is_transfer);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><ArrowLeftRight className="h-3.5 w-3.5" /> Realocar</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div className="text-sm font-medium">Mover orçamento entre categorias</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>{opts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Para</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>{opts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Mês</Label>
            <Select value={String(m)} onValueChange={(v) => setM(Number(v))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS_PT.map((mm, i) => <SelectItem key={mm} value={String(i)}>{mm}/{year}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor (USD)</Label>
            <input type="number" step="10" value={amt} onChange={(e) => setAmt(e.target.value)}
              className="w-full bg-input border border-border rounded px-2 h-9 text-sm" />
          </div>
        </div>
        <Button size="sm" className="w-full" onClick={() => {
          const n = Number(amt);
          if (!from || !to || from === to || !isFinite(n) || n <= 0) return;
          onSubmit({ from_category_id: from, to_category_id: to, month: monthKey(year, m), amount_usd: n });
          setOpen(false); setAmt("");
        }}>
          Mover {amt && formatCurrency(Number(amt) || 0)}
        </Button>
      </PopoverContent>
    </Popover>
  );
}