import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAccounts, upsertAccount, setAccountBalanceToday } from "@/lib/finance.functions";
import { formatCurrency } from "@/lib/format";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Archive, ArchiveRestore, Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/accounts")({ component: AccountsPage });

type Form = {
  id?: string;
  name: string;
  type: "checking" | "savings" | "credit_card" | "cash" | "investment";
  currency: "USD" | "BRL";
  institution: string;
  color: string;
  initial_balance: number;
  closing_day?: number | null;
  due_day?: number | null;
  credit_limit_usd?: number | null;
};

const empty: Form = { name: "", type: "checking", currency: "USD", institution: "", color: "#4f46e5", initial_balance: 0, closing_day: null, due_day: null, credit_limit_usd: null };

function AccountsPage() {
  const fetchAccounts = useServerFn(listAccounts);
  const upsert = useServerFn(upsertAccount);
  const setToday = useServerFn(setAccountBalanceToday);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["accounts"], queryFn: () => fetchAccounts() });
  const [form, setForm] = useState<Form | null>(null);
  const [adjust, setAdjust] = useState<{ id: string; name: string; currency: string; current: number; target: string } | null>(null);

  // Open edit dialog from #edit-<accountId> (used by Credit Cards page)
  useEffect(() => {
    if (!data?.accounts || typeof window === "undefined") return;
    const hash = window.location.hash;
    const m = hash.match(/^#edit-([0-9a-f-]+)$/i);
    if (!m) return;
    const a = data.accounts.find((x: any) => x.id === m[1]);
    if (a) {
      setForm({
        id: a.id, name: a.name, type: a.type as Form["type"], currency: a.currency as Form["currency"],
        institution: a.institution ?? "", color: a.color ?? "#4f46e5",
        initial_balance: Number(a.initial_balance),
        closing_day: a.closing_day ?? null,
        due_day: a.due_day ?? null,
        credit_limit_usd: a.credit_limit_usd != null ? Number(a.credit_limit_usd) : null,
      });
      history.replaceState(null, "", window.location.pathname);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (v: Form) => upsert({ data: {
      ...v,
      institution: v.institution || null,
      closing_day: v.type === "credit_card" ? (v.closing_day || null) : null,
      due_day: v.type === "credit_card" ? (v.due_day || null) : null,
      credit_limit_usd: v.type === "credit_card" ? (v.credit_limit_usd ?? null) : null,
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); setForm(null); },
  });

  const archive = useMutation({
    mutationFn: (a: any) => upsert({ data: { id: a.id, name: a.name, type: a.type, currency: a.currency, institution: a.institution, color: a.color, initial_balance: Number(a.initial_balance), is_archived: !a.is_archived } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const adjustMut = useMutation({
    mutationFn: (v: { account_id: string; target_balance: number }) => setToday({ data: v }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["tx"] });
      if (res?.delta === 0) toast.success("Saldo já estava correto");
      else toast.success(`Ajuste de ${res?.delta > 0 ? "+" : ""}${res?.delta?.toFixed?.(2)} aplicado`);
      setAdjust(null);
    },
    onError: (e: any) => toast.error(e.message),
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
            <div className="mt-2 text-lg font-semibold">{formatCurrency(Number(a.current_balance ?? a.initial_balance), a.currency)}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Saldo hoje · {a.currency}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Saldo inicial: {formatCurrency(Number(a.initial_balance), a.currency)}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setForm({ id: a.id, name: a.name, type: a.type, currency: a.currency, institution: a.institution ?? "", color: a.color, initial_balance: Number(a.initial_balance), closing_day: a.closing_day ?? null, due_day: a.due_day ?? null, credit_limit_usd: a.credit_limit_usd != null ? Number(a.credit_limit_usd) : null })}>Editar</Button>
              <Button size="sm" variant="outline" onClick={() => setAdjust({ id: a.id, name: a.name, currency: a.currency, current: Number(a.current_balance ?? a.initial_balance), target: String(Number(a.current_balance ?? a.initial_balance).toFixed(2)) })}>
                <Wallet className="h-4 w-4 mr-1" /> Saldo hoje
              </Button>
              <Button size="sm" variant="ghost" onClick={() => archive.mutate(a)}>
                {a.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {adjust && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur grid place-items-center z-50 p-4" onClick={() => setAdjust(null)}>
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Ajustar saldo de hoje</h2>
            <p className="text-sm text-muted-foreground">{adjust.name}</p>
            <div className="text-sm">
              Saldo atual calculado: <span className="font-medium">{formatCurrency(adjust.current, adjust.currency)}</span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Novo saldo de hoje ({adjust.currency})</label>
              <Input type="number" step="0.01" value={adjust.target}
                onChange={(e) => setAdjust({ ...adjust, target: e.target.value })} />
            </div>
            {adjust.target !== "" && !Number.isNaN(Number(adjust.target)) && (
              <div className="text-xs text-muted-foreground">
                Será criado um lançamento de ajuste de{" "}
                <span className="font-medium">
                  {(Number(adjust.target) - adjust.current >= 0 ? "+" : "")}
                  {formatCurrency(Number(adjust.target) - adjust.current, adjust.currency)}
                </span>{" "}
                em {new Date().toISOString().slice(0, 10)}.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setAdjust(null)}>Cancelar</Button>
              <Button onClick={() => adjustMut.mutate({ account_id: adjust.id, target_balance: Number(adjust.target) })}
                disabled={adjustMut.isPending || adjust.target === "" || Number.isNaN(Number(adjust.target))}>
                {adjustMut.isPending ? "Aplicando…" : "Aplicar ajuste"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
            {form.type === "credit_card" && (
              <div className="space-y-2 rounded-md border border-border p-3 bg-secondary/20">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fatura</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Fechamento (dia)</label>
                    <Input type="number" min={1} max={31} placeholder="ex: 25" value={form.closing_day ?? ""} onChange={(e) => setForm({ ...form, closing_day: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Vencimento (dia)</label>
                    <Input type="number" min={1} max={31} placeholder="ex: 5" value={form.due_day ?? ""} onChange={(e) => setForm({ ...form, due_day: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Limite (USD)</label>
                    <Input type="number" step="0.01" placeholder="opcional" value={form.credit_limit_usd ?? ""} onChange={(e) => setForm({ ...form, credit_limit_usd: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                </div>
              </div>
            )}
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