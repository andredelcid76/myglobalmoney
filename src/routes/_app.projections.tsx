import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProjections, getCashflow } from "@/lib/finance.functions";
import { formatCurrency, monthLabel } from "@/lib/format";
import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend as ReLegend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";

export const Route = createFileRoute("/_app/projections")({ component: ProjectionsPage });

function ProjectionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projeções</h1>
        <p className="text-sm text-muted-foreground">Patrimônio e fluxo de caixa baseados em recorrências e orçamento</p>
      </div>
      <Tabs defaultValue="cashflow" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cashflow">Fluxo de caixa</TabsTrigger>
          <TabsTrigger value="networth">Patrimônio</TabsTrigger>
        </TabsList>
        <TabsContent value="cashflow"><CashflowView /></TabsContent>
        <TabsContent value="networth"><NetWorthView /></TabsContent>
      </Tabs>
    </div>
  );
}

function NetWorthView() {
  const [months, setMonths] = useState(6);
  const fetchProj = useServerFn(getProjections);
  const { data } = useQuery({ queryKey: ["projections", months], queryFn: () => fetchProj({ data: { months } }) });

  if (!data) return <div className="text-sm text-muted-foreground">Carregando projeção…</div>;

  const combined = [
    ...data.history.map((h) => ({ month: monthLabel(h.month + "-01"), income: h.income, expense: h.expense })),
    ...data.projection.map((p) => ({ month: monthLabel(p.month + "-01"), income: p.income, expense: p.expense })),
  ];

  const cumulativeData = data.projection.map((p) => ({ month: monthLabel(p.month + "-01"), cumulative: p.cumulative }));
  const finalNet = data.projection[data.projection.length - 1]?.cumulative ?? data.currentNet;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="rounded-md border border-border bg-input px-3 py-2 text-sm">
          {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} meses</option>)}
        </select>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Patrimônio atual" value={formatCurrency(data.currentNet)} />
        <Stat label="Receita média/mês" value={formatCurrency(data.avgIncome)} accent="text-emerald-400" />
        <Stat label="Gasto médio/mês" value={formatCurrency(data.avgExpense)} accent="text-rose-400" />
        <Stat label={`Em ${months} meses`} value={formatCurrency(finalNet)} accent={finalNet >= data.currentNet ? "text-emerald-400" : "text-rose-400"} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium mb-3">Patrimônio projetado (USD)</div>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={[{ month: "Hoje", cumulative: data.currentNet }, ...cumulativeData]}>
              <defs>
                <linearGradient id="gradNet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => formatCurrency(v)} />
              <Area type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" fill="url(#gradNet)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium mb-3">Receitas vs Gastos (3m histórico + projeção)</div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={combined}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="income" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Projeção considera recorrências ativas + orçamento (fixo e variável). Se não houver orçamento para um mês, usa média dos últimos 3 meses.
        </div>
      </div>
    </div>
  );
}

function CashflowView() {
  const [granularity, setGranularity] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const periodsByGran: Record<string, number> = { weekly: 12, monthly: 12, quarterly: 4 };
  const periods = periodsByGran[granularity];
  const fetchCf = useServerFn(getCashflow);
  const { data } = useQuery({
    queryKey: ["cashflow", granularity, periods],
    queryFn: () => fetchCf({ data: { granularity, periods } }),
  });
  if (!data) return <div className="text-sm text-muted-foreground">Carregando fluxo de caixa…</div>;

  const chart = data.series.map((s) => ({
    label: s.label,
    income: Math.round(s.income),
    fixed: -Math.round(s.fixed),
    variable: -Math.round(s.variable),
    net: Math.round(s.net),
    cumulative: Math.round(s.cumulative),
  }));

  const totalIn = data.series.reduce((s, p) => s + p.income, 0);
  const totalOut = data.series.reduce((s, p) => s + p.expense, 0);
  const totalNet = totalIn - totalOut;
  const endNet = data.series[data.series.length - 1]?.cumulative ?? data.currentNet;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(["weekly", "monthly", "quarterly"] as const).map((g) => (
            <button key={g} onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 ${granularity === g ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
              {g === "weekly" ? "Semanal" : g === "monthly" ? "Mensal" : "Trimestral"}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {data.series.length} períodos · base recorrências + orçamento
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Saldo atual" value={formatCurrency(data.currentNet)} />
        <Stat label="Entradas previstas" value={formatCurrency(totalIn)} accent="text-emerald-400" />
        <Stat label="Saídas previstas" value={formatCurrency(totalOut)} accent="text-rose-400" />
        <Stat label="Saldo no fim" value={formatCurrency(endNet)} accent={totalNet >= 0 ? "text-emerald-400" : "text-rose-400"} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium mb-3">Entradas, saídas e saldo acumulado</div>
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={chart} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number, name: string) => [formatCurrency(Math.abs(v)), name]} />
              <ReLegend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" name="Entradas" dataKey="income" stackId="a" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" name="Despesas fixas" dataKey="fixed" stackId="a" fill="hsl(var(--destructive))" />
              <Bar yAxisId="left" name="Variáveis" dataKey="variable" stackId="a" fill="#f59e0b" radius={[0, 0, 4, 4]} />
              <Line yAxisId="right" type="monotone" name="Saldo acumulado" dataKey="cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-medium mb-3">Detalhamento por período</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-1.5">Período</th>
                  <th className="text-right">Entradas</th>
                  <th className="text-right">Fixas</th>
                  <th className="text-right">Variáveis</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.start} className="border-b border-border/40">
                    <td className="py-1.5 font-medium">{s.label}</td>
                    <td className="text-right tabular-nums text-emerald-400">{formatCurrency(s.income)}</td>
                    <td className="text-right tabular-nums text-rose-400">{formatCurrency(s.fixed)}</td>
                    <td className="text-right tabular-nums text-amber-400">{formatCurrency(s.variable)}</td>
                    <td className={`text-right tabular-nums ${s.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatCurrency(s.net)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(s.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-medium mb-3">Próximas recorrências no período</div>
          {data.upcoming.length === 0 ? (
            <div className="text-xs text-muted-foreground">Nenhuma recorrência ativa cadastrada para este horizonte.</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {data.upcoming.map((u, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/30">
                  <div className="flex items-center gap-2">
                    {u.isIncome ? <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-400" /> : <ArrowDownCircle className="h-3.5 w-3.5 text-rose-400" />}
                    <span className="text-muted-foreground">{u.date}</span>
                    <span>{u.name}</span>
                  </div>
                  <span className={`tabular-nums ${u.isIncome ? "text-emerald-400" : "text-rose-400"}`}>
                    {u.isIncome ? "+" : "−"}{formatCurrency(u.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Despesas fixas = recorrências debitadas + orçamentos do tipo &quot;fixo&quot;. Variáveis vêm dos orçamentos &quot;variável&quot;; se não houver, usa a média dos últimos 3 meses.
      </div>
    </div>
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