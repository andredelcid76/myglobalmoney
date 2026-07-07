import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTransactions, importTransactions } from "@/lib/finance.functions";
import { getUsdBrlRate } from "@/lib/fx.functions";
import { applyRules } from "@/lib/rules.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NubankImport } from "@/components/import/NubankImport";

export const Route = createFileRoute("/_app/import")({ component: ImportPage });

type Row = { date: string; merchant: string; category: string; account: string; original_statement: string; notes: string; amount: number; tags: string };

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    out.push({
      date: c[idx("date")] ?? "",
      merchant: c[idx("merchant")] ?? "",
      category: c[idx("category")] ?? "",
      account: c[idx("account")] ?? "",
      original_statement: c[idx("original statement")] ?? "",
      notes: c[idx("notes")] ?? "",
      amount: Number(c[idx("amount")] ?? 0),
      tags: c[idx("tags")] ?? "",
    });
  }
  return out;
}

function ImportPage() {
  const fetchMeta = useServerFn(listTransactions);
  const importFn = useServerFn(importTransactions);
  const fxFn = useServerFn(getUsdBrlRate);
  const runRules = useServerFn(applyRules);
  const qc = useQueryClient();
  const { data: meta } = useQuery({ queryKey: ["import-meta"], queryFn: () => fetchMeta({ data: { limit: 1 } }) });
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      setRows(parsed);
      const uniq = Array.from(new Set(parsed.map((p) => p.account)));
      const init: Record<string, string> = {};
      uniq.forEach((src) => {
        const s = src.toLowerCase();
        const m = meta?.accounts.find((a) =>
          s.includes("nubank") ? a.name.toLowerCase().includes("histórico") :
          s.includes("visa") ? a.name.toLowerCase().includes("credit") :
          s.includes("principal") ? a.name.toLowerCase().includes("checking") :
          false);
        if (m) init[src] = m.id;
      });
      setMapping(init);
    };
    reader.readAsText(f);
  }

  async function runImport() {
    if (!meta) return;
    setBusy(true);
    try {
      const catByName = new Map(meta.categories.map((c) => [c.name.toLowerCase(), c.id]));
      const fxCache = new Map<string, number>();
      setProgress("Buscando cotações USD/BRL...");
      const datesBrl = new Set<string>();
      for (const r of rows) {
        const acc = meta.accounts.find((a) => a.id === mapping[r.account]);
        if (acc?.currency === "BRL") datesBrl.add(r.date);
      }
      for (const d of datesBrl) {
        try { const { rate } = await fxFn({ data: { date: d } }); fxCache.set(d, rate); }
        catch { throw new Error(`Sem cotação USD/BRL para ${d} — importação cancelada, tente novamente mais tarde`); }
      }
      // external_id determinístico: reimportar o mesmo CSV não duplica
      // (índice único no banco); #n diferencia linhas idênticas legítimas
      const seenKeys = new Map<string, number>();
      const prepared = rows
        .filter((r) => mapping[r.account])
        .map((r) => {
          const acc = meta.accounts.find((a) => a.id === mapping[r.account])!;
          let amtUsd = r.amount; let rate: number | null = null;
          if (acc.currency === "BRL") {
            const cached = fxCache.get(r.date);
            if (cached == null) throw new Error(`Sem cotação USD/BRL para ${r.date} — importação cancelada`);
            rate = cached; amtUsd = r.amount / rate;
          }
          const baseKey = `monarch:${r.date}:${r.merchant.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32)}:${Math.abs(r.amount).toFixed(2)}`;
          const n = seenKeys.get(baseKey) ?? 0;
          seenKeys.set(baseKey, n + 1);
          return {
            external_id: n === 0 ? baseKey : `${baseKey}#${n}`,
            date: r.date, merchant: r.merchant,
            original_statement: r.original_statement || null,
            notes: r.notes || null,
            amount: r.amount, currency: acc.currency,
            amount_usd: Number(amtUsd.toFixed(2)),
            exchange_rate: rate ? Number((1 / rate).toFixed(6)) : null, // convenção: moeda nativa → USD
            account_id: acc.id,
            category_id: catByName.get(r.category.toLowerCase()) ?? null,
            is_transfer: r.category.toLowerCase() === "transfer",
            tags: r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : null,
          };
        });
      setProgress(`Importando ${prepared.length}...`);
      const { inserted } = await importFn({ data: { rows: prepared } });
      toast.success(`${inserted} transações importadas!`);
      setProgress("Aplicando regras de categorização...");
      try {
        const r = await runRules({ data: { scope: "uncategorized" } });
        if (r.matched > 0) toast.success(`${r.matched} transações categorizadas automaticamente`);
      } catch { /* ignore */ }
      qc.invalidateQueries(); setRows([]);
    } catch (e: any) { toast.error(e.message ?? "Erro"); }
    finally { setBusy(false); setProgress(""); }
  }

  const uniq = Array.from(new Set(rows.map((r) => r.account)));
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar CSV</h1>
        <p className="text-sm text-muted-foreground mt-1">Importe do Monarch (multi-conta) ou direto do extrato bruto do Nubank.</p>
      </div>
      <Tabs defaultValue="nubank" className="w-full">
        <TabsList>
          <TabsTrigger value="nubank">Nubank (extrato bruto)</TabsTrigger>
          <TabsTrigger value="monarch">Monarch (multi-conta)</TabsTrigger>
        </TabsList>
        <TabsContent value="nubank" className="mt-4">
          <NubankImport />
        </TabsContent>
        <TabsContent value="monarch" className="mt-4 space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground mb-3">Formato Monarch (Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags, Owner). Cotação USD/BRL é buscada automaticamente para contas em real.</p>
        <input type="file" accept=".csv" onChange={onFile} className="text-sm" />
        {rows.length > 0 && <div className="mt-4 text-sm text-muted-foreground">{rows.length} linhas detectadas.</div>}
      </div>
      {rows.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="font-semibold">Mapear contas</h2>
          {uniq.map((src) => (
            <div key={src} className="flex items-center justify-between gap-3">
              <code className="text-xs bg-secondary px-2 py-1 rounded">{src}</code>
              <span className="text-muted-foreground">→</span>
              <select value={mapping[src] ?? ""} onChange={(e) => setMapping({ ...mapping, [src]: e.target.value })} className="rounded-md border border-border bg-input px-3 py-1.5 text-sm flex-1 max-w-xs">
                <option value="">Ignorar</option>
                {meta?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </div>
          ))}
          <Button onClick={runImport} disabled={busy} className="w-full">
            {busy ? progress || "Importando..." : `Importar ${rows.filter((r) => mapping[r.account]).length} transações`}
          </Button>
        </div>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}