"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bell,
  BookOpen,
  Brain,
  FileText,
  FlaskConical,
  HeartPulse,
  Image,
  Inbox,
  LayoutDashboard,
  Menu,
  ScrollText,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "./admin-auth";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  capability: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, capability: "overview:view" }],
  },
  {
    title: "User management",
    items: [
      { href: "/admin/users", label: "Users", icon: Users, capability: "users:view" },
      { href: "/admin/technicians", label: "Technicians", icon: UserRound, capability: "users:view" },
      { href: "/admin/roles", label: "Roles & Permissions", icon: ShieldCheck, capability: "users:view" },
    ],
  },
  {
    title: "Diagnostics",
    items: [
      { href: "/admin/sessions", label: "Sessions", icon: FlaskConical, capability: "sessions:view" },
      { href: "/admin/reports", label: "Repair Reports", icon: FileText, capability: "sessions:view" },
      { href: "/admin/evidence", label: "Evidence", icon: Image, capability: "evidence:view" },
    ],
  },
  {
    title: "AI & Intelligence",
    items: [
      { href: "/admin/ai-usage", label: "AI Model Usage", icon: Brain, capability: "ai:view" },
      { href: "/admin/providers", label: "Providers", icon: Settings2, capability: "ai:view" },
      { href: "/admin/knowledge", label: "Knowledge Centre", icon: BookOpen, capability: "documents:view" },
      { href: "/admin/ingestion", label: "Document Ingestion", icon: Inbox, capability: "documents:view" },
      { href: "/admin/suppliers", label: "Parts Suppliers", icon: Store, capability: "suppliers:view" },
    ],
  },
  {
    title: "Safety & Quality",
    items: [
      { href: "/admin/safety", label: "Safety Incidents", icon: ShieldAlert, capability: "safety:view" },
      { href: "/admin/quality", label: "Diagnostic Quality", icon: Activity, capability: "overview:view" },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/admin/notifications", label: "Notifications", icon: Bell, capability: "notifications:view" },
      { href: "/admin/health", label: "System Health", icon: HeartPulse, capability: "health:view" },
      { href: "/admin/audit", label: "Audit Logs", icon: ScrollText, capability: "audit:view" },
      { href: "/admin/settings", label: "Platform Settings", icon: Settings, capability: "settings:view" },
    ],
  },
];

function NavList({ onNavigate, capabilities }: { onNavigate?: () => void; capabilities: string[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4 overflow-y-auto p-3" aria-label="Admin console">
      {NAV.map((group) => {
        const items = group.items.filter((i) => capabilities.includes(i.capability));
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={group.title}>
            <p className="px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              {group.title}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5" role="list">
              {items.map(({ href, label, icon: Icon }) => {
                const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "bg-cyan-400/10 text-slate-50"
                          : "text-slate-300 hover:bg-panel-elevated hover:text-slate-50",
                      )}
                    >
                      <Icon className={cn("size-4", active ? "text-cyan-300" : "text-slate-500")} aria-hidden />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SignInGate({ serverError }: { serverError: string | null }) {
  const mfaNeeded = serverError != null && /two-factor/i.test(serverError);

  return (
    <div className="mx-auto w-full max-w-sm rounded-xl border border-edge bg-panel p-5">
      <h1 className="flex items-center gap-2 text-base font-semibold text-slate-50">
        <ShieldCheck className="size-5 text-amber-300" aria-hidden />
        Admin console
      </h1>
      {mfaNeeded ? (
        <p role="alert" className="mt-2 text-sm text-amber-200">
          {serverError}{" "}
          <Link href="/profile#security" className="underline">
            Open Profile → Security to enroll
          </Link>
          , then return here.
        </p>
      ) : serverError ? (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {serverError} Sign in with an administrator account.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-400">
          The console requires an administrator account. Sign in, then return here.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="sm" asChild>
          <Link href="/login?next=/admin">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}

/** Console chrome: capability-filtered sidebar, actor header, sign-in gate. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { loading, me, error } = useAdminAuth();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-edge bg-panel lg:flex" aria-label="Console navigation">
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-canvas">
            <Wrench className="size-4 text-cyan-300" aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-50">Console</span>
          <Badge variant="warning">Admin</Badge>
        </div>
        {me ? (
          <NavList capabilities={me.capabilities} />
        ) : (
          <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading navigation">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-edge bg-canvas/95 backdrop-blur">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:px-6">
            <Sheet open={drawer} onOpenChange={setDrawer}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>Admin console</SheetTitle>
                <SheetDescription>Platform administration</SheetDescription>
                {me && (
                  <NavList capabilities={me.capabilities} onNavigate={() => setDrawer(false)} />
                )}
              </SheetContent>
            </Sheet>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/">
                <ArrowLeft aria-hidden />
                <span className="hidden sm:inline">App</span>
              </Link>
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {me && (
                <Badge variant="muted">
                  {me.actor_email} · {me.role.replace("_", " ")}
                </Badge>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:p-6">
          {loading && (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading console">
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-48" />
            </div>
          )}
          {!loading && !me && <SignInGate serverError={error} />}
          {!loading && me && children}
        </main>
      </div>
    </div>
  );
}
