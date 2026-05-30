import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listRecurrences, upsertRecurrence, deleteRecurrence,
  detectRecurrences, saveDetectedRecurrences,
} from "@/lib/recurrences.functions";
import { formatCurrency } from "@/lib/format";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Wand2, Repeat, Check } from "lucide-react";

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
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["recurrences"], queryFn: () => fetchList() });
  const [form, setForm] = useState<Form | null>(null);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const save = useMutation({
    mutationFn: (v: Form) => upsert({ data: { ...v, merchant_pattern: v.merchant_pattern || null, notes: v.notes || null } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurrences"] }); setForm(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurrences"] }),
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
        {(data?.recurrences ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Repeat className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Nenhuma recorrência ainda. Clique em "Detectar do histórico" para começar.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Nome</th>
                <th className="text-left px-4 py-2">Categoria</th>
                <th className="text-left px-4 py-2">Conta</th>
                <th className="text-left px-4 py-2">Cadência</th>
                <th className="text-left px-4 py-2">Próx.</th>
                <th className="text-right px-4 py-2">Valor</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {data!.recurrences.map((r: any) => (
                <tr key={r.id} className={`border-t border-border hover:bg-secondary/30 cursor-pointer ${!r.is_active ? "opacity-50" : ""}`}
                    onClick={() => setForm({
                      id: r.id, name: r.name, merchant_pattern: r.merchant_pattern ?? "",
                      account_id: r.account_id, category_id: r.category_id, amount_usd: Number(r.amount_usd),
                      cadence: r.cadence, day_of_month: r.day_of_month, next_date: r.next_date,
                      is_income: r.is_income, is_active: r.is_active, notes: r.notes ?? "",
                    })}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.source === "auto" && <div className="text-[10px] text-muted-foreground uppercase tracking-widest">auto</div>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{categoryName(r.category_id)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{accountName(r.account_id)}</td>
                  <td className="px-4 py-2">{cadenceLabel[r.cadence]}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.next_date}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${r.is_income ? "text-emerald-400" : ""}`}>
                    {formatCurrency(Number(r.amount_usd))}
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={(e) => { e.stopPropagation(); if (confirm(`Excluir "${r.name}"?`)) remove.mutate(r.id); }}
                            className="text-muted-foreground hover:text-destructive p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
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