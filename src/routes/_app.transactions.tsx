import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTransactions, updateTxCategory, bulkUpdateTxCategory } from "@/lib/finance.functions";
import { splitTransaction, unsplitTransaction, updateTxTags, listAllTags } from "@/lib/splits.functions";
import { getLedgerView } from "@/lib/ledger.functions";
import { formatCurrency, formatDate } from "@/lib/format";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Split, Tag as TagIcon, X, Undo2, Plus, Trash2, ChevronLeft, ChevronRight as ChevronRightIcon, CheckSquare } from "lucide-react";
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string>("");
  const fetchTx = useServerFn(listTransactions);
  const updateCat = useServerFn(updateTxCategory);
  const bulkUpdate = useServerFn(bulkUpdateTxCategory);
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
  const mBulk = useMutation({
    mutationFn: (categoryId: string | null) => bulkUpdate({ data: { ids: Array.from(selected), categoryId } }),
    onSuccess: (r) => {
      toast.success(`${r.updated} lançamentos atualizados`);
      setSelected(new Set());
      setBulkCat("");
      qc.invalidateQueries({ queryKey: ["tx"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const txList = data?.transactions ?? [];
  const allSelected = txList.length > 0 && txList.every((t) => selected.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(txList.map((t) => t.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

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

      {selected.size > 0 && (
        <div className="sticky top-14 z-20 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 flex flex-wrap items-center gap-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{selected.size} selecionado{selected.size === 1 ? "" : "s"}</span>
          <span className="text-xs text-muted-foreground mx-1">·</span>
          <span className="text-xs text-muted-foreground">Alterar categoria para:</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded-md border border-border bg-input px-2 py-1 text-sm">
            <option value="">— escolha —</option>
            <option value="__none__">Sem categoria</option>
            {data?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>
            ))}
          </select>
          <Button size="sm" disabled={!bulkCat || mBulk.isPending}
            onClick={() => mBulk.mutate(bulkCat === "__none__" ? null : bulkCat)}>
            Aplicar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todos" />
              </th>
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
              const isSel = selected.has(t.id);
              return (
                <tr key={t.id} className={`border-t border-border hover:bg-secondary/20 ${isSel ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={isSel} onChange={() => toggleOne(t.id)} aria-label="Selecionar" />
                  </td>
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

function monthRange(year: number, month0: number) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const s = new Date(Date.UTC(year, month0, 1));
  const e = new Date(Date.UTC(year, month0 + 1, 0));
  return { from: fmt(s), to: fmt(e) };
}

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function bucketLabelFor(dateStr: string, gran: Granularity): { key: string; label: string } {
  const d = new Date(dateStr + "T00:00:00Z");
  if (gran === "daily") {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return { key: dateStr, label: `${dd}/${mm}` };
  }
  if (gran === "weekly") {
    const diff = (d.getUTCDay() + 6) % 7;
    const s = new Date(d); s.setUTCDate(s.getUTCDate() - diff);
    const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
    const key = s.toISOString().slice(0, 10);
    return { key, label: `${String(s.getUTCDate()).padStart(2, "0")}/${String(s.getUTCMonth() + 1).padStart(2, "0")} – ${String(e.getUTCDate()).padStart(2, "0")}/${String(e.getUTCMonth() + 1).padStart(2, "0")}` };
  }
  const key = dateStr.slice(0, 7);
  return { key, label: `${MONTH_NAMES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}` };
}

function TxLedgerView() {
  const today = new Date();
  const [year, setYear] = useState<number>(today.getUTCFullYear());
  const [month, setMonth] = useState<number>(today.getUTCMonth()); // 0-11
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [accountId, setAccountId] = useState<string>("");

  const { from, to } = useMemo(() => monthRange(year, month), [year, month]);

  const fetchLedger = useServerFn(getLedgerView);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", from, to, granularity, accountId],
    queryFn: () => fetchLedger({ data: { from, to, granularity, accountId: accountId || null } }),
  });

  const stepMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth());
  };
  const monthLabel = `${MONTH_NAMES[month]} ${year}`;

  // Group flat entries by bucket for visual section headers
  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; entries: any[]; subtotal: number }>;
    const map = new Map<string, { key: string; label: string; entries: any[]; subtotal: number }>();
    const order: string[] = [];
    for (const e of data.entries) {
      const b = bucketLabelFor(e.date, granularity);
      let g = map.get(b.key);
      if (!g) { g = { key: b.key, label: b.label, entries: [], subtotal: 0 }; map.set(b.key, g); order.push(b.key); }
      g.entries.push(e);
      g.subtotal += Number(e.amount);
    }
    return order.map((k) => map.get(k)!);
  }, [data, granularity]);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      {/* Sidebar */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Conta</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
              <option value="">Todas as contas (USD)</option>
              {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => stepMonth(-1)} className="p-2 rounded-md hover:bg-secondary/40" title="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-medium capitalize">{monthLabel}</div>
            <button onClick={() => stepMonth(1)} className="p-2 rounded-md hover:bg-secondary/40" title="Próximo mês">
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Visão</label>
            <div className="mt-1 inline-flex rounded-md border border-border overflow-hidden text-xs w-full">
              {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
                <button key={g} onClick={() => setGranularity(g)}
                  className={`flex-1 px-2 py-1.5 ${granularity === g ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
                  {g === "daily" ? "Diário" : g === "weekly" ? "Semanal" : "Mensal"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="text-center text-xs uppercase tracking-widest text-muted-foreground py-2 border-b border-border bg-secondary/30">
              Situação projetada
            </div>
            <SidebarLine label="Saldo anterior" value={data.opening} currency={data.currency} />
            <SidebarLine label="Receitas" value={data.totals.income} currency={data.currency} positive />
            <SidebarLine label="Transferências de entrada" value={data.totals.transferIn} currency={data.currency} positive />
            <SidebarLine label="Despesas" value={-data.totals.expense} currency={data.currency} negative />
            <SidebarLine label="Transferências de saída" value={-data.totals.transferOut} currency={data.currency} negative />
            {((data.totals as any).projectedIncome > 0 || (data.totals as any).projectedExpense > 0) && (
              <>
                <SidebarLine label="Receitas previstas" value={(data.totals as any).projectedIncome ?? 0} currency={data.currency} positive />
                <SidebarLine label="Despesas previstas" value={-((data.totals as any).projectedExpense ?? 0)} currency={data.currency} negative />
              </>
            )}
            <SidebarLine label="Resultado" value={data.totals.net} currency={data.currency} bold accent={data.totals.net >= 0 ? "positive" : "negative"} />
            <SidebarLine label="Saldo final" value={data.closing} currency={data.currency} bold accent={data.closing >= 0 ? "positive" : "negative"} />
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-3 text-xs space-y-1.5">
          <div className="uppercase tracking-widest text-muted-foreground text-[10px] mb-1">Legenda</div>
          <LegendDot color="bg-emerald-500" label="Confirmado" />
          <LegendDot color="bg-amber-400" label="Agendado" />
          <LegendDot color="bg-rose-500" label="Pendente" />
          <LegendDot color="bg-sky-500" label="Projetado (orçamento / fatura)" />
        </div>
      </div>

      {/* Main extract */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="bg-secondary/30 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground grid grid-cols-[80px_1fr_140px_160px] gap-3">
          <div>Data</div>
          <div>Lançamento</div>
          <div className="text-right">Valor</div>
          <div className="text-right">Saldo acumulado</div>
        </div>

        {/* Opening row */}
        {data && (
          <div className="grid grid-cols-[80px_1fr_140px_160px] gap-3 px-4 py-2 border-b border-border text-sm bg-secondary/10">
            <div className="text-muted-foreground">{from.slice(8, 10)}/{from.slice(5, 7)}</div>
            <div className="italic text-muted-foreground">Saldo anterior</div>
            <div />
            <div className={`text-right tabular-nums font-medium ${data.opening >= 0 ? "" : "text-destructive"}`}>
              {formatCurrency(data.opening, data.currency)}
            </div>
          </div>
        )}

        {grouped.map((g) => (
          <div key={g.key}>
            {granularity !== "daily" ? (
              // Aggregated single row per bucket
              <div className="grid grid-cols-[80px_1fr_140px_160px] gap-3 px-4 py-2.5 border-b border-border hover:bg-secondary/20 text-sm">
                <div className="text-muted-foreground whitespace-nowrap">{g.label}</div>
                <div className="min-w-0">
                  <div className="font-medium">
                    {granularity === "weekly" ? "Semana" : "Mês"} · {g.entries.length} {g.entries.length === 1 ? "lançamento" : "lançamentos"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Entradas {formatCurrency(g.entries.filter((e: any) => Number(e.amount) > 0).reduce((s: number, e: any) => s + Number(e.amount), 0), data!.currency)}
                    {" · "}
                    Saídas {formatCurrency(Math.abs(g.entries.filter((e: any) => Number(e.amount) < 0).reduce((s: number, e: any) => s + Number(e.amount), 0)), data!.currency)}
                  </div>
                </div>
                <div className={`text-right tabular-nums self-center font-medium ${g.subtotal >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(g.subtotal, data!.currency)}
                </div>
                <div className={`text-right tabular-nums self-center font-medium ${Number(g.entries[g.entries.length - 1]?.balance ?? 0) < 0 ? "text-destructive" : ""}`}>
                  {formatCurrency(Number(g.entries[g.entries.length - 1]?.balance ?? 0), data!.currency)}
                </div>
              </div>
            ) : (
              g.entries.map((t) => {
              const acc = data?.accounts.find((a) => a.id === t.account_id);
              const status = (t.status ?? "confirmed") as "confirmed" | "scheduled" | "pending" | "projected";
              const dotColor = t.is_transfer
                ? "bg-amber-500"
                : status === "confirmed"
                  ? (Number(t.amount) >= 0 ? "bg-emerald-500" : "bg-emerald-500")
                  : status === "scheduled"
                    ? "bg-amber-400"
                    : status === "pending"
                      ? "bg-rose-500"
                      : "bg-sky-500";
              const isProjected = t.source && t.source !== "real";
              return (
                <div key={t.id} className={`grid grid-cols-[80px_1fr_140px_160px] gap-3 px-4 py-2 border-b border-border/60 hover:bg-secondary/20 text-sm ${isProjected ? "bg-secondary/5" : ""}`}>
                  <div className="text-muted-foreground whitespace-nowrap">{t.date.slice(8, 10)}/{t.date.slice(5, 7)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${dotColor}`} title={status} />
                      <span className={`font-medium truncate ${isProjected ? "italic text-muted-foreground" : ""}`}>{t.merchant}</span>
                      {t.is_transfer && <Badge variant="outline" className="text-[10px]">transf.</Badge>}
                      {t.source === "recurrence" && <Badge variant="outline" className="text-[10px]">recorrente</Badge>}
                      {t.source === "budget" && <Badge variant="outline" className="text-[10px]">orçado</Badge>}
                      {t.source === "cc_invoice" && <Badge variant="outline" className="text-[10px]">fatura</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground pl-4">
                      {t.category_name ?? "Sem categoria"}{acc ? ` · ${acc.name}` : ""}
                    </div>
                  </div>
                  <div className={`text-right tabular-nums self-center ${isProjected ? "opacity-70" : ""} ${Number(t.amount) < 0 ? "text-destructive" : "text-success"}`}>
                    {formatCurrency(Number(t.amount), data!.currency)}
                  </div>
                  <div className={`text-right tabular-nums self-center font-medium ${Number(t.balance) < 0 ? "text-destructive" : ""}`}>
                    {formatCurrency(Number(t.balance), data!.currency)}
                  </div>
                </div>
              );
              })
            )}
          </div>
        ))}

        {data && data.entries.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum lançamento neste período.</div>
        )}
        {isLoading && <div className="p-4 text-center text-xs text-muted-foreground">Carregando…</div>}

        {/* Closing row */}
        {data && data.entries.length > 0 && (
          <div className="grid grid-cols-[80px_1fr_140px_160px] gap-3 px-4 py-2.5 bg-secondary/20 text-sm font-medium">
            <div className="text-muted-foreground">{to.slice(8, 10)}/{to.slice(5, 7)}</div>
            <div>Saldo final</div>
            <div />
            <div className={`text-right tabular-nums ${data.closing >= 0 ? "" : "text-destructive"}`}>
              {formatCurrency(data.closing, data.currency)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarLine({ label, value, currency, positive, negative, bold, accent }: {
  label: string; value: number; currency: string;
  positive?: boolean; negative?: boolean; bold?: boolean;
  accent?: "positive" | "negative";
}) {
  const cls = accent === "positive" ? "text-success" : accent === "negative" ? "text-destructive"
    : positive ? "text-success" : negative ? "text-destructive" : "";
  return (
    <div className={`flex items-center justify-between px-4 py-1.5 text-sm border-b border-border/60 last:border-b-0 ${bold ? "font-semibold bg-secondary/10" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${cls}`}>{formatCurrency(value, currency)}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}