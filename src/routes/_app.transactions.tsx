import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTransactions, updateTxCategory } from "@/lib/finance.functions";
import { formatCurrency, formatDate } from "@/lib/format";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/transactions")({ component: TxPage });

function TxPage() {
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const fetchTx = useServerFn(listTransactions);
  const updateCat = useServerFn(updateTxCategory);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["tx", search, accountId],
    queryFn: () => fetchTx({ data: { limit: 300, search: search || undefined, accountId: accountId || undefined } }),
  });
  const mUpdate = useMutation({
    mutationFn: (v: { id: string; categoryId: string | null }) => updateCat({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tx"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Transações</h1>
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
          <option value="">Todas contas</option>
          {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Merchant</th>
              <th className="text-left px-3 py-2">Categoria</th>
              <th className="text-left px-3 py-2">Conta</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-right px-3 py-2">USD</th>
            </tr>
          </thead>
          <tbody>
            {data?.transactions.map((t) => {
              const acc = data.accounts.find((a) => a.id === t.account_id);
              return (
                <tr key={t.id} className="border-t border-border hover:bg-secondary/20">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="px-3 py-2 font-medium">{t.merchant}</td>
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
                  <td className="px-3 py-2 text-muted-foreground">{acc?.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(t.amount), t.currency)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${Number(t.amount_usd) < 0 ? "text-destructive" : "text-success"}`}>
                    {formatCurrency(Number(t.amount_usd))}
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
    </div>
  );
}