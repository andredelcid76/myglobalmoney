import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRules, upsertRule, deleteRule, applyRules, suggestCategoriesAI, acceptSuggestions } from "@/lib/rules.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Sparkles, Play, Wand2 } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";

export const Route = createFileRoute("/_app/rules")({ component: RulesPage });

type RuleForm = {
  id?: string;
  pattern: string;
  match_type: "contains" | "exact" | "regex";
  category_id: string;
  priority: number;
  is_active: boolean;
};

const emptyRule: RuleForm = { pattern: "", match_type: "contains", category_id: "", priority: 100, is_active: true };

function RulesPage() {
  const fetchRules = useServerFn(listRules);
  const saveRule = useServerFn(upsertRule);
  const delRule = useServerFn(deleteRule);
  const runRules = useServerFn(applyRules);
  const aiSuggest = useServerFn(suggestCategoriesAI);
  const acceptSugg = useServerFn(acceptSuggestions);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["rules"], queryFn: () => fetchRules() });
  const [form, setForm] = useState<RuleForm | null>(null);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [createRule, setCreateRule] = useState<Record<string, boolean>>({});

  const catLabel = useMemo(() => {
    const m = new Map<string, string>();
    const cats = data?.categories ?? [];
    cats.forEach((c: any) => {
      const parent = c.parent_id ? cats.find((x: any) => x.id === c.parent_id) : null;
      m.set(c.id, parent ? `${parent.name} > ${c.name}` : c.name);
    });
    return m;
  }, [data]);

  const save = useMutation({
    mutationFn: (v: RuleForm) => saveRule({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); setForm(null); toast.success("Regra salva"); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delRule({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); toast.success("Regra removida"); },
  });

  const apply = useMutation({
    mutationFn: (scope: "uncategorized" | "all") => runRules({ data: { scope } }),
    onSuccess: (r) => { qc.invalidateQueries(); toast.success(`${r.matched} transações categorizadas (de ${r.scanned} analisadas)`); },
    onError: (e: any) => toast.error(e.message),
  });

  const suggest = useMutation({
    mutationFn: () => aiSuggest({ data: { limit: 50 } }),
    onSuccess: (r) => {
      setSuggestions(r.suggestions);
      const initSel: Record<string, boolean> = {};
      r.suggestions.forEach((s: any) => { if (s.category_id && s.confidence >= 0.7) initSel[s.transaction_id] = true; });
      setSelected(initSel);
      toast.success(`${r.suggestions.length} sugestões geradas pela IA`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const accept = useMutation({
    mutationFn: () => {
      const items = (suggestions ?? [])
        .filter((s) => selected[s.transaction_id] && s.category_id)
        .map((s) => ({
          transaction_id: s.transaction_id,
          category_id: s.category_id!,
          create_rule: !!createRule[s.transaction_id],
          rule_pattern: createRule[s.transaction_id] ? s.merchant : undefined,
        }));
      if (items.length === 0) throw new Error("Selecione ao menos uma sugestão");
      return acceptSugg({ data: { items } });
    },
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast.success(`${r.categorized} categorizadas, ${r.rulesCreated} regras criadas`);
      setSuggestions(null); setSelected({}); setCreateRule({});
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Regras & IA</h1>
          <p className="text-sm text-muted-foreground mt-1">Classifique transações automaticamente com regras ou sugestões da IA.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => apply.mutate("uncategorized")} disabled={apply.isPending}>
            <Play className="h-4 w-4 mr-1" /> Aplicar em não classificadas
          </Button>
          <Button variant="outline" size="sm" onClick={() => apply.mutate("all")} disabled={apply.isPending}>
            <Play className="h-4 w-4 mr-1" /> Aplicar em todas
          </Button>
          <Button size="sm" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
            <Sparkles className="h-4 w-4 mr-1" /> {suggest.isPending ? "Analisando…" : "Sugerir com IA"}
          </Button>
        </div>
      </div>

      {/* AI Suggestions panel */}
      {suggestions && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Sugestões da IA ({suggestions.length})</h2>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSuggestions(null)}>Descartar</Button>
              <Button size="sm" onClick={() => accept.mutate()} disabled={accept.isPending}>
                Aplicar selecionadas ({Object.values(selected).filter(Boolean).length})
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-2 w-8"></th>
                  <th className="text-left px-2 py-2">Merchant</th>
                  <th className="text-right px-2 py-2">Valor</th>
                  <th className="text-left px-2 py-2">Sugestão</th>
                  <th className="text-center px-2 py-2">Conf.</th>
                  <th className="text-center px-2 py-2">Criar regra</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.transaction_id} className="border-t border-border">
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={!!selected[s.transaction_id]} disabled={!s.category_id} onChange={(e) => setSelected({ ...selected, [s.transaction_id]: e.target.checked })} />
                    </td>
                    <td className="px-2 py-1.5 font-medium truncate max-w-[200px]">{s.merchant}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{formatCurrency(Number(s.amount_usd))}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{s.category_label ?? <span className="italic">sem sugestão</span>}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.confidence >= 0.8 ? "bg-success/20 text-success" : s.confidence >= 0.5 ? "bg-amber-500/20 text-amber-600" : "bg-muted text-muted-foreground"}`}>
                        {Math.round(s.confidence * 100)}%
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={!!createRule[s.transaction_id]} disabled={!s.category_id} onChange={(e) => setCreateRule({ ...createRule, [s.transaction_id]: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold">Regras ({data?.rules.length ?? 0})</h2>
          <Button size="sm" onClick={() => setForm({ ...emptyRule })}><Plus className="h-4 w-4 mr-1" /> Nova regra</Button>
        </div>
        {(data?.rules.length ?? 0) === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma regra. Crie regras para que toda transação de "Starbucks" caia em "Coffee Shops", por exemplo.
          </div>
        )}
        {(data?.rules.length ?? 0) > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Padrão</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Categoria</th>
                <th className="text-center px-3 py-2">Prioridade</th>
                <th className="text-center px-3 py-2">Ativa</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data?.rules.map((r: any) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium"><code className="text-xs bg-secondary px-1.5 py-0.5 rounded">{r.pattern}</code></td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{r.match_type}</td>
                  <td className="px-3 py-2">{catLabel.get(r.category_id) ?? "—"}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.priority}</td>
                  <td className="px-3 py-2 text-center">{r.is_active ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setForm({ id: r.id, pattern: r.pattern, match_type: r.match_type, category_id: r.category_id, priority: r.priority, is_active: r.is_active })}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit modal */}
      {form && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur grid place-items-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{form.id ? "Editar regra" : "Nova regra"}</h2>
            <div>
              <label className="text-xs text-muted-foreground">Padrão (texto que deve aparecer no merchant)</label>
              <Input placeholder="ex: STARBUCKS" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Tipo</label>
                <select value={form.match_type} onChange={(e) => setForm({ ...form, match_type: e.target.value as any })} className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                  <option value="contains">Contém</option>
                  <option value="exact">Exato</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Prioridade</label>
                <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Categoria</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="">—</option>
                {data?.categories.map((c: any) => <option key={c.id} value={c.id}>{catLabel.get(c.id)}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm">Ativa</label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.pattern || !form.category_id}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}