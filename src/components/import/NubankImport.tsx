import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTransactions, importTransactions, listAccountTxForDedup } from "@/lib/finance.functions";
import { listRules } from "@/lib/rules.functions";
import { getUsdBrlRate } from "@/lib/fx.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type NubankRow = { date: string; title: string; amount: number };
type Category = { id: string; name: string; parent_id: string | null };
type Rule = { pattern: string; match_type: string; category_id: string; is_active: boolean; priority: number };

// Parse "6.452,19" → 6452.19, "- 11.896,47" → -11896.47
function parseBrl(s: string): number {
  const t = s.trim();
  const neg = t.startsWith("-");
  const num = t.replace(/^-\s*/, "").replace(/\./g, "").replace(",", ".");
  const v = Number(num);
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}

function parseNubankCsv(text: string): NubankRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const iDate = header.indexOf("date");
  const iTitle = header.indexOf("title");
  const iAmount = header.indexOf("amount");
  if (iDate < 0 || iTitle < 0 || iAmount < 0) throw new Error("CSV precisa ter colunas: date, title, amount");
  const out: NubankRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const amount = parseBrl(c[iAmount] ?? "");
    if (!Number.isFinite(amount)) continue;
    out.push({ date: (c[iDate] ?? "").trim(), title: (c[iTitle] ?? "").trim(), amount });
  }
  return out;
}

