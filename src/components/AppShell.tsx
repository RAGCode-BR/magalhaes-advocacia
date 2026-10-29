import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  ListChecks,
  Users,
  Building2,
  Settings,
  LogOut,
  Moon,
  Sun,
  PanelLeft,
  BarChart3,
  Trash2,
  PanelsTopLeft,
  CalendarDays,
  CalendarCog,
  CircleDollarSign,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  MessagesSquare,
  Layers3,
  Handshake,
  ContactRound,
  Sparkles,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { UpdateCenter } from "@/components/UpdateCenter";
import { RecurringMeetingReminderPopup } from "@/components/RecurringMeetingReminderPopup";
import { AssignmentPopup } from "@/components/AssignmentPopup";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isLocalDatabase } from "@/integrations/supabase/client";
import { BrandLogo, BrandWordmark } from "@/components/BrandLogo";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useAnimationControls } from "motion/react";
import { TOP_NAV_ITEM_CLASS, TopNavBadge, TopNavItemContent } from "@/components/TopNavItem";
import {
  OPEN_OVERLAY_SELECTOR,
  adjacentScreenIndex,
  isArrowNavigationBlocked,
} from "@/lib/keyboard-screen-nav";
import { useMuralUnreadCount } from "@/hooks/use-mural-unread";
import { useMuralLaunchDigest } from "@/hooks/use-mural-launch-digest";
import { useMuralRealtime } from "@/hooks/use-mural-realtime";
import {
  useTaskConversationsUnread,
  useTaskConversationRealtime,
} from "@/hooks/use-task-conversations";
import { WorkspaceLoadingScreen } from "@/components/WorkspaceLoadingScreen";
import { useHasInvitedMeeting } from "@/hooks/use-meetings";
import { ClientsNavGroup } from "@/components/ClientsNavGroup";
import { AskClaudeButton } from "@/components/AskClaudeButton";
import { neonAuthIssuer } from "@/lib/claude-connector";

