"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Megaphone,
  Menu,
  Package,
  PackageX,
  TriangleAlert,
  Warehouse,
  X,
} from "lucide-react";

const navigationItems = [
  { href: "/", label: "Pregled", icon: LayoutDashboard },
  { href: "/orders", label: "Nove narudžbe", icon: ClipboardList },
  { href: "/in-transit", label: "Na dostavi", icon: Package },
  { href: "/returns", label: "Povrati", icon: PackageX },
  { href: "/reklamacije", label: "Reklamacije", icon: TriangleAlert },
  { href: "/receipts", label: "Računi", icon: FileText },
  { href: "/inventory", label: "Lager", icon: Warehouse },
  { href: "/stats", label: "Statistika", icon: BarChart3 },
  // A fresh URL bypasses the temporary host's old, unpurged static HTML entry.
  { href: "/reklame?view=live", label: "Reklame", icon: Megaphone },
];

export function AppNavigation() {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openClaimCount, setOpenClaimCount] = useState(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuOpen = openPath === pathname;
  const isActive = (href: string) => {
    const path = href.split("?")[0];
    return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
  };
  const activeLabel = navigationItems.find((item) => isActive(item.href))?.label || "Pregled";

  useEffect(() => {
    if (pathname === "/login") return;

    let active = true;
    async function refreshClaimCount() {
      try {
        const response = await fetch("/api/reklamacije/notifications", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { openClaimCount?: number };
        if (active) setOpenClaimCount(Math.max(0, Number(payload.openClaimCount) || 0));
      } catch {
        // Navigation remains usable if notifications are unavailable.
      }
    }

    refreshClaimCount();
    const interval = window.setInterval(refreshClaimCount, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshClaimCount();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPath(null);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  if (pathname === "/login") return null;

  function closeMenu() {
    setOpenPath(null);
    menuButtonRef.current?.focus();
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d0e10]/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-3 px-4 sm:px-5">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpenPath(pathname)}
            aria-label="Otvori meni"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            title="Meni"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-neutral-100"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase text-neutral-500">Galago Admin</p>
            <p className="truncate text-sm font-semibold text-white">{activeLabel}</p>
          </div>
          {openClaimCount > 0 ? (
            <Link
              href="/reklamacije"
              aria-label={`Otvorene reklamacije: ${openClaimCount}`}
              title="Otvorene reklamacije"
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-red-300/25 bg-red-300/10 px-2.5 text-red-100"
            >
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-bold">{openClaimCount}</span>
            </Link>
          ) : null}
        </div>
      </header>

      {menuOpen ? (
        <>
          <button type="button" onClick={closeMenu} aria-label="Zatvori meni" className="fixed inset-0 z-40 bg-black/70 lg:hidden" />
          <nav
            id="mobile-navigation"
            aria-label="Glavna navigacija"
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col overflow-y-auto border-r border-white/10 bg-[#111214] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl lg:hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <span className="text-sm font-semibold text-white">Galago Admin</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMenu}
                aria-label="Zatvori meni"
                title="Zatvori meni"
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-neutral-200"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {openClaimCount > 0 ? (
              <Link href="/reklamacije" onClick={() => setOpenPath(null)} className="mt-4 flex min-h-11 items-center justify-between rounded-lg border border-red-300/25 bg-red-300/10 px-3 text-sm font-semibold text-red-100">
                <span>Otvorene reklamacije</span>
                <span className="rounded-full bg-red-300 px-2 py-0.5 text-xs text-neutral-950">{openClaimCount}</span>
              </Link>
            ) : null}

            <div className="mt-4 flex flex-col gap-1">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpenPath(null)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active ? "bg-white/[0.09] text-white" : "text-neutral-300 hover:bg-white/[0.05]"}`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${active ? "text-sky-300" : "text-neutral-500"}`} aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/reklamacije" && openClaimCount > 0 ? (
                      <span className="rounded-full bg-red-300 px-2 py-0.5 text-xs font-bold text-neutral-950">{openClaimCount}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
            <p className="mt-auto pt-6 text-[11px] text-neutral-600">Google Sheets control panel</p>
          </nav>
        </>
      ) : null}

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-white/10 bg-[#0d0e10]/95 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href="/" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4">
          <p className="text-xs font-semibold uppercase text-white">Galago Admin</p>
          <span className="mt-3 flex items-center gap-2 text-xs text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            Live and listening
          </span>
        </Link>

        {openClaimCount > 0 ? (
          <Link href="/reklamacije" className="mt-3 flex min-h-11 items-center justify-between rounded-lg border border-red-300/25 bg-red-300/[0.09] px-3 py-2.5 text-sm font-semibold text-red-100">
            <span>Otvorene reklamacije</span>
            <span className="rounded-full bg-red-300 px-2 py-0.5 text-xs text-neutral-950">{openClaimCount}</span>
          </Link>
        ) : null}

        <nav className="mt-6 flex flex-col gap-1.5" aria-label="Glavna navigacija">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active ? "bg-white/[0.08] text-white" : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"}`}>
                <Icon className={`h-5 w-5 shrink-0 ${active ? "text-sky-300" : "text-neutral-500"}`} aria-hidden="true" />
                <span>{item.label}</span>
                {item.href === "/reklamacije" && openClaimCount > 0 ? <span className="ml-auto rounded-full bg-red-300 px-2 py-0.5 text-[10px] font-bold text-neutral-950">{openClaimCount}</span> : null}
              </Link>
            );
          })}
        </nav>

        <p className="mt-auto px-3 text-[10px] uppercase text-neutral-600">Google Sheets control panel</p>
      </aside>
    </>
  );
}
