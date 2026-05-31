import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTransactions, updateTxCategory } from "@/lib/finance.functions";
import { splitTransaction, unsplitTransaction, updateTxTags, listAllTags } from "@/lib/splits.functions";
import { getLedgerView } from "@/lib/ledger.functions";
import { formatCurrency, formatDate } from "@/lib/format";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Split, Tag as TagIcon, X, Undo2, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_app/transactions")({ component: TxPage });

function TxPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Transações</h1>
      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">Lista</TabsTrigger>
          <TabsTrigger value="ledger">Extrato</TabsTrigger>
        </TabsList>
        <TabsContent value="list"><TxListView /></TabsContent>
        <TabsContent value="ledger"><TxLedgerView /></TabsContent>
      </Tabs>
    </div>
  );
}

function TxListView() {
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [splitTx, setSplitTx] = useState<any | null>(null);
  const [tagsTx, setTagsTx] = useState<any | null>(null);
  const fetchTx = useServerFn(listTransactions);
  const updateCat = useServerFn(updateTxCategory);
  const fetchTags = useServerFn(listAllTags);
  const unsplit = useServerFn(unsplitTransaction);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["tx", search, accountId, tag],
    queryFn: () => fetchTx({ data: { limit: 300, search: search || undefined, accountId: accountId || undefined, tag: tag || undefined } }),
  });
  const { data: tagsData } = useQuery({
    queryKey: ["tx-tags"],
    queryFn: () => fetchTags(),
  });
  const mUpdate = useMutation({
    mutationFn: (v: { id: string; categoryId: string | null }) => updateCat({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tx"] }),
  });
  const mUnsplit = useMutation({
    mutationFn: (group_id: string) => unsplit({ data: { split_group_id: group_id } }),
    onSuccess: () => {
      toast.success("Split desfeito");
      qc.invalidateQueries({ queryKey: ["tx"] });
      qc.invalidateQueries({ queryKey: ["tx-tags"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
          <option value="">Todas contas</option>
          {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
          <option value="">Todas tags</option>
          {tagsData?.tags.map((t) => <option key={t.name} value={t.name}>#{t.name} ({t.count})</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Merchant</th>
              <th className="text-left px-3 py-2">Categoria</th>
              <th className="text-left px-3 py-2">Tags</th>
              <th className="text-left px-3 py-2">Conta</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-right px-3 py-2">USD</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.transactions.map((t) => {
              const acc = data.accounts.find((a) => a.id === t.account_id);
              const isSplit = !!(t as any).split_group_id;
              return (
                <tr key={t.id} className="border-t border-border hover:bg-secondary/20">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="px-3 py-2 font-medium">
                    {t.merchant}
                    {isSplit && <Badge variant="secondary" className="ml-2 text-[10px]"><Split className="h-3 w-3 mr-1" />split</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={t.category_id ?? ""}
                      onChange={(e) => mUpdate.mutate({ id: t.id, categoryId: e.target.value || null })}
                      className="bg-transparent border border-border rounded px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 items-center max-w-[200px]">
                      {(t.tags ?? []).map((tg: string) => (
                        <Badge key={tg} variant="outline" className="text-[10px] cursor-pointer" onClick={() => setTag(tg)}>#{tg}</Badge>
                      ))}
                      <button onClick={() => setTagsTx(t)} className="text-muted-foreground hover:text-foreground">
                        <TagIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{acc?.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(t.amount), t.currency)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${Number(t.amount_usd) < 0 ? "text-destructive" : "text-success"}`}>
                    {formatCurrency(Number(t.amount_usd))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isSplit ? (
                      <button
                        title="Desfazer split"
                        onClick={() => mUnsplit.mutate((t as any).split_group_id)}
                        className="text-muted-foreground hover:text-foreground"
                      ><Undo2 className="h-4 w-4 inline" /></button>
                    ) : (
                      <button
                        title="Dividir transação"
                        onClick={() => setSplitTx(t)}
                        className="text-muted-foreground hover:text-foreground"
                      ><Split className="h-4 w-4 inline" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.transactions.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma transação. Importe seu CSV em "Importar CSV".</div>
        )}
      </div>

      {splitTx && (
        <SplitDialog tx={splitTx} categories={data?.categories ?? []} onClose={() => setSplitTx(null)} />
      )}
      {tagsTx && (
        <TagsDialog tx={tagsTx} onClose={() => setTagsTx(null)} />
      )}
    </div>
  );
}

function SplitDialog({ tx, categories, onClose }: { tx: any; categories: any[]; onClose: () => void }) {
  const original = Number(tx.amount);
  const [parts, setParts] = useState<{ amount: string; category_id: string; notes: string }[]>([
    { amount: (original / 2).toFixed(2), category_id: tx.category_id ?? "", notes: "" },
    { amount: (original - original / 2).toFixed(2), category_id: "", notes: "" },
  ]);
  const split = useServerFn(splitTransaction);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => split({ data: {
      transaction_id: tx.id,
      parts: parts.map((p) => ({
        amount: Number(p.amount),
        category_id: p.category_id || null,
        notes: p.notes || null,
      })),
    }}),
    onSuccess: () => {
      toast.success("Transação dividida");
      qc.invalidateQueries({ queryKey: ["tx"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sum = parts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const diff = original - sum;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dividir transação</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          {tx.merchant} · {formatDate(tx.date)} · <span className="font-medium text-foreground">{formatCurrency(original, tx.currency)}</span>
        </div>
        <div className="space-y-2">
          {parts.map((p, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <Input
                type="number" step="0.01"
                value={p.amount}
                onChange={(e) => setParts((arr) => arr.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                className="w-28"
              />
              <select
                value={p.category_id}
                onChange={(e) => setParts((arr) => arr.map((x, j) => j === i ? { ...x, category_id: e.target.value } : x))}
                className="rounded-md border border-border bg-input px-2 py-2 text-sm flex-1 min-w-[160px]"
              >
                <option value="">— categoria —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>
                ))}
              </select>
              <Input
                placeholder="Notas"
                value={p.notes}
                onChange={(e) => setParts((arr) => arr.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                className="flex-1 min-w-[120px]"
              />
              {parts.length > 2 && (
                <button onClick={() => setParts((arr) => arr.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setParts((arr) => [...arr, { amount: diff.toFixed(2), category_id: "", notes: "" }])}>
            <Plus className="h-3 w-3 mr-1" /> Adicionar parte
          </Button>
        </div>
        <div className={`text-sm tabular-nums ${Math.abs(diff) < 0.01 ? "text-success" : "text-destructive"}`}>
          Soma: {sum.toFixed(2)} · Diferença: {diff.toFixed(2)}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={Math.abs(diff) >= 0.01 || m.isPending}>
            Dividir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagsDialog({ tx, onClose }: { tx: any; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>(tx.tags ?? []);
  const [input, setInput] = useState("");
  const update = useServerFn(updateTxTags);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => update({ data: { id: tx.id, tags } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tx"] });
      qc.invalidateQueries({ queryKey: ["tx-tags"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const add = () => {
    const v = input.trim().replace(/^#/, "");
    if (!v || tags.includes(v)) return;
    setTags([...tags, v]);
    setInput("");
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tags · {tx.merchant}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1">
              #{t}
              <button onClick={() => setTags((arr) => arr.filter((x) => x !== t))}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          {tags.length === 0 && <div className="text-xs text-muted-foreground">Nenhuma tag</div>}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="nova tag (ex: viagem, reembolsável)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <Button variant="outline" onClick={add}>Adicionar</Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== EXTRATO ===================

type Granularity = "daily" | "weekly" | "monthly";
type Preset = "this_month" | "last_month" | "last_7" | "last_30" | "last_90" | "ytd" | "custom";

function presetRange(p: Preset): { from: string; to: string } {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (p === "this_month") {
    const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const e = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    return { from: fmt(s), to: fmt(e) };
  }
  if (p === "last_month") {
    const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const e = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { from: fmt(s), to: fmt(e) };
  }
  if (p === "last_7") return { from: fmt(new Date(today.getTime() - 6 * 86400000)), to: todayStr };
  if (p === "last_30") return { from: fmt(new Date(today.getTime() - 29 * 86400000)), to: todayStr };
  if (p === "last_90") return { from: fmt(new Date(today.getTime() - 89 * 86400000)), to: todayStr };
  if (p === "ytd") return { from: `${today.getUTCFullYear()}-01-01`, to: todayStr };
  return { from: fmt(new Date(today.getTime() - 29 * 86400000)), to: todayStr };
}

function TxLedgerView() {
  const [preset, setPreset] = useState<Preset>("this_month");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [accountId, setAccountId] = useState<string>("");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { from, to } = useMemo(() => {
    if (preset === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const fetchLedger = useServerFn(getLedgerView);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", from, to, granularity, accountId],
    queryFn: () => fetchLedger({ data: {
      from, to, granularity, accountId: accountId || null,
    } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
          <option value="this_month">Este mês</option>
          <option value="last_month">Mês anterior</option>
          <option value="last_7">Últimos 7 dias</option>
          <option value="last_30">Últimos 30 dias</option>
          <option value="last_90">Últimos 90 dias</option>
          <option value="ytd">Ano até hoje</option>
          <option value="custom">Customizado</option>
        </select>
        {preset === "custom" && (
          <>
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
          </>
        )}
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
            <button key={g} onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 ${granularity === g ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
              {g === "daily" ? "Diário" : g === "weekly" ? "Semanal" : "Mensal"}
            </button>
          ))}
        </div>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
          <option value="">Todas as contas (USD)</option>
          {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {data && (
        <div className="grid sm:grid-cols-4 gap-3">
          <Stat label="Saldo inicial" value={formatCurrency(data.opening, data.currency)} />
          <Stat label="Entradas" value={formatCurrency(data.periods.reduce((s, p) => s + p.income, 0), data.currency)} accent="text-success" />
          <Stat label="Saídas" value={formatCurrency(data.periods.reduce((s, p) => s + p.expense, 0), data.currency)} accent="text-destructive" />
          <Stat label="Saldo final" value={formatCurrency(data.closing, data.currency)} accent={data.closing >= 0 ? "text-success" : "text-destructive"} />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Período</th>
              <th className="text-right px-3 py-2">#</th>
              <th className="text-right px-3 py-2">Entradas</th>
              <th className="text-right px-3 py-2">Saídas</th>
              <th className="text-right px-3 py-2">Saldo</th>
              <th className="text-right px-3 py-2">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {data && (
              <tr className="border-t border-border bg-secondary/10 text-xs">
                <td className="px-3 py-2 italic text-muted-foreground" colSpan={5}>Saldo inicial em {from}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(data.opening, data.currency)}</td>
              </tr>
            )}
            {data?.periods.map((p) => {
              const isOpen = !!expanded[p.key];
              return (
                <FragmentLedger key={p.key} period={p} isOpen={isOpen}
                  onToggle={() => setExpanded((s) => ({ ...s, [p.key]: !s[p.key] }))}
                  currency={data.currency}
                  accounts={data.accounts}
                />
              );
            })}
            {data && data.periods.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">Nenhum lançamento neste período.</td></tr>
            )}
          </tbody>
        </table>
        {isLoading && <div className="p-4 text-center text-xs text-muted-foreground">Carregando…</div>}
      </div>
    </div>
  );
}

function FragmentLedger({ period, isOpen, onToggle, currency, accounts }: {
  period: any; isOpen: boolean; onToggle: () => void; currency: string; accounts: any[];
}) {
  return (
    <>
      <tr className="border-t border-border hover:bg-secondary/20 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2 font-medium">
          <button className="inline-flex items-center gap-1.5">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            {period.label}
          </button>
        </td>
        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{period.count}</td>
        <td className="px-3 py-2 text-right tabular-nums text-success">{period.income > 0 ? formatCurrency(period.income, currency) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums text-destructive">{period.expense > 0 ? formatCurrency(period.expense, currency) : "—"}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${period.net >= 0 ? "text-success" : "text-destructive"}`}>
          {formatCurrency(period.net, currency)}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums font-medium ${period.balance >= 0 ? "" : "text-destructive"}`}>
          {formatCurrency(period.balance, currency)}
        </td>
      </tr>
      {isOpen && period.transactions.map((t: any) => {
        const acc = accounts.find((a: any) => a.id === t.account_id);
        return (
          <tr key={t.id} className="border-t border-border/40 bg-secondary/5 text-xs">
            <td className="px-3 py-1.5 pl-8 text-muted-foreground whitespace-nowrap">{formatDate(t.date)}</td>
            <td className="px-3 py-1.5" colSpan={2}>
              <span className="font-medium">{t.merchant}</span>
              {acc && <span className="ml-2 text-muted-foreground">· {acc.name}</span>}
            </td>
            <td className="px-3 py-1.5" />
            <td className={`px-3 py-1.5 text-right tabular-nums ${Number(t.amount) < 0 ? "text-destructive" : "text-success"}`}>
              {formatCurrency(Number(t.amount), currency)}
            </td>
            <td className="px-3 py-1.5" />
          </tr>
        );
      })}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}