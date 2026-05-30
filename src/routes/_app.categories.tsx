import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCategories, upsertCategory, deleteCategory } from "@/lib/finance.functions";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/categories")({ component: CategoriesPage });

type Form = { id?: string; name: string; color: string; parent_id: string | null; is_income: boolean };
const empty: Form = { name: "", color: "#4f46e5", parent_id: null, is_income: false };

function CategoriesPage() {
  const fetchCats = useServerFn(listCategories);
  const upsert = useServerFn(upsertCategory);
  const del = useServerFn(deleteCategory);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["categories"], queryFn: () => fetchCats() });
  const [form, setForm] = useState<Form | null>(null);

  const tree = useMemo(() => {
    const cats = data?.categories ?? [];
    const parents = cats.filter((c: any) => !c.parent_id);
    return parents.map((p: any) => ({ ...p, children: cats.filter((c: any) => c.parent_id === p.id) }));
  }, [data]);

  const save = useMutation({
    mutationFn: (v: Form) => upsert({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setForm(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
        <Button onClick={() => setForm({ ...empty })}><Plus className="h-4 w-4 mr-1" /> Nova categoria</Button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {tree.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                <div className="font-medium">{p.name}</div>
                {p.is_income && <span className="text-[10px] uppercase tracking-widest text-emerald-400">income</span>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...empty, parent_id: p.id })}><Plus className="h-3 w-3" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setForm({ id: p.id, name: p.name, color: p.color, parent_id: null, is_income: p.is_income })}>Editar</Button>
              </div>
            </div>
            <div className="space-y-1 pl-5">
              {p.children.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    <span>{c.name}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 hover:opacity-100 group-hover:opacity-100">
                    <button onClick={() => setForm({ id: c.id, name: c.name, color: c.color, parent_id: c.parent_id, is_income: c.is_income })} className="text-xs text-muted-foreground hover:text-foreground">Editar</button>
                    <button onClick={() => { if (confirm(`Excluir ${c.name}?`)) remove.mutate(c.id); }} className="text-xs text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
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
            <select value={form.parent_id ?? ""} onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })} className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
              <option value="">— Sem categoria pai —</option>
              {data?.categories.filter((c: any) => !c.parent_id && c.id !== form.id).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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