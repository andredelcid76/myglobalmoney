import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAccounts, upsertAccount } from "@/lib/finance.functions";
import { formatCurrency } from "@/lib/format";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Archive, ArchiveRestore } from "lucide-react";

export const Route = createFileRoute("/_app/accounts")({ component: AccountsPage });

type Form = {
  id?: string;
  name: string;
  type: "checking" | "savings" | "credit_card" | "cash" | "investment";
  currency: "USD" | "BRL";
  institution: string;
  color: string;
  initial_balance: number;
};

const empty: Form = { name: "", type: "checking", currency: "USD", institution: "", color: "#4f46e5", initial_balance: 0 };

function AccountsPage() {
  const fetchAccounts = useServerFn(listAccounts);
  const upsert = useServerFn(upsertAccount);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["accounts"], queryFn: () => fetchAccounts() });
  const [form, setForm] = useState<Form | null>(null);

  const save = useMutation({
    mutationFn: (v: Form) => upsert({ data: { ...v, institution: v.institution || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); setForm(null); },
  });

  const archive = useMutation({
    mutationFn: (a: any) => upsert({ data: { id: a.id, name: a.name, type: a.type, currency: a.currency, institution: a.institution, color: a.color, initial_balance: Number(a.initial_balance), is_archived: !a.is_archived } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Contas</h1>
        <Button onClick={() => setForm({ ...empty })}><Plus className="h-4 w-4 mr-1" /> Nova conta</Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data?.accounts.map((a: any) => (
          <div key={a.id} className={`rounded-xl border border-border bg-card p-4 ${a.is_archived ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-3 w-3 rounded-full" style={{ background: a.color }} />
              <div className="font-medium truncate">{a.name}</div>
            </div>
            <div className="text-xs text-muted-foreground">{a.institution} · {a.type}</div>
            <div className="mt-2 text-lg font-semibold">{formatCurrency(Number(a.initial_balance), a.currency)}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Saldo inicial · {a.currency}</div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setForm({ id: a.id, name: a.name, type: a.type, currency: a.currency, institution: a.institution ?? "", color: a.color, initial_balance: Number(a.initial_balance) })}>Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => archive.mutate(a)}>
                {a.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur grid place-items-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{form.id ? "Editar conta" : "Nova conta"}</h2>
            <Input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Instituição" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Form["type"] })} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit card</option>
                <option value="cash">Cash</option>
                <option value="investment">Investment</option>
              </select>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as "USD" | "BRL" })} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="USD">USD</option>
                <option value="BRL">BRL</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              <Input type="number" step="0.01" placeholder="Saldo inicial" value={form.initial_balance} onChange={(e) => setForm({ ...form, initial_balance: Number(e.target.value) })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}