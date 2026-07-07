import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTransactions, updateTxCategory, bulkUpdateTxCategory, bulkUpdateTxAccount, createTransaction, createTransfer, updateTransaction, deleteTransaction } from "@/lib/finance.functions";
import { splitTransaction, unsplitTransaction, updateTxTags, listAllTags } from "@/lib/splits.functions";
import { getLedgerView } from "@/lib/ledger.functions";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayStr, todayUTCDate } from "@/lib/dates";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Split, Tag as TagIcon, X, Undo2, Plus, Trash2, ChevronLeft, ChevronRight as ChevronRightIcon, CheckSquare } from "lucide-react";
import { Label } from "@/components/ui/label";
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
  const [editTx, setEditTx] = useState<any | null>(null);
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
                    <button onClick={() => setEditTx(t)} className="text-left hover:text-primary hover:underline">
                      {t.merchant}
                    </button>
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
      {editTx && (
        <EditTransactionDialog tx={editTx} accounts={data?.accounts ?? []} categories={data?.categories ?? []} onClose={() => setEditTx(null)} />
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

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const fmtISO = (d: Date) => d.toISOString().slice(0, 10);

function periodRange(anchor: Date, gran: Granularity): { from: string; to: string; label: string } {
  const a = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  if (gran === "daily") {
    return {
      from: fmtISO(a),
      to: fmtISO(a),
      label: `${DAY_NAMES[a.getUTCDay()]}, ${String(a.getUTCDate()).padStart(2, "0")} ${MONTH_NAMES[a.getUTCMonth()]} ${a.getUTCFullYear()}`,
    };
  }
  if (gran === "weekly") {
    const diff = (a.getUTCDay() + 6) % 7;
    const s = new Date(a); s.setUTCDate(s.getUTCDate() - diff);
    const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
    return {
      from: fmtISO(s),
      to: fmtISO(e),
      label: `${String(s.getUTCDate()).padStart(2, "0")} ${MONTH_NAMES[s.getUTCMonth()]} – ${String(e.getUTCDate()).padStart(2, "0")} ${MONTH_NAMES[e.getUTCMonth()]} ${e.getUTCFullYear()}`,
    };
  }
  const s = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const e = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
  return { from: fmtISO(s), to: fmtISO(e), label: `${MONTH_NAMES[a.getUTCMonth()]} ${a.getUTCFullYear()}` };
}

function stepAnchor(anchor: Date, gran: Granularity, delta: number): Date {
  const d = new Date(anchor);
  if (gran === "daily") d.setUTCDate(d.getUTCDate() + delta);
  else if (gran === "weekly") d.setUTCDate(d.getUTCDate() + 7 * delta);
  else d.setUTCMonth(d.getUTCMonth() + delta);
  return d;
}

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
  const [anchor, setAnchor] = useState<Date>(() => todayUTCDate());
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [accountId, setAccountId] = useState<string>("");
  const [newTxOpen, setNewTxOpen] = useState(false);
  const [ledgerSelected, setLedgerSelected] = useState<Set<string>>(new Set());
  const [editTx, setEditTx] = useState<any | null>(null);
  const [ledgerBulkCat, setLedgerBulkCat] = useState<string>("");
  const qc = useQueryClient();
  const bulkUpdate = useServerFn(bulkUpdateTxCategory);
  const bulkAcct = useServerFn(bulkUpdateTxAccount);
  const delTx = useServerFn(deleteTransaction);
  const [ledgerBulkAcct, setLedgerBulkAcct] = useState<string>("");
  const mLedgerBulk = useMutation({
    mutationFn: (categoryId: string | null) => bulkUpdate({ data: { ids: Array.from(ledgerSelected), categoryId } }),
    onSuccess: (r) => {
      toast.success(`${r.updated} atualizados`);
      setLedgerSelected(new Set()); setLedgerBulkCat("");
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["tx"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const mLedgerAcct = useMutation({
    mutationFn: (accountId: string) => bulkAcct({ data: { ids: Array.from(ledgerSelected), accountId } }),
    onSuccess: (r) => {
      toast.success(`${r.updated} movidos`);
      setLedgerSelected(new Set()); setLedgerBulkAcct("");
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["tx"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const mLedgerDel = useMutation({
    mutationFn: async () => {
      for (const id of ledgerSelected) await delTx({ data: { id } });
      return { deleted: ledgerSelected.size };
    },
    onSuccess: (r) => {
      toast.success(`${r.deleted} excluídos`);
      setLedgerSelected(new Set());
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["tx"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { from, to, label: periodLabel } = useMemo(
    () => periodRange(anchor, granularity),
    [anchor, granularity],
  );

  const fetchLedger = useServerFn(getLedgerView);
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", from, to, granularity, accountId],
    queryFn: () => fetchLedger({ data: { from, to, granularity, accountId: accountId || null } }),
  });

  const step = (delta: number) => setAnchor((a) => stepAnchor(a, granularity, delta));
  const goToday = () => setAnchor(todayUTCDate());
  const navTitle =
    granularity === "daily" ? "Dia anterior / próximo"
    : granularity === "weekly" ? "Semana anterior / próxima"
    : "Mês anterior / próximo";

  // Group flat entries by DAY for visual section headers (always per-day inside the period)
  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; entries: any[]; subtotal: number }>;
    const map = new Map<string, { key: string; label: string; entries: any[]; subtotal: number }>();
    const order: string[] = [];
    for (const e of data.entries) {
      const b = bucketLabelFor(e.date, "daily");
      let g = map.get(b.key);
      if (!g) { g = { key: b.key, label: b.label, entries: [], subtotal: 0 }; map.set(b.key, g); order.push(b.key); }
      g.entries.push(e);
      g.subtotal += Number(e.amount);
    }
    return order.map((k) => map.get(k)!);
  }, [data]);

  // Only "real" entries (have a uuid id, not projection) can be selected/edited
  const realIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of grouped) for (const e of g.entries) {
      if (!e.source || e.source === "real") ids.push(e.id);
    }
    return ids;
  }, [grouped]);
  const allLedgerSelected = realIds.length > 0 && realIds.every((id) => ledgerSelected.has(id));
  const toggleAllLedger = () => {
    if (allLedgerSelected) setLedgerSelected(new Set());
    else setLedgerSelected(new Set(realIds));
  };
  const toggleOneLedger = (id: string) => {
    setLedgerSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

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
          <div>
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => step(-1)} className="p-2 rounded-md hover:bg-secondary/40" title={navTitle}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-medium capitalize text-center flex-1">{periodLabel}</div>
              <button onClick={() => step(1)} className="p-2 rounded-md hover:bg-secondary/40" title={navTitle}>
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
            <button onClick={goToday} className="mt-1 w-full text-xs text-muted-foreground hover:text-foreground py-1 rounded hover:bg-secondary/40">
              Hoje
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
          <Button className="w-full" onClick={() => setNewTxOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova transação
          </Button>
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
        {ledgerSelected.size > 0 && (
          <div className="px-4 py-2 bg-primary/5 border-b border-primary/30 flex flex-wrap items-center gap-2">
            <CheckSquare className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{ledgerSelected.size} selecionada(s)</span>
            <span className="text-xs text-muted-foreground mx-1">·</span>
            <span className="text-xs text-muted-foreground">Categoria:</span>
            <select value={ledgerBulkCat} onChange={(e) => setLedgerBulkCat(e.target.value)}
              className="rounded-md border border-border bg-input px-2 py-1 text-sm">
              <option value="">— escolha —</option>
              <option value="__none__">Sem categoria</option>
              {data?.categories?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>
              ))}
            </select>
            <Button size="sm" disabled={!ledgerBulkCat || mLedgerBulk.isPending}
              onClick={() => mLedgerBulk.mutate(ledgerBulkCat === "__none__" ? null : ledgerBulkCat)}>
              Aplicar
            </Button>
            <span className="text-xs text-muted-foreground mx-1">·</span>
            <span className="text-xs text-muted-foreground">Conta:</span>
            <select value={ledgerBulkAcct} onChange={(e) => setLedgerBulkAcct(e.target.value)}
              className="rounded-md border border-border bg-input px-2 py-1 text-sm">
              <option value="">— escolha —</option>
              {data?.accounts?.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <Button size="sm" disabled={!ledgerBulkAcct || mLedgerAcct.isPending}
              onClick={() => mLedgerAcct.mutate(ledgerBulkAcct)}>
              Mover
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive ml-auto"
              onClick={() => { if (confirm(`Excluir ${ledgerSelected.size} transação(ões)?`)) mLedgerDel.mutate(); }}>
              Excluir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLedgerSelected(new Set())}>Limpar</Button>
          </div>
        )}
        <div className="bg-secondary/30 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground grid grid-cols-[32px_80px_1fr_140px_160px] gap-3">
          <div>
            <input type="checkbox" checked={allLedgerSelected} onChange={toggleAllLedger} aria-label="Selecionar todos" disabled={realIds.length === 0} />
          </div>
          <div>Data</div>
          <div>Lançamento</div>
          <div className="text-right">Valor</div>
          <div className="text-right">Saldo acumulado</div>
        </div>

        {/* Opening row */}
        {data && (
          <div className="grid grid-cols-[32px_80px_1fr_140px_160px] gap-3 px-4 py-2 border-b border-border text-sm bg-secondary/10">
            <div />
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
            {g.entries.map((t) => {
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
              const isSel = ledgerSelected.has(t.id);
              return (
                <div key={t.id} className={`grid grid-cols-[32px_80px_1fr_140px_160px] gap-3 px-4 py-2 border-b border-border/60 hover:bg-secondary/20 text-sm ${isProjected ? "bg-secondary/5" : ""} ${isSel ? "bg-primary/5" : ""}`}>
                  <div className="self-center">
                    {!isProjected && (
                      <input type="checkbox" checked={isSel} onChange={() => toggleOneLedger(t.id)} aria-label="Selecionar" />
                    )}
                  </div>
                  <div className="text-muted-foreground whitespace-nowrap">{t.date.slice(8, 10)}/{t.date.slice(5, 7)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${dotColor}`} title={status} />
                      {isProjected ? (
                        <span className="font-medium truncate italic text-muted-foreground">{t.merchant}</span>
                      ) : (
                        <button onClick={() => setEditTx(t)} className="font-medium truncate text-left hover:text-primary hover:underline">{t.merchant}</button>
                      )}
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
                    {formatCurrency(Number(t.amount_native ?? t.amount), (t.currency_native ?? data!.currency) as string)}
                  </div>
                  <div className={`text-right tabular-nums self-center font-medium ${Number(t.balance) < 0 ? "text-destructive" : ""}`}>
                    {formatCurrency(Number(t.balance), data!.currency)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {data && data.entries.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum lançamento neste período.</div>
        )}
        {isLoading && <div className="p-4 text-center text-xs text-muted-foreground">Carregando…</div>}

        {/* Closing row */}
        {data && data.entries.length > 0 && (
          <div className="grid grid-cols-[32px_80px_1fr_140px_160px] gap-3 px-4 py-2.5 bg-secondary/20 text-sm font-medium">
            <div />
            <div className="text-muted-foreground">{to.slice(8, 10)}/{to.slice(5, 7)}</div>
            <div>Saldo final</div>
            <div />
            <div className={`text-right tabular-nums ${data.closing >= 0 ? "" : "text-destructive"}`}>
              {formatCurrency(data.closing, data.currency)}
            </div>
          </div>
        )}
      </div>
      {newTxOpen && (
        <NewTransactionDialog
          accounts={data?.accounts ?? []}
          categories={(data?.categories as any) ?? []}
          defaultAccountId={accountId || (data?.accounts?.[0]?.id ?? "")}
          onClose={() => setNewTxOpen(false)}
        />
      )}
      {editTx && (
        <EditTransactionDialog
          tx={editTx}
          accounts={data?.accounts ?? []}
          categories={(data?.categories as any) ?? []}
          onClose={() => setEditTx(null)}
        />
      )}
    </div>
  );
}

function NewTransactionDialog({ accounts, categories, defaultAccountId, onClose }: {
  accounts: any[]; categories: any[]; defaultAccountId: string; onClose: () => void;
}) {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [toAccountId, setToAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState("");
  const [currency, setCurrency] = useState<"USD" | "BRL">("USD");
  const [notes, setNotes] = useState("");
  const [amountTo, setAmountTo] = useState("");
  const create = useServerFn(createTransaction);
  const transfer = useServerFn(createTransfer);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => {
      const raw = Number(amount);
      if (!raw || Number.isNaN(raw)) throw new Error("Valor inválido");
      if (kind === "transfer") {
        if (!toAccountId) throw new Error("Selecione a conta de destino");
        if (toAccountId === accountId) throw new Error("Contas devem ser diferentes");
        const toRaw = Number(amountTo);
        return transfer({ data: {
          date, from_account_id: accountId, to_account_id: toAccountId,
          amount: Math.abs(raw),
          amount_to: amountTo && !Number.isNaN(toRaw) ? Math.abs(toRaw) : undefined,
          notes: notes || null,
        }});
      }
      const signed = kind === "expense" ? -Math.abs(raw) : Math.abs(raw);
      return create({ data: {
        date, merchant, amount: signed, currency,
        account_id: accountId, category_id: categoryId || null,
        notes: notes || null, is_transfer: false, is_pending: false,
      }});
    },
    onSuccess: () => {
      toast.success("Transação criada");
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["tx"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const isTransfer = kind === "transfer";
  const fromAcc = accounts.find((a: any) => a.id === accountId);
  const toAcc = accounts.find((a: any) => a.id === toAccountId);
  const fromCur = (fromAcc?.currency as string) ?? "USD";
  const toCur = (toAcc?.currency as string) ?? "USD";
  const crossCurrency = isTransfer && !!toAcc && fromCur !== toCur;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova transação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="inline-flex rounded-md border border-border overflow-hidden text-sm w-full">
            <button type="button" onClick={() => setKind("expense")}
              className={`flex-1 px-3 py-1.5 ${kind === "expense" ? "bg-destructive text-destructive-foreground" : "bg-card hover:bg-secondary/40"}`}>
              Despesa
            </button>
            <button type="button" onClick={() => setKind("income")}
              className={`flex-1 px-3 py-1.5 ${kind === "income" ? "bg-success text-success-foreground" : "bg-card hover:bg-secondary/40"}`}>
              Receita
            </button>
            <button type="button" onClick={() => setKind("transfer")}
              className={`flex-1 px-3 py-1.5 ${kind === "transfer" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
              Transferência
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{isTransfer ? `Valor (${fromCur})` : "Valor"}</Label>
              <MoneyInput
                size="lg" showStepper step={10}
                currency={isTransfer ? fromCur : currency}
                value={amount}
                onValueChange={(n) => setAmount(n == null ? "" : String(n))}
                autoFocus
              />
            </div>
          </div>
          {!isTransfer && (
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Ex: Aluguel, Supermercado…" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{isTransfer ? "De (origem)" : "Conta"}</Label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {isTransfer ? (
              <div>
                <Label className="text-xs">Para (destino)</Label>
                <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                  <option value="">— escolha —</option>
                  {accounts.filter((a: any) => a.id !== accountId).map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <Label className="text-xs">Moeda</Label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                  <option value="USD">USD</option>
                  <option value="BRL">BRL</option>
                </select>
              </div>
            )}
          </div>
          {crossCurrency && (
            <div>
              <Label className="text-xs">Valor recebido ({toCur}) — opcional</Label>
              <MoneyInput
                currency={toCur}
                value={amountTo}
                onValueChange={(n) => setAmountTo(n == null ? "" : String(n))}
                placeholder="Auto"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Conversão automática usa a taxa USD/BRL do dia. Para datas futuras, usamos a taxa mais recente disponível como projeção.
              </p>
            </div>
          )}
          {!isTransfer && (
            <div>
              <Label className="text-xs">Categoria</Label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="">— sem categoria —</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações" />
          </div>
          <p className="text-xs text-muted-foreground">
            {isTransfer
              ? "Cria dois lançamentos vinculados: saída na origem (na moeda da conta de origem) e entrada no destino (na moeda da conta de destino), convertidos via FX quando as moedas diferem."
              : "Você pode usar uma data futura para registrar uma transação agendada, ou uma data passada para registrar algo que esqueceu."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => m.mutate()}
            disabled={m.isPending || !amount || !accountId || (isTransfer ? !toAccountId : !merchant)}>
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTransactionDialog({ tx, accounts, categories, onClose }: {
  tx: any; accounts: any[]; categories: any[]; onClose: () => void;
}) {
  const stored = Number(tx.amount);
  const [date, setDate] = useState<string>((tx.date as string).slice(0, 10));
  const [merchant, setMerchant] = useState<string>(tx.merchant ?? "");
  const [kind, setKind] = useState<"expense" | "income">(stored < 0 ? "expense" : "income");
  const [amount, setAmount] = useState<string>(String(Math.abs(stored)));
  const [accountId, setAccountId] = useState<string>(tx.account_id ?? "");
  const [categoryId, setCategoryId] = useState<string>(tx.category_id ?? "");
  const [currency, setCurrency] = useState<"USD" | "BRL">(((tx.currency as string) === "BRL" ? "BRL" : "USD"));
  const [notes, setNotes] = useState<string>(tx.notes ?? "");
  const [isPending, setIsPending] = useState<boolean>(!!tx.is_pending);
  const isTransfer = !!tx.is_transfer;
  const update = useServerFn(updateTransaction);
  const del = useServerFn(deleteTransaction);
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ledger"] });
    qc.invalidateQueries({ queryKey: ["tx"] });
    qc.invalidateQueries({ queryKey: ["tx-tags"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };
  const mSave = useMutation({
    mutationFn: () => {
      const raw = Number(amount);
      if (!raw || Number.isNaN(raw)) throw new Error("Valor inválido");
      const signed = kind === "expense" ? -Math.abs(raw) : Math.abs(raw);
      return update({ data: {
        id: tx.id, date, merchant, amount: signed, currency,
        account_id: accountId, category_id: categoryId || null,
        notes: notes || null, is_pending: isPending,
      }});
    },
    onSuccess: () => { toast.success("Transação atualizada"); invalidate(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mDelete = useMutation({
    mutationFn: () => del({ data: { id: tx.id } }),
    onSuccess: () => { toast.success("Transação excluída"); invalidate(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar transação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isTransfer && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
              Esta é uma perna de transferência. Alterar valor ou conta aqui não mexe na outra perna do par — para refazer a transferência, exclua e crie de novo.
            </div>
          )}
          <div className="inline-flex rounded-md border border-border overflow-hidden text-sm w-full">
            <button type="button" onClick={() => setKind("expense")}
              className={`flex-1 px-3 py-1.5 ${kind === "expense" ? "bg-destructive text-destructive-foreground" : "bg-card hover:bg-secondary/40"}`}>
              Despesa
            </button>
            <button type="button" onClick={() => setKind("income")}
              className={`flex-1 px-3 py-1.5 ${kind === "income" ? "bg-success text-success-foreground" : "bg-card hover:bg-secondary/40"}`}>
              Receita
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Valor</Label>
              <MoneyInput size="lg" showStepper step={10} currency={currency}
                value={amount} onValueChange={(n) => setAmount(n == null ? "" : String(n))} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Conta</Label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Moeda</Label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
                <option value="USD">USD</option>
                <option value="BRL">BRL</option>
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm">
              <option value="">— sem categoria —</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.parent_id ? "  ↳ " : ""}{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Notas</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPending} onChange={(e) => setIsPending(e.target.checked)} />
            Pendente (ainda não confirmada — fica fora dos saldos)
          </label>
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button variant="ghost" className="text-destructive"
            onClick={() => { if (confirm("Excluir esta transação?")) mDelete.mutate(); }}
            disabled={mDelete.isPending}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir
          </Button>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => mSave.mutate()} disabled={mSave.isPending || !amount || !merchant || !accountId}>
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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