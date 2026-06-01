import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listGoals, upsertGoal, deleteGoal, contributeToGoal } from "@/lib/goals.functions";
import { formatCurrency } from "@/lib/format";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Target, Plus as PlusIcon, Minus } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

export const Route = createFileRoute("/_app/goals")({ component: GoalsPage });

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444", "#84cc16"];

function GoalsPage() {
  const fetchGoals = useServerFn(listGoals);
  const upsert = useServerFn(upsertGoal);
  const del = useServerFn(deleteGoal);
  const contribute = useServerFn(contributeToGoal);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["goals"], queryFn: () => fetchGoals() });
  const inv = () => qc.invalidateQueries({ queryKey: ["goals"] });

  const upsertMut = useMutation({ mutationFn: (v: any) => upsert({ data: v }), onSuccess: inv });
  const delMut = useMutation({ mutationFn: (id: string) => del({ data: { id } }), onSuccess: inv });
  const contribMut = useMutation({ mutationFn: (v: { id: string; amount_usd: number }) => contribute({ data: v }), onSuccess: inv });

  const goals = data?.goals ?? [];
  const totalTarget = goals.reduce((s, g: any) => s + Number(g.target_amount_usd), 0);
  const totalCurrent = goals.reduce((s, g: any) => s + Number(g.current_amount_usd), 0);
  const totalMonthly = goals.reduce((s, g: any) => s + Number(g.monthly_contribution_usd), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Metas</h1>
          <p className="text-sm text-muted-foreground">Objetivos financeiros com contribuições mensais</p>
        </div>
        <GoalDialog onSave={(v) => upsertMut.mutate(v)} trigger={
          <Button><Plus className="h-4 w-4" /> Nova meta</Button>
        } />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Total acumulado" value={formatCurrency(totalCurrent)} sub={`de ${formatCurrency(totalTarget)}`} />
        <SummaryCard label="Contribuição mensal" value={formatCurrency(totalMonthly)} sub="planejado/mês" />
        <SummaryCard label="Metas ativas" value={String(goals.filter((g: any) => !g.is_archived).length)} sub={`${goals.length} no total`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {goals.map((g: any) => {
          const target = Number(g.target_amount_usd);
          const curr = Number(g.current_amount_usd);
          const monthly = Number(g.monthly_contribution_usd);
          const ratio = target > 0 ? Math.min(curr / target, 1) : 0;
          const remaining = Math.max(target - curr, 0);
          const monthsLeft = monthly > 0 ? Math.ceil(remaining / monthly) : null;
          const eta = monthsLeft != null ? etaDate(monthsLeft) : null;
          return (
            <div key={g.id} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg grid place-items-center" style={{ background: `${g.color}22`, color: g.color }}>
                    <Target className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">{g.name}</div>
                    {g.target_date && <div className="text-xs text-muted-foreground">até {g.target_date}</div>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <GoalDialog initial={g} onSave={(v) => upsertMut.mutate(v)} trigger={
                    <Button size="icon" variant="ghost"><Pencil className="h-3.5 w-3.5" /></Button>
                  } />
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Excluir "${g.name}"?`)) delMut.mutate(g.id); }}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-semibold tabular-nums">{formatCurrency(curr)}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">de {formatCurrency(target)}</div>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${ratio * 100}%`, background: g.color }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round(ratio * 100)}%</span>
                  <span>faltam {formatCurrency(remaining)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md bg-secondary/40 px-3 py-2">
                  <div className="text-muted-foreground">Mensal</div>
                  <div className="font-medium tabular-nums">{formatCurrency(monthly)}</div>
                </div>
                <div className="rounded-md bg-secondary/40 px-3 py-2">
                  <div className="text-muted-foreground">ETA</div>
                  <div className="font-medium">{eta ?? "—"}</div>
                </div>
              </div>

              <ContributePopover onContribute={(amt) => contribMut.mutate({ id: g.id, amount_usd: amt })} />
            </div>
          );
        })}
      </div>

      {goals.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nenhuma meta ainda. Clique em "Nova meta" para começar.
        </div>
      )}
    </div>
  );
}

function etaDate(monthsLeft: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsLeft);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function ContributePopover({ onContribute }: { onContribute: (amt: number) => void }) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">Registrar contribuição</Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "add" ? "default" : "outline"} className="flex-1" onClick={() => setMode("add")}>
            <PlusIcon className="h-3 w-3" /> Adicionar
          </Button>
          <Button size="sm" variant={mode === "remove" ? "default" : "outline"} className="flex-1" onClick={() => setMode("remove")}>
            <Minus className="h-3 w-3" /> Retirar
          </Button>
        </div>
        <Input type="number" step="10" placeholder="USD" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus />
        <Button size="sm" className="w-full" onClick={() => {
          const n = Number(amt); if (!isFinite(n) || n <= 0) return;
          onContribute(mode === "add" ? n : -n);
          setAmt(""); setOpen(false);
        }}>Confirmar</Button>
      </PopoverContent>
    </Popover>
  );
}

function GoalDialog({ initial, onSave, trigger }: { initial?: any; onSave: (v: any) => void; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [target, setTarget] = useState<string>(initial?.target_amount_usd != null ? String(initial.target_amount_usd) : "");
  const [current, setCurrent] = useState<string>(initial?.current_amount_usd != null ? String(initial.current_amount_usd) : "0");
  const [monthly, setMonthly] = useState<string>(initial?.monthly_contribution_usd != null ? String(initial.monthly_contribution_usd) : "");
  const [targetDate, setTargetDate] = useState<string>(initial?.target_date ?? "");
  const [color, setColor] = useState<string>(initial?.color ?? "#10b981");
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");

  const reset = () => {
    setName(initial?.name ?? ""); setTarget(initial?.target_amount_usd != null ? String(initial.target_amount_usd) : "");
    setCurrent(initial?.current_amount_usd != null ? String(initial.current_amount_usd) : "0");
    setMonthly(initial?.monthly_contribution_usd != null ? String(initial.monthly_contribution_usd) : "");
    setTargetDate(initial?.target_date ?? ""); setColor(initial?.color ?? "#10b981"); setNotes(initial?.notes ?? "");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar meta" : "Nova meta"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Reserva de emergência" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Alvo (USD)</Label>
              <Input type="number" step="100" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Já acumulado (USD)</Label>
              <Input type="number" step="100" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Mensal (USD)</Label>
              <Input type="number" step="10" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data alvo</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cor</Label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => {
            const t = Number(target); if (!name.trim() || !isFinite(t) || t <= 0) return;
            onSave({
              ...(initial?.id ? { id: initial.id } : {}),
              name: name.trim(),
              target_amount_usd: t,
              current_amount_usd: Number(current) || 0,
              monthly_contribution_usd: Number(monthly) || 0,
              target_date: targetDate || null,
              color,
              notes: notes || null,
              is_archived: !!initial?.is_archived,
            });
            setOpen(false);
          }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}