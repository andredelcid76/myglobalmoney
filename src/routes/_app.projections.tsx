import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProjections } from "@/lib/finance.functions";
import { formatCurrency, monthLabel } from "@/lib/format";
import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_app/projections")({ component: ProjectionsPage });

function ProjectionsPage() {
  const [months, setMonths] = useState(6);
  const fetchProj = useServerFn(getProjections);
  const { data } = useQuery({ queryKey: ["projections", months], queryFn: () => fetchProj({ data: { months } }) });

  if (!data) return <div className="text-sm text-muted-foreground">Carregando projeção…</div>;

  const combined = [
    ...data.history.map((h) => ({ month: monthLabel(h.month + "-01"), income: h.income, expense: h.expense, net: h.net, type: "Histórico" })),
    ...data.projection.map((p) => ({ month: monthLabel(p.month + "-01"), income: p.income, expense: p.expense, net: p.net, cumulative: p.cumulative, type: "Projetado" })),
  ];

  const cumulativeData = data.projection.map((p) => ({ month: monthLabel(p.month + "-01"), cumulative: p.cumulative }));
  const finalNet = data.projection[data.projection.length - 1]?.cumulative ?? data.currentNet;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projeções</h1>
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
          Projeção baseada na média dos últimos 3 meses fechados. Em breve: incluir orçamentos e despesas recorrentes.
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