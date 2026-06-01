import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listRecurrences, upsertRecurrence, deleteRecurrence,
  detectRecurrences, saveDetectedRecurrences,
  bulkUpdateRecurrences, bulkDeleteRecurrences,
} from "@/lib/recurrences.functions";
import { formatCurrency } from "@/lib/format";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Wand2, Repeat, Check, CheckSquare, ArrowUpDown, Search, FolderTree } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recurrences")({ component: RecurrencesPage });

type Form = {
  id?: string;
  name: string;
  merchant_pattern: string;
  account_id: string | null;
  category_id: string | null;
  amount_usd: number;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  day_of_month: number | null;
  next_date: string;
  is_income: boolean;
  is_active: boolean;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const empty: Form = {
  name: "", merchant_pattern: "", account_id: null, category_id: null,
  amount_usd: 0, cadence: "monthly", day_of_month: 1, next_date: today(),
  is_income: false, is_active: true, notes: "",
};

const cadenceLabel: Record<string, string> = {
  weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal", quarterly: "Trimestral", yearly: "Anual",
};
const cadenceFactor: Record<string, number> = {
  weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12,
};

function RecurrencesPage() {
  const fetchList = useServerFn(listRecurrences);
  const upsert = useServerFn(upsertRecurrence);
  const del = useServerFn(deleteRecurrence);
  const detect = useServerFn(detectRecurrences);
  const saveDetected = useServerFn(saveDetectedRecurrences);
  const bulkUpdate = useServerFn(bulkUpdateRecurrences);
  const bulkDelete = useServerFn(bulkDeleteRecurrences);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["recurrences"], queryFn: () => fetchList() });
  const [form, setForm] = useState<Form | null>(null);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<"account" | "category" | "cadence" | "amount" | "">("");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [query, setQuery] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [filterAcc, setFilterAcc] = useState<string>("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");
  const [grouped, setGrouped] = useState(true);
  const [sortBy, setSortBy] = useState<"name" | "next" | "amount" | "cadence">("next");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const save = useMutation({
    mutationFn: (v: Form) => upsert({ data: { ...v, merchant_pattern: v.merchant_pattern || null, notes: v.notes || null } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurrences"] }); setForm(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurrences"] }),
  });
  const mBulkUpd = useMutation({
    mutationFn: (patch: any) => bulkUpdate({ data: { ids: Array.from(selectedIds), patch } }),
    onSuccess: (r) => {
      toast.success(`${r.updated} recorrência(s) atualizada(s)`);
      setSelectedIds(new Set()); setBulkField(""); setBulkValue("");
      qc.invalidateQueries({ queryKey: ["recurrences"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const mBulkDel = useMutation({
    mutationFn: () => bulkDelete({ data: { ids: Array.from(selectedIds) } }),
    onSuccess: (r) => {
      toast.success(`${r.deleted} recorrência(s) excluída(s)`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["recurrences"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const runDetect = useMutation({
    mutationFn: () => detect(),
    onSuccess: (r) => { setSuggestions(r.suggestions); setSelected(new Set(r.suggestions.map((_: any, i: number) => i))); },
  });
  const importSelected = useMutation({
    mutationFn: () => saveDetected({ data: { items: (suggestions ?? []).filter((_, i) => selected.has(i)).map(({ occurrences, ...rest }) => rest) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurrences"] }); setSuggestions(null); setSelected(new Set()); },
  });

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    for (const r of data?.recurrences ?? []) {
      if (!r.is_active) continue;
      const m = Math.abs(Number(r.amount_usd)) * (cadenceFactor[r.cadence] ?? 1);
      if (r.is_income) income += m; else expense += m;
    }
    return { income, expense, net: income - expense };
  }, [data]);

  const accountName = (id: string | null) => data?.accounts.find((a: any) => a.id === id)?.name ?? "—";
  const categoryName = (id: string | null) => data?.categories.find((c: any) => c.id === id)?.name ?? "Sem categoria";

  const allRecs = data?.recurrences ?? [];
  const cats = data?.categories ?? [];
  const catMap = useMemo(() => new Map<string, any>(cats.map((c: any) => [c.id, c])), [cats]);
  const parentIdOf = (catId: string | null) => {
    if (!catId) return null;
    const c = catMap.get(catId);
    return c?.parent_id ?? c?.id ?? null;
  };

  const recs = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = allRecs.filter((r: any) => {
      if (term && !((r.name as string).toLowerCase().includes(term) || (r.merchant_pattern ?? "").toLowerCase().includes(term))) return false;
      if (filterAcc && r.account_id !== filterAcc) return false;
      if (filterCat) {
        const pid = parentIdOf(r.category_id);
        if (r.category_id !== filterCat && pid !== filterCat) return false;
      }
      if (filterType === "income" && !r.is_income) return false;
      if (filterType === "expense" && r.is_income) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const cadOrder: Record<string, number> = { weekly: 0, biweekly: 1, monthly: 2, quarterly: 3, yearly: 4 };
    list = list.slice().sort((a: any, b: any) => {
      if (sortBy === "name") return a.name.localeCompare(b.name) * dir;
      if (sortBy === "amount") return (Math.abs(Number(a.amount_usd)) - Math.abs(Number(b.amount_usd))) * dir;
      if (sortBy === "cadence") return ((cadOrder[a.cadence] ?? 9) - (cadOrder[b.cadence] ?? 9)) * dir;
      return (a.next_date ?? "").localeCompare(b.next_date ?? "") * dir;
    });
    return list;
  }, [allRecs, query, filterAcc, filterCat, filterType, sortBy, sortDir, catMap]);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const byParent = new Map<string, { parent: any; subs: Map<string, { sub: any | null; items: any[] }> }>();
    for (const r of recs) {
      const c = r.category_id ? catMap.get(r.category_id) : null;
      const parent = c?.parent_id ? catMap.get(c.parent_id) : c;
      const pKey = parent?.id ?? "__none__";
      const sKey = c?.parent_id ? c.id : "__self__";
      const g = byParent.get(pKey) ?? { parent: parent ?? null, subs: new Map() };
      const s = g.subs.get(sKey) ?? { sub: c?.parent_id ? c : null, items: [] };
      s.items.push(r);
      g.subs.set(sKey, s);
      byParent.set(pKey, g);
    }
    return Array.from(byParent.entries()).map(([pKey, g]) => ({
      key: pKey,
      name: g.parent?.name ?? "Sem categoria",
      color: g.parent?.color ?? "#64748b",
      subs: Array.from(g.subs.values()).sort((a, b) => (a.sub?.name ?? "").localeCompare(b.sub?.name ?? "")),
      total: Array.from(g.subs.values()).reduce((s, x) => s + x.items.length, 0),
      sum: Array.from(g.subs.values()).reduce((s, x) => s + x.items.reduce((ss: number, r: any) => ss + Math.abs(Number(r.amount_usd)) * (cadenceFactor[r.cadence] ?? 1), 0), 0),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [recs, grouped, catMap]);

  const allSelected = recs.length > 0 && recs.every((r: any) => selectedIds.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(recs.map((r: any) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSort = (k: typeof sortBy) => {
    if (sortBy === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("asc"); }
  };

  const parentCats = cats.filter((c: any) => !c.parent_id);

  const applyBulk = () => {
    if (!bulkField) return;
    let patch: any = {};
    if (bulkField === "account") patch.account_id = bulkValue === "__none__" ? null : bulkValue || null;
    else if (bulkField === "category") patch.category_id = bulkValue === "__none__" ? null : bulkValue || null;
    else if (bulkField === "cadence") patch.cadence = bulkValue;
    else if (bulkField === "amount") {
      const v = Number(bulkValue);
      if (Number.isNaN(v)) { toast.error("Valor inválido"); return; }
      patch.amount_usd = v;
    }
    if (Object.keys(patch).length === 0) return;
    mBulkUpd.mutate(patch);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recorrências</h1>
          <p className="text-sm text-muted-foreground">Lançamentos previsíveis usados nas projeções</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runDetect.mutate()} disabled={runDetect.isPending}>
            <Wand2 className="h-4 w-4 mr-1" /> {runDetect.isPending ? "Analisando…" : "Detectar do histórico"}
          </Button>
          <Button onClick={() => setForm({ ...empty })}>
            <Plus className="h-4 w-4 mr-1" /> Nova recorrência
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card label="Receitas/mês" value={formatCurrency(totals.income)} accent="text-emerald-400" />
        <Card label="Despesas/mês" value={formatCurrency(totals.expense)} accent="text-destructive" />
        <Card label="Líquido/mês" value={formatCurrency(totals.net)} accent={totals.net >= 0 ? "text-emerald-400" : "text-destructive"} />
      </div>

      {suggestions && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">{suggestions.length} sugestões detectadas</div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSuggestions(null)}>Descartar</Button>
              <Button size="sm" onClick={() => importSelected.mutate()} disabled={!selected.size || importSelected.isPending}>
                <Check className="h-4 w-4 mr-1" /> Importar {selected.size}
              </Button>
            </div>
          </div>
          {suggestions.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhum padrão recorrente novo encontrado.</div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {suggestions.map((s, i) => (
                <label key={i} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-secondary/50 cursor-pointer text-sm">
                  <input
                    type="checkbox" checked={selected.has(i)}
                    onChange={(e) => {
                      const n = new Set(selected);
                      if (e.target.checked) n.add(i); else n.delete(i);
                      setSelected(n);
                    }}
                  />
                  <div className="flex-1 min-w-0 truncate">{s.name}</div>
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">{cadenceLabel[s.cadence]}</span>
                  <span className="text-xs text-muted-foreground">{s.occurrences}×</span>
                  <span className={`tabular-nums w-24 text-right ${s.is_income ? "text-emerald-400" : ""}`}>{formatCurrency(s.amount_usd)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-secondary/20 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" className="pl-8 h-8 w-48" />
          </div>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="rounded-md border border-border bg-input px-2 py-1 text-xs h-8">
            <option value="">Todas as categorias</option>
            {parentCats.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={filterAcc} onChange={(e) => setFilterAcc(e.target.value)} className="rounded-md border border-border bg-input px-2 py-1 text-xs h-8">
            <option value="">Todas as contas</option>
            {data?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)} className="rounded-md border border-border bg-input px-2 py-1 text-xs h-8">
            <option value="all">Receitas e despesas</option>
            <option value="income">Só receitas</option>
            <option value="expense">Só despesas</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto cursor-pointer">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            <FolderTree className="h-3.5 w-3.5" /> Agrupar por categoria
          </label>
          <span className="text-xs text-muted-foreground">{recs.length} de {allRecs.length}</span>
        </div>

        {selectedIds.size > 0 && (
          <div className="px-3 py-2 bg-primary/5 border-b border-primary/30 flex flex-wrap items-center gap-2">
            <CheckSquare className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{selectedIds.size} selecionada(s)</span>
            <span className="text-xs text-muted-foreground mx-1">·</span>
            <span className="text-xs text-muted-foreground">Alterar</span>
            <select value={bulkField} onChange={(e) => { setBulkField(e.target.value as any); setBulkValue(""); }}
              className="rounded-md border border-border bg-input px-2 py-1 text-sm">
              <option value="">— campo —</option>
              <option value="account">Conta</option>
              <option value="category">Categoria</option>
              <option value="cadence">Cadência</option>
              <option value="amount">Valor (USD)</option>
            </select>
            {bulkField === "account" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                className="rounded-md border border-border bg-input px-2 py-1 text-sm">
                <option value="">— conta —</option>
                <option value="__none__">Sem conta</option>
                {data?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {bulkField === "category" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                className="rounded-md border border-border bg-input px-2 py-1 text-sm">
                <option value="">— categoria —</option>
                <option value="__none__">Sem categoria</option>
                {data?.categories.map((c: any) => <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>)}
              </select>
            )}
            {bulkField === "cadence" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                className="rounded-md border border-border bg-input px-2 py-1 text-sm">
                <option value="">— cadência —</option>
                {Object.entries(cadenceLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
            {bulkField === "amount" && (
              <Input type="number" step="0.01" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                placeholder="USD" className="w-28 h-8" />
            )}
            <Button size="sm" disabled={!bulkField || !bulkValue || mBulkUpd.isPending} onClick={applyBulk}>
              Aplicar
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive ml-auto"
              onClick={() => { if (confirm(`Excluir ${selectedIds.size} recorrência(s)?`)) mBulkDel.mutate(); }}>
              Excluir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Limpar</Button>
          </div>
        )}
        {recs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Repeat className="h-8 w-8 mx-auto mb-2 opacity-50" />
            {allRecs.length === 0 ? 'Nenhuma recorrência ainda. Clique em "Detectar do histórico" para começar.' : "Nenhuma recorrência corresponde aos filtros."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todas" />
                </th>
                <th className="text-left px-4 py-2"><SortBtn label="Nome" active={sortBy==="name"} dir={sortDir} onClick={() => toggleSort("name")} /></th>
                <th className="text-left px-4 py-2">Categoria</th>
                <th className="text-left px-4 py-2">Conta</th>
                <th className="text-left px-4 py-2"><SortBtn label="Cadência" active={sortBy==="cadence"} dir={sortDir} onClick={() => toggleSort("cadence")} /></th>
                <th className="text-left px-4 py-2"><SortBtn label="Próx." active={sortBy==="next"} dir={sortDir} onClick={() => toggleSort("next")} /></th>
                <th className="text-right px-4 py-2"><SortBtn label="Valor" active={sortBy==="amount"} dir={sortDir} onClick={() => toggleSort("amount")} right /></th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {grouped && groups ? groups.flatMap((g) => [
                <tr key={`g-${g.key}`} className="bg-secondary/15 border-t border-border">
                  <td colSpan={8} className="px-3 py-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                      <span className="font-semibold">{g.name}</span>
                      <span className="text-muted-foreground">· {g.total} item(s) · {formatCurrency(g.sum)}/mês</span>
                    </div>
                  </td>
                </tr>,
                ...g.subs.flatMap((s) => [
                  ...(s.sub ? [
                    <tr key={`s-${g.key}-${s.sub.id}`} className="bg-secondary/5">
                      <td colSpan={8} className="px-3 py-1 pl-8 text-[11px] text-muted-foreground uppercase tracking-wider">↳ {s.sub.name}</td>
                    </tr>
                  ] : []),
                  ...s.items.map((r: any) => renderRow(r))
                ])
              ]) : recs.map((r: any) => renderRow(r))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur grid place-items-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{form.id ? "Editar recorrência" : "Nova recorrência"}</h2>
            <Input placeholder="Nome (ex: Netflix)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Padrão de merchant (opcional)" value={form.merchant_pattern} onChange={(e) => setForm({ ...form, merchant_pattern: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" placeholder="Valor (USD)" value={form.amount_usd}
                     onChange={(e) => setForm({ ...form, amount_usd: Number(e.target.value) })} />
              <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value as any })}
                      className="rounded-md border border-border bg-input px-3 py-2 text-sm">
                {Object.entries(cadenceLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={form.account_id ?? ""} onChange={(e) => setForm({ ...form, account_id: e.target.value || null })}
                      className="rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="">— Sem conta —</option>
                {data?.accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={form.category_id ?? ""} onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
                      className="rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="">— Sem categoria —</option>
                {data?.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground space-y-1">
                <span>Próxima data</span>
                <Input type="date" value={form.next_date} onChange={(e) => setForm({ ...form, next_date: e.target.value })} />
              </label>
              <div className="flex flex-col gap-2 justify-end text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_income} onChange={(e) => setForm({ ...form, is_income: e.target.checked })} /> Receita
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Ativo
                </label>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              {form.id && (
                <Button variant="ghost" className="text-destructive"
                        onClick={() => { if (confirm("Excluir?")) { remove.mutate(form.id!); setForm(null); } }}>
                  Excluir
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
                <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>Salvar</Button>
              </div>
            </div>
          </div>
        </div>
      )}
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