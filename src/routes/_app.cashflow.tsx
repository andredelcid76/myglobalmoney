import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCashflow } from "@/lib/finance.functions";
import { formatCurrency } from "@/lib/format";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend as ReLegend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";

export const Route = createFileRoute("/_app/cashflow")({ component: CashflowPage });

function CashflowPage() {
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [includeProjections, setIncludeProjections] = useState(true);
  const periodsByGran: Record<string, number> = { daily: 60, weekly: 12, monthly: 12, quarterly: 4, yearly: 5 };
  const periods = periodsByGran[granularity];
  const fetchCf = useServerFn(getCashflow);
  const { data } = useQuery({
    queryKey: ["cashflow", granularity, periods, includeProjections],
    queryFn: () => fetchCf({ data: { granularity, periods, includeProjections } }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fluxo de caixa</h1>
        <p className="text-sm text-muted-foreground">Projeção baseada em recorrências, orçamento e faturas em aberto.</p>
      </div>
      {!data ? (
        <div className="text-sm text-muted-foreground">Carregando fluxo de caixa…</div>
      ) : (
        <CashflowView data={data} granularity={granularity} setGranularity={setGranularity}
          includeProjections={includeProjections} setIncludeProjections={setIncludeProjections} />
      )}
    </div>
  );
}

function CashflowView({ data, granularity, setGranularity, includeProjections, setIncludeProjections }: any) {
  const chart = data.series.map((s: any) => ({
    label: s.label,
    income: Math.round(s.income),
    fixed: -Math.round(s.fixed),
    variable: -Math.round(s.variable),
    net: Math.round(s.net),
    cumulative: Math.round(s.cumulative),
  }));

  const totalIn = data.series.reduce((s: number, p: any) => s + p.income, 0);
  const totalOut = data.series.reduce((s: number, p: any) => s + p.expense, 0);
  const totalNet = totalIn - totalOut;
  const endNet = data.series[data.series.length - 1]?.cumulative ?? data.currentNet;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {(["daily", "weekly", "monthly", "quarterly", "yearly"] as const).map((g) => (
            <button key={g} onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 ${granularity === g ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
              {g === "daily" ? "Diário" : g === "weekly" ? "Semanal" : g === "monthly" ? "Mensal" : g === "quarterly" ? "Trimestral" : "Anual"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
            <button onClick={() => setIncludeProjections(false)}
              className={`px-3 py-1.5 ${!includeProjections ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
              Só confirmadas
            </button>
            <button onClick={() => setIncludeProjections(true)}
              className={`px-3 py-1.5 ${includeProjections ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/40"}`}>
              + Projeções
            </button>
          </div>
          <div className="text-xs text-muted-foreground">{data.series.length} períodos</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Saldo atual" value={formatCurrency(data.currentNet)} />
        <Stat label="Entradas previstas" value={formatCurrency(totalIn)} accent="text-success" />
        <Stat label="Saídas previstas" value={formatCurrency(totalOut)} accent="text-destructive" />
        <Stat label="Saldo no fim" value={formatCurrency(endNet)} accent={totalNet >= 0 ? "text-success" : "text-destructive"} />
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
                {data.series.map((s: any) => (
                  <tr key={s.start} className="border-b border-border/40">
                    <td className="py-1.5 font-medium">{s.label}</td>
                    <td className="text-right tabular-nums text-success">{formatCurrency(s.income)}</td>
                    <td className="text-right tabular-nums text-destructive">{formatCurrency(s.fixed)}</td>
                    <td className="text-right tabular-nums text-amber-500">{formatCurrency(s.variable)}</td>
                    <td className={`text-right tabular-nums ${s.net >= 0 ? "text-success" : "text-destructive"}`}>{formatCurrency(s.net)}</td>
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
              {data.upcoming.map((u: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/30">
                  <div className="flex items-center gap-2">
                    {u.isIncome ? <ArrowUpCircle className="h-3.5 w-3.5 text-success" /> : <ArrowDownCircle className="h-3.5 w-3.5 text-destructive" />}
                    <span className="text-muted-foreground">{u.date}</span>
                    <span>{u.name}</span>
                  </div>
                  <span className={`tabular-nums ${u.isIncome ? "text-success" : "text-destructive"}`}>
                    {u.isIncome ? "+" : "−"}{formatCurrency(u.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
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