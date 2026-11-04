"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic,
  Plus,
  Settings,
  ShoppingBag,
  Store,
  UserRound,
  UserSearch,
  Wrench,
} from "lucide-react";
import { MilestoneToasts } from "@/components/milestones";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/diagnostics", label: "Diagnostics", icon: FlaskConical },
  { href: "/reports", label: "Repair Reports", icon: FileText },
  { href: "/parts", label: "Parts Advisor", icon: ShoppingBag },
  { href: "/voice", label: "Voice Guidance", icon: Mic },
  { href: "/technicians", label: "Find a Technician", icon: UserSearch },
  { href: "/shop", label: "Shop Workspace", icon: Store },
  { href: "/knowledge", label: "Knowledge Centre", icon: BookOpen },
];

const SECONDARY_NAV = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/profile", label: "Profile", icon: UserRound },
];

function NavList({ onNavigate }: { onNavigate: (href: string) => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      <ul className="flex flex-col gap-1" role="list">
        {PRIMARY_NAV.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              onClick={() => onNavigate(href)}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(href)
                  ? "bg-cyan-400/10 font-medium text-cyan-200"
                  : "text-slate-300 hover:bg-panel hover:text-slate-100",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <div>
        <Separator className="mb-3" />
        <ul className="flex flex-col gap-1" role="list">
          {SECONDARY_NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={() => onNavigate(href)}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive(href)
                    ? "bg-cyan-400/10 font-medium text-cyan-200"
                    : "text-slate-300 hover:bg-panel hover:text-slate-100",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Authenticated application chrome: sidebar navigation, topbar with
 * New Diagnosis action and profile menu, mobile drawer. Redirects
 * signed-out visitors to /login (demo stays public at /demo).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signed-out") {
      router.push("/login");
    }
  }, [status, router]);

  // Instant navigation feedback: mark the target the moment a nav
  // link is clicked so slow transitions (dev compile, slow
  // networks) never look like a dead click. Clears when the route
  // commits, or after a fallback timeout if it never does.
  const beginNavigate = useCallback(
    (href: string) => {
      setPendingHref((current) => (href === pathname ? current : href));
    },
    [pathname],
  );

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) {
      return;
    }
    const timer = setTimeout(() => setPendingHref(null), 15000);
    return () => clearTimeout(timer);
  }, [pendingHref]);

  if (status === "loading") {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6" role="status" aria-label="Loading">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (status === "signed-out") {
    return null;
  }

  const doSignOut = () => {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    void signOut().then(() => router.push("/"));
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-cyan-400 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-950"
      >
        Skip to content
      </a>
      {pendingHref && (
        <div
          className="fixed inset-x-0 top-0 z-[70] h-0.5 bg-cyan-400/80 animate-pulse"
          role="status"
          aria-label="Loading page"
        />
      )}

      <aside className="hidden border-r border-edge bg-panel/40 lg:block" aria-label="Application">
        <div className="sticky top-0 flex h-screen flex-col gap-4 overflow-y-auto p-4">
          <Link href="/dashboard" className="flex items-center gap-2.5 px-1" aria-label="FieldFix AI home">
            <span className="flex size-8 items-center justify-center rounded-md border border-edge bg-panel">
              <Wrench className="size-4 text-cyan-300" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-50">
              FieldFix AI
            </span>
          </Link>
          <NavList onNavigate={beginNavigate} />
          <div className="mt-auto">
            <Button type="button" className="w-full" asChild>
              <Link href="/diagnostics/new">
                <Plus aria-hidden />
                New Diagnosis
              </Link>
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-edge bg-canvas/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[100rem] items-center gap-2 px-4 py-2.5 sm:px-6">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>FieldFix AI</SheetTitle>
                <SheetDescription className="sr-only">
                  Application navigation.
                </SheetDescription>
                <div className="mt-4">
                  <NavList
                    onNavigate={(href) => {
                      setDrawerOpen(false);
                      beginNavigate(href);
                    }}
                  />
                </div>
                <div className="mt-4">
                  <Button type="button" className="w-full" asChild>
                    <Link href="/diagnostics/new" onClick={() => setDrawerOpen(false)}>
                      <Plus aria-hidden />
                      New Diagnosis
                    </Link>
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            <span className="flex items-center gap-2 lg:hidden">
              <Wrench className="size-4 text-cyan-300" aria-hidden />
              <span className="text-sm font-semibold text-slate-50">FieldFix AI</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="sm:hidden"
                asChild
                aria-label="New Diagnosis"
              >
                <Link href="/diagnostics/new">
                  <Plus aria-hidden />
                </Link>
              </Button>
              <NotificationBell />
              <Link
                href="/profile"
                className="hidden items-center gap-2 rounded-md text-sm text-slate-300 transition-colors hover:text-slate-100 sm:flex"
                aria-label="My profile"
              >
                <span className="flex size-7 items-center justify-center rounded-full border border-edge bg-panel text-xs font-semibold text-cyan-200">
                  {(user?.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-32 truncate">{user?.name}</span>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={doSignOut}
                disabled={signingOut}
                aria-label="Sign out"
              >
                <LogOut aria-hidden />
                <span className="hidden sm:inline">{signingOut ? "…" : "Sign out"}</span>
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main id="app-main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <MilestoneToasts />
    </div>
  );
}