const TOPBAR_SPRING = { type: "spring", bounce: 0.12, duration: 0.5 } as const;
// The screen name slides in from the side the user is moving to.
const SCREEN_FLASH_VARIANTS = {
  enter: (direction: 1 | -1) => ({ x: direction * 16, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: 1 | -1) => ({ x: direction * -16, opacity: 0 }),
};

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean };
const allNav: readonly NavItem[] = [
  { to: "/mural", label: "Mural", icon: MessageSquareText },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tasks", label: "Gestão de processos", icon: ListChecks },
  { to: "/conversations", label: "Conversas", icon: MessagesSquare },
  { to: "/obligations", label: "Obrigações", icon: CalendarCog },
  { to: "/meetings", label: "Reuniões", icon: Handshake },
  { to: "/clients", label: "Clientes", icon: Building2 },
  { to: "/crm", label: "CRM", icon: ContactRound },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/portal", label: "Portal do Cliente", icon: PanelsTopLeft },
  { to: "/users", label: "Usuários", icon: Users, adminOnly: true },
  { to: "/trash", label: "Lixeira", icon: Trash2 },
  { to: "/claude", label: "Claude", icon: Sparkles },
  { to: "/settings", label: "Personalizar", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const {
    profile,
    user,
    signOut,
    isAdmin,
    isClient,
    hasPermission,
    workspaces,
    activeWorkspace,
    isWorkspaceTransitioning,
  } = useAuth();
  const muralUnreadCount = useMuralUnreadCount();
  // Resumo da atividade leve do mural desde a última visita — em qualquer
  // tela, uma vez por carregamento do sistema.
  useMuralLaunchDigest();
  // Atividade do mural ao vivo em qualquer tela (avisos + cache fresco).
  useMuralRealtime();
  const conversationsUnread = useTaskConversationsUnread();
  useTaskConversationRealtime();
  const canAccessDeliveries = hasPermission("portal_entregas") || hasPermission("portal");
  const canAccessFinance = hasPermission("portal_financeiro") || hasPermission("portal");
  const { data: hasInvitedMeeting = false } = useHasInvitedMeeting();
  const canSwitchEnvironments = false;
  const nav = useMemo(() => {
    const accessByPath: Record<string, string> = {
      "/dashboard": "dashboard",
      "/tasks": "tasks",
      "/conversations": "conversations",
      "/obligations": "obligations",
      "/meetings": "meetings",
      "/import-ata": "import_ata",
      "/clients": "clients",
      "/crm": "crm",
      "/reports": "reports",
      "/mural": "mural",
      "/agenda": "agenda",
      "/users": "users",
      "/trash": "trash",
      "/settings": "settings",
    };
    return allNav.filter((item) => {
      if (item.to === "/settings") return true;
      // Every team member may connect their own Claude; client portal accounts may not.
      if (item.to === "/claude") return !isClient;
      if (item.to === "/portal") return canAccessDeliveries || canAccessFinance;
      if (item.to === "/meetings" && hasInvitedMeeting) return true;
      return (!item.adminOnly || isAdmin) && hasPermission(accessByPath[item.to]);
    });
  }, [canAccessDeliveries, canAccessFinance, hasInvitedMeeting, isAdmin, isClient, hasPermission]);

  const { theme, toggle } = useTheme();
  const [topbarHidden, setTopbarHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("topbar-hidden") === "true";
    } catch {
      return false;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("topbar-hidden", String(topbarHidden));
    } catch {
      // The bar still toggles for this visit when storage is unavailable.
    }
  }, [topbarHidden]);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const initials = (profile?.full_name || user?.email || "?").slice(0, 2).toUpperCase();
  const unreadTotal = muralUnreadCount + conversationsUnread;

  // With the bar minimized, ← and → walk through the menu screens in order.
  const navigate = useNavigate();
  const screens = useMemo(
    () =>
      nav.map((n) =>
        n.to === "/portal"
          ? { to: canAccessDeliveries ? "/portal/entregas" : "/portal/financeiro", match: "/portal/", label: n.label, icon: n.icon }
          : { to: n.to, match: n.to, label: n.label, icon: n.icon },
      ),
    [nav, canAccessDeliveries],
  );
  const [screenFlash, setScreenFlash] = useState<{
    label: string;
    icon: NavItem["icon"];
    direction: 1 | -1;
    id: number;
  } | null>(null);
  const edgeBump = useAnimationControls();
  useEffect(() => {
    if (!topbarHidden) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      if (isArrowNavigationBlocked(event, document.querySelector(OPEN_OVERLAY_SELECTOR) != null)) return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const index = adjacentScreenIndex(pathname, screens.map((screen) => screen.match), direction);
      event.preventDefault();
      if (index === null) {
        // First/last screen: a short elastic nudge says there is nothing further.
        void edgeBump.start({
          x: [0, direction * 10, direction * -3, 0],
          transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] },
        });
        return;
      }
      const screen = screens[index];
      void navigate({ to: screen.to });
      setScreenFlash({ label: screen.label, icon: screen.icon, direction, id: Date.now() });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [edgeBump, navigate, pathname, screens, topbarHidden]);
  useEffect(() => {
    if (!screenFlash) return;
    const timer = window.setTimeout(() => setScreenFlash(null), 1600);
    return () => window.clearTimeout(timer);
  }, [screenFlash]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-dvh flex-col overflow-hidden app-canvas">
      {/* Desktop top bar. Hiding it shrinks the whole bar into a floating glass
          pill with the firm's logo; clicking the logo grows it back. */}
      <span className="sr-only" aria-live="polite">
        {screenFlash ? `Tela: ${screenFlash.label}` : ""}
      </span>
      <motion.div
        className="relative z-40 hidden shrink-0 md:block"
        initial={false}
        animate={{ height: topbarHidden ? 54 : 56 }}
        transition={TOPBAR_SPRING}
      >
        <motion.div
          animate={edgeBump}
          className={`absolute inset-x-0 top-0 flex ${topbarHidden ? "pointer-events-none justify-center pt-[3px]" : ""}`}
        >
          <motion.header
            layout
            initial={false}
            transition={TOPBAR_SPRING}
            animate={{ borderRadius: topbarHidden ? 24 : 0 }}
            className={`glass-wine pointer-events-auto flex items-center overflow-hidden ${
              topbarHidden ? "h-12 gap-2 pl-3.5 pr-2" : "h-14 w-full gap-3 px-3 lg:px-4"
            }`}
          >
            <motion.div
              layout
              transition={TOPBAR_SPRING}
              role={topbarHidden ? "button" : undefined}
              tabIndex={topbarHidden ? 0 : undefined}
              aria-label={topbarHidden ? "Mostrar barra de navegação. Use as setas esquerda e direita para trocar de tela." : undefined}
              title={topbarHidden ? "Mostrar barra · use ← → para trocar de tela" : undefined}
              onClick={topbarHidden ? () => setTopbarHidden(false) : undefined}
              onKeyDown={
                topbarHidden
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setTopbarHidden(false);
                      }
                    }
                  : undefined
              }
              className={`group/logo flex shrink-0 items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${topbarHidden ? "cursor-pointer" : ""}`}
            >
              <BrandWordmark className={`brand-glow ${topbarHidden ? "h-10" : "h-[50px]"}`} />
              <AnimatePresence initial={false} mode="popLayout" custom={screenFlash?.direction ?? 1}>
                {topbarHidden && screenFlash && (
                  <motion.span
                    key={screenFlash.id}
                    layout
                    custom={screenFlash.direction}
                    variants={SCREEN_FLASH_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={TOPBAR_SPRING}
                    className="topnav-pill flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full pl-2 pr-2.5 text-[13px] font-semibold leading-none tracking-[-0.01em] text-sidebar-foreground"
                  >
                    <screenFlash.icon className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" />
                    {screenFlash.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {topbarHidden && (
                <motion.span
                  layout="position"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }}
                  className="relative grid h-6 w-6 place-items-center rounded-full bg-white/10 text-sidebar-foreground/80 transition group-hover/logo:translate-y-0.5 group-hover/logo:bg-white/20"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {unreadTotal > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-400 ring-2 ring-[#4a1418]" aria-label="Há itens não lidos" />
                  )}
                </motion.span>
              )}
              {!topbarHidden && isLocalDatabase && (
                <span className="hidden rounded-full border border-sidebar-primary/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-sidebar-primary xl:inline">
                  Local
                </span>
              )}
            </motion.div>
            <AnimatePresence initial={false} mode="popLayout">
              {!topbarHidden && (
                <motion.div
                  key="topbar-content"
                  layout="position"
                  className="flex min-w-0 flex-1 items-center gap-3"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0, transition: { delay: 0.22, duration: 0.25 } }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                <span className="h-6 w-px shrink-0 bg-sidebar-foreground/15" aria-hidden="true" />
                <TooltipProvider delayDuration={150}>
                  <LayoutGroup id="top-nav">
                    <nav
                      aria-label="Navegação principal"
                      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {nav.map((n) => {
                        if (n.to === "/clients") return <ClientsNavGroup key={`${activeWorkspace?.id}:clients`} expanded={false} active={pathname.startsWith("/clients")} />;
                        if (n.to === "/portal")
                          return (
                            <PortalNavGroup
                              key={n.to}
                              expanded={false}
                              active={pathname.startsWith("/portal/")}
                              pathname={pathname}
                              canAccessDeliveries={canAccessDeliveries}
                              canAccessFinance={canAccessFinance}
                            />
                          );
                        const active = pathname === n.to || pathname.startsWith(n.to + "/");
                        const badge =
                          n.to === "/mural" ? (
                            <TopNavBadge count={muralUnreadCount} />
                          ) : n.to === "/conversations" ? (
                            <TopNavBadge count={conversationsUnread} tone="info" />
                          ) : undefined;
                        return (
                          <Tooltip key={n.to}>
                            <TooltipTrigger asChild>
                              <Link to={n.to} className={TOP_NAV_ITEM_CLASS} aria-current={active ? "page" : undefined}>
                                <TopNavItemContent active={active} icon={n.icon} label={n.label} badge={badge} />
                              </Link>
                            </TooltipTrigger>
                            {!active && <TooltipContent side="bottom">{n.label}</TooltipContent>}
                          </Tooltip>
                        );
                      })}
                    </nav>
                  </LayoutGroup>
                </TooltipProvider>
                <div className="glass-wine-actions flex shrink-0 items-center gap-1">
                  <UpdateCenter />
                  {canSwitchEnvironments && workspaces.length > 1 && (
                    <Button
                      asChild
                      variant="ghost"
                      className="h-9 gap-2 rounded-full px-3 text-sm"
                      title="Trocar ambiente"
                    >
                      <Link to="/ambientes">
                        <Layers3 className="h-4 w-4" />
                        <span>{activeWorkspace?.name ?? "Ambiente"}</span>
                      </Link>
                    </Button>
                  )}
                  <NotificationBell />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full p-0.5 outline-none ring-1 ring-sidebar-primary/40 transition hover:ring-sidebar-primary focus-visible:ring-2"
                        aria-label="Conta e preferências"
                        title={profile?.full_name || user?.email || "Conta"}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage
                            src={profile?.avatar_url || undefined}
                            alt={profile?.full_name || user?.email || "Usuário"}
                          />
                          <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={10} className="w-64 rounded-2xl p-1.5">
                      <div className="px-2 py-1.5">
                        <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => toggle()}>
                        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        {theme === "dark" ? "Modo claro" : "Modo escuro"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setTopbarHidden(true)}>
                        <ChevronUp className="h-4 w-4" />
                        Ocultar barra
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void signOut()}>
                        <LogOut className="h-4 w-4" />
                        Sair
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full text-sidebar-foreground/75"
                    onClick={() => setTopbarHidden(true)}
                    aria-label="Ocultar barra de navegação"
                    title="Ocultar barra para ganhar espaço"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.header>
        </motion.div>
      </motion.div>

      {/* Mobile sidebar toggle header */}
      <div className="glass-wine glass-wine-actions fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-2 px-3 md:hidden">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Abrir menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <PanelLeft className="h-5 w-5" />
        </Button>
        <span className="min-w-0 truncate font-semibold">Magalhães Advocacia</span>
        <div className="flex shrink-0 items-center gap-1">
          <UpdateCenter />
          {canSwitchEnvironments && workspaces.length > 1 && (
            <Button asChild variant="ghost" size="icon" title="Trocar ambiente">
              <Link to="/ambientes">
                <Layers3 className="h-5 w-5" />
              </Link>
            </Button>
          )}
          <NotificationBell />
        </div>
      </div>

      {/* Mobile overlay sidebar */}
      <div
        className={`fixed inset-0 z-50 flex md:hidden ${mobileMenuOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!mobileMenuOpen}
        inert={!mobileMenuOpen}
      >
          <div
            className={`flex w-[min(18rem,calc(100vw-3rem))] min-w-0 flex-col border-r bg-background transition-transform duration-300 ease-in-out motion-reduce:transition-none ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
            style={{ background: "var(--gradient-sidebar)" }}
          >
            <div className="px-5 py-4">
              <div className="flex flex-col items-center gap-3">
                <BrandLogo className="h-28 w-full max-w-60" />
                {isLocalDatabase && <span className="text-xs uppercase tracking-widest">Ambiente local de testes</span>}
              </div>
            </div>
            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
              {nav.map((n) => {
                if (n.to === "/clients") return <ClientsNavGroup key={`${activeWorkspace?.id}:clients-mobile`} expanded active={pathname.startsWith('/clients')} onNavigate={() => setMobileMenuOpen(false)} />;
                if (n.to === "/portal")
                  return (
                    <PortalNavGroup
                      key={n.to}
                      expanded
                      active={pathname.startsWith("/portal/")}
                      pathname={pathname}
                      canAccessDeliveries={canAccessDeliveries}
                      canAccessFinance={canAccessFinance}
                      onNavigate={() => setMobileMenuOpen(false)}
                    />
                  );
                const Active = pathname === n.to || pathname.startsWith(n.to + "/");
                const Icon = n.icon;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm transition ${
                      Active
                        ? "border border-sidebar-primary bg-sidebar/45 text-sidebar-foreground font-medium shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"
                    }`}
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center ${Active ? "rounded-full bg-sidebar-primary text-sidebar-primary-foreground" : ""}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {n.label}
                    {n.to === "/mural" && muralUnreadCount > 0 && (
                      <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {muralUnreadCount > 99 ? "99+" : muralUnreadCount}
                      </span>
                    )}
                    {n.to === "/conversations" && conversationsUnread > 0 && (
                      <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#142e63] px-1 text-[10px] font-bold text-white shadow-sm">
                        {conversationsUnread > 99 ? "99+" : conversationsUnread}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-sidebar-border p-3">
              <div className="flex items-center gap-3 rounded-lg p-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={profile?.avatar_url || undefined}
                    alt={profile?.full_name || user?.email || "Usuário"}
                  />
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {profile?.full_name || user?.email}
                  </p>
                  <p className="truncate text-xs text-sidebar-foreground/60">{user?.email}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={toggle}
                  title={theme === "dark" ? "Modo claro" : "Modo escuro"}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  aria-label="Fechar menu"
                  title="Fechar menu"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={signOut}
                  title="Sair"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div
            className={`min-w-0 flex-1 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ease-in-out motion-reduce:transition-none ${mobileMenuOpen ? "opacity-100" : "opacity-0"}`}
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>

      <RecurringMeetingReminderPopup />
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
      <AssignmentPopup />
      {!isClient && neonAuthIssuer() && <AskClaudeButton />}
      {isWorkspaceTransitioning && <WorkspaceLoadingScreen workspaceName={activeWorkspace?.name} />}
    </div>
    </MotionConfig>
  );
}

function PortalNavGroup({
  expanded,
  active,
  pathname,
  canAccessDeliveries,
  canAccessFinance,
  onNavigate,
}: {
  expanded: boolean;
  active: boolean;
  pathname: string;
  canAccessDeliveries: boolean;
  canAccessFinance: boolean;
  onNavigate?: () => void;
}) {
  const deliveriesActive = pathname.startsWith("/portal/entregas");
  const financeActive = pathname.startsWith("/portal/financeiro");

  if (!expanded)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" title="Portal do Cliente" className={TOP_NAV_ITEM_CLASS}>
            <TopNavItemContent active={active} icon={PanelsTopLeft} label="Portal do Cliente" />
            <ChevronDown className="relative ml-1 h-3 w-3 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" sideOffset={10} className="min-w-56 rounded-2xl p-1.5">
          {canAccessDeliveries && (
            <DropdownMenuItem asChild>
              <Link
                to="/portal/entregas"
                className={deliveriesActive ? "bg-primary/10 text-primary" : ""}
              >
                <CalendarCog className="h-4 w-4" />
                Calendário de Entregas
              </Link>
            </DropdownMenuItem>
          )}
          {canAccessFinance && (
            <DropdownMenuItem asChild>
              <Link
                to="/portal/financeiro"
                className={financeActive ? "bg-primary/10 text-primary" : ""}
              >
                <CircleDollarSign className="h-4 w-4" />
                Financeiro
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  return (
    <Collapsible defaultOpen={active} className="space-y-1">
      <CollapsibleTrigger
        className={`flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm transition ${active ? "bg-sidebar-primary/10 text-sidebar-primary font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"}`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center">
          <PanelsTopLeft className="h-4 w-4" />
        </span>
        <span className="flex-1 text-left">Portal do Cliente</span>
        <ChevronDown className="h-4 w-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="relative ml-6 space-y-1 border-l border-sidebar-primary/25 pl-3">
        {canAccessDeliveries && (
          <Link
            to="/portal/entregas"
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm transition ${deliveriesActive ? "border border-sidebar-primary bg-sidebar/45 text-sidebar-foreground font-medium shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"}`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center ${deliveriesActive ? "rounded-full bg-sidebar-primary text-sidebar-primary-foreground" : ""}`}
            >
              <CalendarCog className="h-4 w-4" />
            </span>
            Calendário de Entregas
          </Link>
        )}
        {canAccessFinance && (
          <Link
            to="/portal/financeiro"
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm transition ${financeActive ? "border border-sidebar-primary bg-sidebar/45 text-sidebar-foreground font-medium shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground"}`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center ${financeActive ? "rounded-full bg-sidebar-primary text-sidebar-primary-foreground" : ""}`}
            >
              <CircleDollarSign className="h-4 w-4" />
            </span>
            Financeiro
          </Link>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
