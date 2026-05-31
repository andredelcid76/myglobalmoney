import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCreditCardStatements } from "@/lib/creditcards.functions";
import { formatCurrency, formatDate } from "@/lib/format";
import { useState } from "react";
import { CreditCard, AlertCircle, Calendar, ChevronDown, ChevronRight, Settings2, Pencil } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/credit-cards")({ component: CardsPage });

function CardsPage() {
  const fetchCards = useServerFn(getCreditCardStatements);
  const { data, isLoading } = useQuery({
    queryKey: ["credit-cards"],
    queryFn: () => fetchCards(),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  const cards = data?.cards ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cartões de Crédito</h1>
        <p className="text-sm text-muted-foreground mt-1">Acompanhe faturas em aberto, vencimentos e utilização do limite.</p>
      </div>

      {cards.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhum cartão de crédito cadastrado. Crie uma conta do tipo "Credit card" em <Link to="/accounts" className="text-primary underline">Contas</Link>.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {cards.map((c: any) => <CardItem key={c.account.id} card={c} />)}
      </div>
    </div>
  );
}

function CardItem({ card }: { card: any }) {
  const [expanded, setExpanded] = useState<number | null>(1); // current open by default
  const a = card.account;
  const navigate = useNavigate();
  const openEdit = () => navigate({ to: "/accounts", hash: `edit-${a.id}` });

  const today = new Date();
  const dueDate = card.nextDue ? new Date(card.nextDue + "T00:00:00") : null;
  const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border" style={{ background: `linear-gradient(135deg, ${a.color}22, transparent)` }}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg grid place-items-center" style={{ background: a.color }}>
              <CreditCard className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-semibold">{a.name}</div>
              <div className="text-xs text-muted-foreground">{a.institution} · {a.currency}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!card.configured && (
              <div className="hidden sm:flex items-center gap-1 text-xs text-amber-500">
                <AlertCircle className="h-3 w-3" /> Configure fatura
              </div>
            )}
            <Button size="sm" variant={card.configured ? "ghost" : "default"} onClick={openEdit}>
              {card.configured ? <><Pencil className="h-3.5 w-3.5 mr-1" /> Editar</> : <><Settings2 className="h-3.5 w-3.5 mr-1" /> Configurar</>}
            </Button>
          </div>
        </div>

        {card.configured ? (
          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Fatura atual</div>
              <div className="text-lg font-semibold tabular-nums">{formatCurrency(card.currentTotalUsd)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Vencimento</div>
              <div className="font-semibold">{formatDate(card.nextDue)}</div>
              {daysUntilDue !== null && (
                <div className={`text-[10px] ${daysUntilDue < 0 ? "text-destructive" : daysUntilDue <= 7 ? "text-amber-500" : "text-muted-foreground"}`}>
                  {daysUntilDue < 0 ? `${Math.abs(daysUntilDue)}d atrasado` : daysUntilDue === 0 ? "hoje" : `em ${daysUntilDue}d`}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground">Limite</div>
              {a.credit_limit_usd ? (
                <>
                  <div className="font-semibold tabular-nums">{formatCurrency(Number(a.credit_limit_usd))}</div>
                  {card.utilization !== null && (
                    <Progress value={Math.min(100, card.utilization * 100)} className="h-1 mt-1" />
                  )}
                </>
              ) : (
                <div className="text-muted-foreground">—</div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">
            Defina dia de fechamento, vencimento e (opcional) limite para habilitar a gestão de fatura.
          </div>
        )}
      </div>

      {card.configured && (
        <div className="divide-y divide-border">
          {card.statements.map((s: any, idx: number) => {
            const isOpen = expanded === idx;
            return (
              <div key={idx}>
                <button onClick={() => setExpanded(isOpen ? null : idx)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/30 transition text-left">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <div>
                      <div className="text-sm font-medium">{s.label}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(s.start)} → {formatDate(s.close)} · vence {formatDate(s.due)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{formatCurrency(s.totalUsd)}</div>
                    <div className="text-[10px] text-muted-foreground">{s.count} lançamentos</div>
                  </div>
                </button>
                {isOpen && s.transactions.length > 0 && (
                  <div className="bg-secondary/10 px-5 py-2 max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {s.transactions
                          .slice()
                          .sort((a: any, b: any) => b.date.localeCompare(a.date))
                          .map((t: any) => (
                            <tr key={t.id} className="border-t border-border/40">
                              <td className="py-1.5 text-muted-foreground whitespace-nowrap pr-2">{formatDate(t.date)}</td>
                              <td className="py-1.5 truncate">{t.merchant}</td>
                              <td className="py-1.5 text-right tabular-nums">{formatCurrency(Math.abs(Number(t.amount_usd)))}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {isOpen && s.transactions.length === 0 && (
                  <div className="bg-secondary/10 px-5 py-3 text-xs text-muted-foreground text-center">
                    Sem lançamentos neste período.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}