function normalizeMerchant(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isIof(title: string): boolean {
  const t = title.trim().toLowerCase();
  return t.startsWith("iof") || t.startsWith("estorno de iof");
}
function isPayment(title: string): boolean {
  return title.trim().toLowerCase().startsWith("pagamento");
}
function isRefund(title: string): boolean {
  return /^cr[ée]dito de /i.test(title.trim());
}
function refundOriginalMerchant(title: string): string {
  return title.replace(/^cr[ée]dito de\s+/i, "").trim();
}

function matchRule(merchant: string, r: Rule): boolean {
  const m = merchant.toLowerCase();
  const p = r.pattern.toLowerCase();
  if (r.match_type === "exact") return m === p;
  if (r.match_type === "regex") { try { return new RegExp(r.pattern, "i").test(merchant); } catch { return false; } }
  return m.includes(p);
}

function suggestCategory(merchant: string, rules: Rule[]): string | null {
  for (const r of rules) if (r.is_active && matchRule(merchant, r)) return r.category_id;
  return null;
}

type PreparedTx = {
  key: string;
  date: string;
  merchant: string;
  original_statement: string;
  amount: number;      // BRL, sign per convention (positive = expense on credit card)
  category_id: string | null;
  isRefund: boolean;
};

type DupInfo = {
  tx: PreparedTx;
  existingId: string;
  existingDate: string;
  existingMerchant: string;
  existingAmount: number;
};

export function NubankImport() {
  const fetchMeta = useServerFn(listTransactions);
  const fetchRules = useServerFn(listRules);
  const fetchDedup = useServerFn(listAccountTxForDedup);
  const importFn = useServerFn(importTransactions);
  const fxFn = useServerFn(getUsdBrlRate);

  const { data: meta } = useQuery({ queryKey: ["import-meta"], queryFn: () => fetchMeta({ data: { limit: 1 } }) });
  const { data: rulesData } = useQuery({ queryKey: ["rules-list"], queryFn: () => fetchRules() });

  const [rawRows, setRawRows] = useState<NubankRow[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [preview, setPreview] = useState<{
    newTx: PreparedTx[];
    dups: DupInfo[];
    iofNet: number;
    lastDate: string;
    totalUsdCache: Map<string, number>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [showDups, setShowDups] = useState(false);
  const [feesCategoryId, setFeesCategoryId] = useState<string>("");

  const brlAccounts = useMemo(
    () => (meta?.accounts ?? []).filter((a: any) => a.currency === "BRL"),
    [meta]
  );
  const categoriesById = useMemo(
    () => new Map<string, Category>((rulesData?.categories ?? []).map((c: any) => [c.id, c])),
    [rulesData]
  );
  const categoryLabel = (id: string | null): string => {
    if (!id) return "—";
    const c = categoriesById.get(id);
    if (!c) return "—";
    if (c.parent_id) {
      const p = categoriesById.get(c.parent_id);
      return p ? `${p.name} > ${c.name}` : c.name;
    }
    return c.name;
  };

  // Auto-pick a Nubank BRL account
  useMemo(() => {
    if (!accountId && brlAccounts.length) {
      const nubank = brlAccounts.find((a: any) => a.name.toLowerCase().includes("nubank"));
      setAccountId(nubank?.id ?? brlAccounts[0].id);
    }
  }, [brlAccounts, accountId]);

  // Auto-pick Fees & Charges (or similar) for the consolidated IOF entry
  useMemo(() => {
    if (!feesCategoryId && rulesData?.categories?.length) {
      const cats = rulesData.categories as any[];
      const fees = cats.find((c) => /fees|taxa|imposto|tarifa/i.test(c.name))
        ?? cats.find((c) => c.name.toLowerCase() === "other" || c.name.toLowerCase() === "outros");
      if (fees) setFeesCategoryId(fees.id);
    }
  }, [rulesData, feesCategoryId]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseNubankCsv(String(reader.result ?? ""));
        setRawRows(parsed);
        setPreview(null);
        toast.success(`${parsed.length} linhas lidas do CSV`);
      } catch (err: any) {
        toast.error(err.message ?? "Erro ao ler CSV");
      }
    };
    reader.readAsText(f);
  }

  async function buildPreview() {
    if (!accountId) { toast.error("Escolha a conta Nubank de destino"); return; }
    if (rawRows.length === 0) { toast.error("Selecione um arquivo primeiro"); return; }
    setBusy(true);
    try {
      setProgress("Aplicando regras de filtragem...");
      const rules = (rulesData?.rules ?? []) as Rule[];

      // 1) split IOF/payments from real tx
      let iofNet = 0;
      const rows: NubankRow[] = [];
      for (const r of rawRows) {
        if (isPayment(r.title)) continue;
        if (isIof(r.title)) { iofNet += r.amount; continue; }
        rows.push(r);
      }
      if (rows.length === 0) { toast.error("Nenhuma transação após filtros"); setBusy(false); return; }

      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      const lastDate = sorted[sorted.length - 1].date;

      // 2) build prepared new tx
      const prepared: PreparedTx[] = rows.map((r, i) => {
        const refund = isRefund(r.title);
        const merchant = refund
          ? `Crédito — ${refundOriginalMerchant(r.title)}`
          : r.title;
        const suggestBase = refund ? refundOriginalMerchant(r.title) : r.title;
        const category_id = suggestCategory(suggestBase, rules);
        return {
          key: `${r.date}|${i}|${r.title}`,
          date: r.date,
          merchant,
          original_statement: r.title,
          amount: r.amount, // Nubank convention: positive = compra (despesa), negativo = crédito
          category_id,
          isRefund: refund,
        };
      });

      // 3) dedup against existing tx in the account
      setProgress("Verificando duplicatas...");
      const minDate = sorted[0].date;
      const sinceD = new Date(minDate + "T00:00:00Z"); sinceD.setUTCDate(sinceD.getUTCDate() - 5);
      const untilD = new Date(lastDate + "T00:00:00Z"); untilD.setUTCDate(untilD.getUTCDate() + 5);
      const { transactions: existing } = await fetchDedup({
        data: {
          accountId,
          sinceDate: sinceD.toISOString().slice(0, 10),
          untilDate: untilD.toISOString().slice(0, 10),
        },
      });
      const dups: DupInfo[] = [];
      const newTx: PreparedTx[] = [];
      const usedExisting = new Set<string>();
      for (const p of prepared) {
        const pn = normalizeMerchant(p.merchant).slice(0, 8);
        const pd = new Date(p.date + "T00:00:00Z").getTime();
        let match: any = null;
        for (const e of existing as any[]) {
          if (usedExisting.has(e.id)) continue;
          if ((e.currency ?? "BRL") !== "BRL") continue;
          const en = normalizeMerchant(e.merchant ?? "").slice(0, 8);
          if (en.length < 3 || pn.length < 3) continue;
          if (en !== pn) continue;
          const ed = new Date(e.date + "T00:00:00Z").getTime();
          const diffDays = Math.abs(pd - ed) / 86400000;
          if (diffDays > 3) continue;
          const ea = Number(e.amount);
          if (Math.abs(ea) < 0.01) continue;
          const diffPct = Math.abs(ea - p.amount) / Math.abs(ea);
          if (diffPct > 0.03) continue;
          match = e; break;
        }
        if (match) {
          usedExisting.add(match.id);
          dups.push({ tx: p, existingId: match.id, existingDate: match.date, existingMerchant: match.merchant ?? "", existingAmount: Number(match.amount) });
        } else {
          newTx.push(p);
        }
      }

      // 4) prefetch FX for all needed dates
      setProgress("Buscando cotações USD/BRL...");
      const fxDates = new Set<string>();
      for (const t of newTx) fxDates.add(t.date);
      if (Math.abs(iofNet) > 0.5) fxDates.add(lastDate);
      const fxCache = new Map<string, number>();
      for (const d of fxDates) {
        try { const { rate } = await fxFn({ data: { date: d } }); fxCache.set(d, rate); }
        catch { fxCache.set(d, 5); }
      }

      setPreview({ newTx, dups, iofNet, lastDate, totalUsdCache: fxCache });
      toast.success(`Preview: ${newTx.length} novas, ${dups.length} duplicatas`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao gerar preview");
    } finally {
      setBusy(false); setProgress("");
    }
  }

  function updateCategory(key: string, catId: string) {
    if (!preview) return;
    setPreview({ ...preview, newTx: preview.newTx.map((t) => t.key === key ? { ...t, category_id: catId || null } : t) });
  }

  async function confirmImport() {
    if (!preview || !accountId) return;
    setBusy(true);
    try {
      setProgress("Importando transações...");
      const rows = preview.newTx.map((t) => {
        const rate = preview.totalUsdCache.get(t.date) ?? 5;
        return {
          date: t.date,
          merchant: t.merchant,
          original_statement: t.original_statement || null,
          notes: null,
          amount: t.amount,
          currency: "BRL",
          amount_usd: Number((t.amount / rate).toFixed(2)),
          exchange_rate: rate,
          account_id: accountId,
          category_id: t.category_id,
          is_transfer: false,
          tags: null,
        };
      });

      // consolidated IOF
      if (Math.abs(preview.iofNet) > 0.5) {
        const rate = preview.totalUsdCache.get(preview.lastDate) ?? 5;
        rows.push({
          date: preview.lastDate,
          merchant: "IOF — Imposto s/ Operações Financeiras",
          original_statement: `IOF consolidado (${preview.iofNet >= 0 ? "líquido" : "estorno líquido"})`,
          notes: null,
          amount: Number(preview.iofNet.toFixed(2)),
          currency: "BRL",
          amount_usd: Number((preview.iofNet / rate).toFixed(2)),
          exchange_rate: rate,
          account_id: accountId,
          category_id: feesCategoryId || null,
          is_transfer: false,
          tags: null,
        });
      }

      const { inserted } = await importFn({ data: { rows } });
      toast.success(`${inserted} transações importadas do Nubank!`);
      setPreview(null); setRawRows([]);
    } catch (e: any) {
      toast.error(e.message ?? "Erro no import");
    } finally {
      setBusy(false); setProgress("");
    }
  }

  const totalBrl = preview ? preview.newTx.reduce((s, t) => s + t.amount, 0) + (Math.abs(preview.iofNet) > 0.5 ? preview.iofNet : 0) : 0;
  const totalUsd = preview ? preview.newTx.reduce((s, t) => {
    const r = preview.totalUsdCache.get(t.date) ?? 5; return s + t.amount / r;
  }, 0) + (Math.abs(preview.iofNet) > 0.5 ? preview.iofNet / (preview.totalUsdCache.get(preview.lastDate) ?? 5) : 0) : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          CSV bruto exportado pelo Nubank (3 colunas: <code>date, title, amount</code>).
          Valores no formato brasileiro (<code>1.234,56</code>). IOF é consolidado em uma
          única linha, pagamentos de fatura são ignorados e créditos viram entradas.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Conta Nubank de destino</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            >
              <option value="">Selecione...</option>
              {brlAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Categoria para IOF consolidado</span>
            <select
              value={feesCategoryId}
              onChange={(e) => setFeesCategoryId(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            >
              <option value="">Sem categoria</option>
              {(rulesData?.categories ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv" onChange={onFile} className="text-sm" />
          <Button onClick={buildPreview} disabled={busy || rawRows.length === 0 || !accountId}>
            {busy ? progress || "Processando..." : "Gerar preview"}
          </Button>
          {rawRows.length > 0 && !preview && (
            <span className="text-sm text-muted-foreground">{rawRows.length} linhas no CSV</span>
          )}
        </div>
      </div>

      {preview && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <SummaryCard label="Novas" value={String(preview.newTx.length)} />
            <SummaryCard label="Duplicatas removidas" value={String(preview.dups.length)} />
            <SummaryCard
              label="IOF consolidado"
              value={Math.abs(preview.iofNet) > 0.5 ? `R$ ${preview.iofNet.toFixed(2)}` : "—"}
            />
            <SummaryCard
              label="Total"
              value={`R$ ${totalBrl.toFixed(2)} · US$ ${totalUsd.toFixed(2)}`}
            />
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-semibold text-sm">
              Novas transações ({preview.newTx.length})
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2 text-right">BRL</th>
                    <th className="px-3 py-2">Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.newTx.map((t) => (
                    <tr key={t.key} className="border-t border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap">{t.date}</td>
                      <td className="px-3 py-2">
                        <div>{t.merchant}</div>
                        {t.isRefund && <div className="text-xs text-emerald-400">estorno</div>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${t.amount < 0 ? "text-emerald-400" : ""}`}>
                        {t.amount.toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={t.category_id ?? ""}
                          onChange={(e) => updateCategory(t.key, e.target.value)}
                          className="rounded-md border border-border bg-input px-2 py-1 text-xs w-full max-w-[240px]"
                        >
                          <option value="">— Sem categoria —</option>
                          {(rulesData?.categories ?? []).map((c: any) => (
                            <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.dups.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => setShowDups((s) => !s)}
                className="w-full px-4 py-3 border-b border-border text-left font-semibold text-sm hover:bg-muted/40"
              >
                {showDups ? "▾" : "▸"} Duplicatas detectadas ({preview.dups.length}) — não serão importadas
              </button>
              {showDups && (
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr className="text-left text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2">CSV</th>
                        <th className="px-3 py-2">Existente</th>
                        <th className="px-3 py-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.dups.map((d) => (
                        <tr key={d.tx.key} className="border-t border-border/60">
                          <td className="px-3 py-2">
                            <div>{d.tx.date} · {d.tx.merchant}</div>
                            <div className="text-xs text-muted-foreground">R$ {d.tx.amount.toFixed(2)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{d.existingDate} · {d.existingMerchant}</div>
                            <div className="text-xs text-muted-foreground">R$ {d.existingAmount.toFixed(2)}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            Δ dias {Math.round(Math.abs((new Date(d.tx.date).getTime() - new Date(d.existingDate).getTime()) / 86400000))},
                            {" "}Δ valor {(Math.abs(d.existingAmount - d.tx.amount) / Math.max(0.01, Math.abs(d.existingAmount)) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setPreview(null); }} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={confirmImport} disabled={busy || preview.newTx.length === 0}>
              {busy ? progress || "Importando..." : `Confirmar e importar ${preview.newTx.length}${Math.abs(preview.iofNet) > 0.5 ? " + IOF" : ""}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
