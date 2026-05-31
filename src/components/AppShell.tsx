import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, PiggyBank, FolderTree, Wallet, Upload, TrendingUp, LogOut, DollarSign, Repeat, Target, CreditCard } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLatestUsdBrl } from "@/lib/fx.functions";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", label: "Transações", icon: Receipt },
  { to: "/budgets", label: "Orçamentos", icon: PiggyBank },
  { to: "/goals", label: "Metas", icon: Target },
  { to: "/recurrences", label: "Recorrências", icon: Repeat },
  { to: "/projections", label: "Projeções", icon: TrendingUp },
  { to: "/credit-cards", label: "Cartões", icon: CreditCard },
  { to: "/categories", label: "Categorias", icon: FolderTree },
  { to: "/accounts", label: "Contas", icon: Wallet },
  { to: "/import", label: "Importar CSV", icon: Upload },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fetchFx = useServerFn(getLatestUsdBrl);
  const { data: fx } = useQuery({
    queryKey: ["fx", "USDBRL"],
    queryFn: () => fetchFx(),
    staleTime: 1000 * 60 * 60,
  });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-60 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md grid place-items-center" style={{ background: "var(--gradient-primary)" }}>
              <DollarSign className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="font-semibold tracking-tight">My Global Money</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Finance OS</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => {
            const active = n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {fx && (
            <div className="px-3 py-2 rounded-md bg-sidebar-accent/40 text-xs">
              <div className="text-muted-foreground">USD/BRL</div>
              <div className="font-semibold">R$ {fx.rate.toFixed(4)}</div>
              <div className="text-[10px] text-muted-foreground">{fx.date}</div>
            </div>
          )}
          <div className="text-xs text-muted-foreground px-3 truncate">{user?.email}</div>
          <button
            onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar">
          <div className="font-semibold">My Global Money</div>
          <button onClick={async () => { await signOut(); navigate({ to: "/login" }); }} className="text-sm text-muted-foreground">Sair</button>
        </div>
        <div className="md:hidden flex gap-1 overflow-x-auto px-2 py-2 border-b border-border bg-sidebar/50">
          {nav.map((n) => {
            const active = n.exact ? location.pathname === n.to : location.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={`shrink-0 px-3 py-1.5 rounded-md text-xs ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {n.label}
              </Link>
            );
          })}
        </div>
        <div className="p-4 md:p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}