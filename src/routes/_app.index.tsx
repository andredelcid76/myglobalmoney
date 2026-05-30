import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOverview } from "@/lib/finance.functions";
import { getLatestUsdBrl } from "@/lib/fx.functions";
import { formatCurrency, monthLabel, startOfMonth, endOfMonth } from "@/lib/format";
import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

function Dashboard() {
  const fetchOverview = useServerFn(getOverview);
  const fetchFx = useServerFn(getLatestUsdBrl);
  const mStart = startOfMonth();
  const mEnd = endOfMonth();

  const { data: fx } = useQuery({ queryKey: ["fx"], queryFn: () => fetchFx(), staleTime: 3600_000 });
  const { data, isLoading } = useQuery({
    queryKey: ["overview", mStart],
    queryFn: () => fetchOverview({ data: { monthStart: mStart, monthEnd: mEnd } }),
  });

  const stats = useMemo(() => {
    if (!data || !fx) return null;
    const rate = fx.rate;
    const balances = data.accounts.map((a) => {
      const tx = data.allTx.filter((t) => t.account_id === a.id);
      const balNative = Number(a.initial_balance) + tx.reduce((s, t) => s + Number(t.amount), 0);
      const balUsd = a.currency === "BRL" ? balNative / rate : balNative;
      return { ...a, balNative, balUsd };
    });
    const totalUsd = balances.reduce((s, b) => s + b.balUsd, 0);
    const income = data.monthTx.filter((t) => Number(t.amount_usd) > 0).reduce((s, t) => s + Number(t.amount_usd), 0);
    const expense = data.monthTx.filter((t) => Number(t.amount_usd) < 0).reduce((s, t) => s + Number(t.amount_usd), 0);
    const catMap = new Map<string, number>();
    for (const t of data.monthTx) {
      if (Number(t.amount_usd) >= 0) continue;
      const c = data.categories.find((c) => c.id === t.category_id);
      const name = c?.parent_id ? (data.categories.find((p) => p.id === c.parent_id)?.name ?? c.name) : (c?.name ?? "Sem categoria");
      catMap.set(name, (catMap.get(name) ?? 0) + Math.abs(Number(t.amount_usd)));
    }
    const byCat = Array.from(catMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    return { balances, totalUsd, income, expense: Math.abs(expense), net: income + expense, byCat };
  }, [data, fx]);

  if (isLoading || !stats) return <div className="text-muted-foreground">Carregando…</div>;

  const palette = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#ec4899"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="text-sm text-muted-foreground">{monthLabel(mStart)} · valores em USD</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Patrimônio total" value={formatCurrency(stats.totalUsd)} icon={<Wallet className="h-4 w-4" />} accent />
        <StatCard label="Receitas (mês)" value={formatCurrency(stats.income)} icon={<TrendingUp className="h-4 w-4 text-success" />} />
        <StatCard label="Despesas (mês)" value={formatCurrency(stats.expense)} icon={<TrendingDown className="h-4 w-4 text-destructive" />} />
        <StatCard label="Saldo do mês" value={formatCurrency(stats.net)} valueClass={stats.net >= 0 ? "text-success" : "text-destructive"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Contas">
          <div className="space-y-3">
            {stats.balances.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-md grid place-items-center text-xs font-semibold text-white" style={{ background: a.color ?? "#4f46e5" }}>
                    {a.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.institution} · {a.currency}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{formatCurrency(a.balNative, a.currency)}</div>
                  {a.currency !== "USD" && <div className="text-xs text-muted-foreground tabular-nums">≈ {formatCurrency(a.balUsd)}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Gastos por categoria (mês)">
          {stats.byCat.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem gastos ainda este mês.</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 items-center">
              <div className="h-48">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={stats.byCat.slice(0, 8)} dataKey="value" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {stats.byCat.slice(0, 8).map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 text-sm">
                {stats.byCat.slice(0, 8).map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                      <span className="truncate">{c.name}</span>
                    </div>
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Top categorias (barras)">
        {stats.byCat.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma transação no período.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={stats.byCat.slice(0, 10)}>
                <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon, accent, valueClass }: { label: string; value: string; icon?: React.ReactNode; accent?: boolean; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border p-4" style={{ background: accent ? "var(--gradient-card)" : "var(--card)" }}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>{icon}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}