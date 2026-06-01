import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCategories, upsertCategory, deleteCategory } from "@/lib/finance.functions";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Search, FolderTree } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/categories")({ component: CategoriesPage });

type Form = { id?: string; name: string; color: string; parent_id: string | null; is_income: boolean; budget_group: "fixa" | "variavel" };
const empty: Form = { name: "", color: "#4f46e5", parent_id: null, is_income: false, budget_group: "variavel" };

function CategoriesPage() {
  const fetchCats = useServerFn(listCategories);
  const upsert = useServerFn(upsertCategory);
  const del = useServerFn(deleteCategory);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => fetchCats() });
  const [form, setForm] = useState<Form | null>(null);
  const [q, setQ] = useState("");

  const tree = useMemo(() => {
    const cats = data?.categories ?? [];
    const term = q.trim().toLowerCase();
    const matches = (c: any) => !term || (c.name as string).toLowerCase().includes(term);
    const parents = cats.filter((c: any) => !c.parent_id);
    return parents
      .map((p: any) => {
        const children = cats.filter((c: any) => c.parent_id === p.id);
        const visibleChildren = term ? children.filter(matches) : children;
        const includeParent = !term || matches(p) || visibleChildren.length > 0;
        return includeParent ? { ...p, children: term ? visibleChildren : children } : null;
      })
      .filter(Boolean) as any[];
  }, [data, q]);

  const parents = useMemo(
    () => (data?.categories ?? []).filter((c: any) => !c.parent_id),
    [data],
  );

  const save = useMutation({
    mutationFn: (v: Form) => upsert({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setForm(null); },
  });
  const inlineUpdate = useMutation({
    mutationFn: (v: Partial<Form> & { id: string; name: string }) => upsert({ data: v as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  const totals = useMemo(() => {
    const cats = data?.categories ?? [];
    return {
      total: cats.length,
      parents: cats.filter((c: any) => !c.parent_id).length,
      subs: cats.filter((c: any) => c.parent_id).length,
      fixas: cats.filter((c: any) => c.budget_group === "fixa").length,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
          <p className="text-sm text-muted-foreground">
            {totals.parents} grupos · {totals.subs} subcategorias · {totals.fixas} marcadas como fixas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar categoria…" className="pl-8 h-9 w-56" />
          </div>
          <Button onClick={() => setForm({ ...empty })}><Plus className="h-4 w-4 mr-1" /> Nova categoria</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_120px_88px] gap-2 px-4 py-2 bg-secondary/40 text-xs text-muted-foreground border-b border-border">
          <div>Nome</div>
          <div>Grupo (pai)</div>
          <div>Bucket</div>
          <div className="text-right">Ações</div>
        </div>

        {tree.map((p) => (
          <div key={p.id}>
            <div className="grid grid-cols-[1fr_140px_120px_88px] gap-2 px-4 py-2.5 bg-secondary/15 border-b border-border items-center">
              <div className="flex items-center gap-2 min-w-0">
                <FolderTree className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  type="color" value={p.color}
                  className="h-5 w-5 rounded cursor-pointer bg-transparent border border-border"
                  onChange={(e) => inlineUpdate.mutate({ id: p.id, name: p.name, color: e.target.value })}
                />
                <input
                  className="bg-transparent font-medium truncate outline-none border-b border-transparent focus:border-primary"
                  defaultValue={p.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name) inlineUpdate.mutate({ id: p.id, name: v });
                  }}
                />
                {p.is_income && <span className="text-[10px] uppercase tracking-widest text-emerald-400">income</span>}
                {p.is_transfer && <span className="text-[10px] uppercase tracking-widest text-amber-400">transfer</span>}
              </div>
              <div className="text-xs text-muted-foreground italic">— raiz —</div>
              <select
                value={p.budget_group ?? "variavel"}
                onChange={(e) => inlineUpdate.mutate({ id: p.id, name: p.name, budget_group: e.target.value as any })}
                className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="fixa">Fixa</option>
                <option value="variavel">Variável</option>
              </select>
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...empty, parent_id: p.id })} title="Adicionar subcategoria">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => { if (p.children.length > 0) { toast.error("Mova ou exclua as subcategorias antes."); return; } if (confirm(`Excluir grupo "${p.name}"?`)) remove.mutate(p.id); }}
                  className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {p.children.map((c: any) => (
              <div key={c.id} className="grid grid-cols-[1fr_140px_120px_88px] gap-2 px-4 py-1.5 border-b border-border/60 items-center hover:bg-secondary/20">
                <div className="flex items-center gap-2 pl-7 min-w-0">
                  <input
                    type="color" value={c.color}
                    className="h-4 w-4 rounded cursor-pointer bg-transparent border border-border"
                    onChange={(e) => inlineUpdate.mutate({ id: c.id, name: c.name, color: e.target.value })}
                  />
                  <input
                    className="bg-transparent text-sm truncate outline-none border-b border-transparent focus:border-primary"
                    defaultValue={c.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== c.name) inlineUpdate.mutate({ id: c.id, name: v });
                    }}
                  />
                </div>
                <select
                  value={c.parent_id ?? ""}
                  onChange={(e) => inlineUpdate.mutate({ id: c.id, name: c.name, parent_id: e.target.value || null })}
                  className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
                  title="Mover para outro grupo"
                >
                  {parents.map((pp: any) => (
                    <option key={pp.id} value={pp.id}>{pp.name}</option>
                  ))}
                </select>
                <select
                  value={c.budget_group ?? "variavel"}
                  onChange={(e) => inlineUpdate.mutate({ id: c.id, name: c.name, budget_group: e.target.value as any })}
                  className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="fixa">Fixa</option>
                  <option value="variavel">Variável</option>
                </select>
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => { if (confirm(`Excluir ${c.name}?`)) remove.mutate(c.id); }}
                    className="text-muted-foreground hover:text-destructive p-1"
                  ><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        ))}

        {tree.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma categoria encontrada.</div>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur grid place-items-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{form.id ? "Editar categoria" : form.parent_id ? "Nova subcategoria" : "Nova categoria"}</h2>
            <Input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_income} onChange={(e) => setForm({ ...form, is_income: e.target.checked })} /> Income
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Bucket</span>
                <select value={form.budget_group} onChange={(e) => setForm({ ...form, budget_group: e.target.value as any })}
                  className="w-full rounded-md border border-border bg-input px-3 py-2">
                  <option value="fixa">Fixa</option>
                  <option value="variavel">Variável</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Grupo (pai)</span>
            <select value={form.parent_id ?? ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })} className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
              <option value="">— Sem categoria pai —</option>
              {data?.categories.filter((c: any) => !c.parent_id && c.id !== form.id).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
              </label>
            </div>
            <div className="flex justify-between pt-2">
              {form.id && <Button variant="ghost" className="text-destructive" onClick={() => { if (confirm("Excluir?")) { remove.mutate(form.id!); setForm(null); } }}>Excluir</Button>}
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