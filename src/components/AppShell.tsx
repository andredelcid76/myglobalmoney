import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, PiggyBank, FolderTree, Wallet, Upload, TrendingUp, LogOut, Repeat, Target, CreditCard, Sparkles, Leaf, Search, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLatestUsdBrl } from "@/lib/fx.functions";
import { useState, type ReactNode } from "react";

const navGroups: { label: string; items: { to: string; label: string; icon: any; exact?: boolean }[] }[] = [
  {
    label: "Visão geral",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/transactions", label: "Transações", icon: Receipt },
      { to: "/projections", label: "Projeções", icon: TrendingUp },
    ],
  },
  {
    label: "Planejamento",
    items: [
      { to: "/budgets", label: "Orçamentos", icon: PiggyBank },
      { to: "/goals", label: "Metas", icon: Target },
      { to: "/recurrences", label: "Recorrências", icon: Repeat },
    ],
  },
  {
    label: "Configuração",
    items: [
      { to: "/credit-cards", label: "Cartões", icon: CreditCard },
      { to: "/accounts", label: "Contas", icon: Wallet },
      { to: "/categories", label: "Categorias", icon: FolderTree },
      { to: "/rules", label: "Regras & IA", icon: Sparkles },
      { to: "/import", label: "Importar CSV", icon: Upload },
    ],
  },
];

const flatNav = navGroups.flatMap((g) => g.items);

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const fetchFx = useServerFn(getLatestUsdBrl);
  const { data: fx } = useQuery({
    queryKey: ["fx", "USDBRL"],
    queryFn: () => fetchFx(),
    staleTime: 1000 * 60 * 60,
  });

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to);

  const currentTitle =
    flatNav.find((n) => isActive(n.to, n.exact))?.label ?? "My Global Money";

  const initials = (user?.email ?? "?")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  const Sidebar = (
    <>
      <div className="px-5 py-5 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div
            className="h-9 w-9 rounded-xl grid place-items-center shadow-sm ring-1 ring-black/5"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Leaf className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-[15px]">My Global Money</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Finance OS
            </div>
          </div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              {group.label}
            </div>
            {group.items.map((n) => {
              const active = isActive(n.to, n.exact);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setMobileOpen(false)}
                  className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
                  )}
                  <n.icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.25 : 2} />
                  <span className="truncate">{n.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="p-3 border-t border-sidebar-border space-y-3">
        {fx && (
          <div className="px-3 py-2.5 rounded-lg bg-sidebar-accent/40 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>USD/BRL</span>
              <span className="text-[10px]">{fx.date}</span>
            </div>
            <div className="font-semibold text-sm mt-0.5 tabular-nums">R$ {fx.rate.toFixed(4)}</div>
          </div>
        )}
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-sidebar-accent/40 transition-colors">
          <div className="h-8 w-8 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{user?.email}</div>
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/login" });
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <LogOut className="h-3 w-3" /> Sair
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-64 flex-col border-r border-sidebar-border bg-sidebar sticky top-0 h-screen">
        {Sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex w-72 max-w-[85vw] flex-col bg-sidebar border-r border-sidebar-border shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md hover:bg-sidebar-accent/60"
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </button>
            {Sidebar}
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 px-4 md:px-8 h-14 border-b border-border bg-background/80 backdrop-blur-md">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden h-9 w-9 grid place-items-center rounded-md hover:bg-muted"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm md:text-base font-semibold tracking-tight truncate">
              {currentTitle}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {fx && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs tabular-nums">
                <span className="text-muted-foreground">USD/BRL</span>
                <span className="font-semibold">{fx.rate.toFixed(4)}</span>
              </div>
            )}
          </div>
        </header>
        <div className="flex-1 p-4 md:p-8 max-w-[1400px] w-full mx-auto">{children}</div>
      </main>
    </div>
  );
}