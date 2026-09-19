"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function OrdersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M7 6.75h10" strokeLinecap="round" />
      <path d="M7 12h10" strokeLinecap="round" />
      <path d="M7 17.25h6.5" strokeLinecap="round" />
      <path d="M4.75 6.75h.5" strokeLinecap="round" />
      <path d="M4.75 12h.5" strokeLinecap="round" />
      <path d="M4.75 17.25h.5" strokeLinecap="round" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M12 3.5 19.5 7v10L12 20.5 4.5 17V7L12 3.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 7 12 11l7.5-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11v9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M5 19V10" strokeLinecap="round" />
      <path d="M12 19V5" strokeLinecap="round" />
      <path d="M19 19v-7" strokeLinecap="round" />
      <path d="M4 19.5h16" strokeLinecap="round" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M7 3.5h8l3 3V20.5H7V3.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3.5v3h3M10 11h5M10 15h5" strokeLinecap="round" />
    </svg>
  );
}

function ClaimIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M12 3.5 21 19H3L12 3.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 9v4.5M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
      <path d="M5 5.5h14v13H5v-13Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 9h7M8.5 12.5h4M15.5 15.5h.01" strokeLinecap="round" />
    </svg>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const [openClaimCount, setOpenClaimCount] = useState(0);

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
        // Keep navigation usable when the notification request is temporarily unavailable.
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

  if (pathname === "/login") return null;

  const mobileItems = [
    { href: "/", label: "Narudzbe", icon: <OrdersIcon />, active: pathname === "/" || pathname === "/orders" },
    { href: "/in-transit", label: "Na dostavi", icon: <BoxIcon />, active: pathname === "/in-transit" || pathname === "/undelivered" },
    { href: "/reklamacije", label: "Reklamacije", icon: <ClaimIcon />, active: pathname.startsWith("/reklamacije") },
    { href: "/receipts", label: "Računi", icon: <ReceiptIcon />, active: pathname === "/receipts" },
    { href: "/fakture", label: "Fakture", icon: <InvoiceIcon />, active: pathname.startsWith("/fakture") },
    { href: "/stats", label: "Statistika", icon: <ChartIcon />, active: pathname.startsWith("/stats") },
  ];

  const desktopItems = [
    { href: "/", label: "Pregled", icon: <OrdersIcon />, active: pathname === "/" },
    { href: "/orders", label: "Nove narudžbe", icon: <OrdersIcon />, active: pathname === "/orders" },
    { href: "/in-transit", label: "Na dostavi", icon: <BoxIcon />, active: pathname === "/in-transit" },
    { href: "/returns", label: "Povrati", icon: <BoxIcon />, active: pathname === "/returns" },
    { href: "/reklamacije", label: "Reklamacije", icon: <ClaimIcon />, active: pathname.startsWith("/reklamacije") },
    { href: "/receipts", label: "Računi", icon: <ReceiptIcon />, active: pathname === "/receipts" },
    { href: "/fakture", label: "Fakture", icon: <InvoiceIcon />, active: pathname.startsWith("/fakture") },
    { href: "/stats", label: "Statistika", icon: <ChartIcon />, active: pathname.startsWith("/stats") },
  ];

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md px-4 pb-4 sm:max-w-lg sm:px-5 lg:hidden">
        {openClaimCount > 0 ? (
          <Link
            href="/reklamacije"
            className="mb-2 flex min-h-10 items-center justify-between rounded-lg border border-red-300/25 bg-[#2a1115]/95 px-3 py-2 text-xs font-semibold text-red-100 shadow-lg shadow-black/30 backdrop-blur-xl"
          >
            <span>Otvorene reklamacije</span>
            <span className="rounded-full bg-red-300 px-2 py-0.5 text-[11px] text-neutral-950">{openClaimCount}</span>
          </Link>
        ) : null}
        <div className="mx-auto grid grid-cols-6 gap-1 rounded-[1.75rem] border border-white/10 bg-[#111214]/95 p-2 shadow-[0_20px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          {mobileItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={`relative flex min-w-0 flex-col items-center justify-center rounded-[1.2rem] px-1 py-2.5 transition ${
                item.active
                  ? "bg-white/[0.06] text-neutral-100"
                  : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200"
              }`}
            >
              {item.icon}
              {item.href === "/reklamacije" && openClaimCount > 0 ? (
                <span className="absolute right-1.5 top-1 rounded-full bg-red-300 px-1.5 py-0.5 text-[9px] font-bold leading-none text-neutral-950">{openClaimCount}</span>
              ) : null}
              <span className="mt-1 whitespace-nowrap text-[8px] font-medium sm:text-[9px]">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-white/10 bg-[#0d0e10]/95 px-4 py-5 backdrop-blur-xl lg:flex lg:flex-col">
        <Link href="/" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white">Galago Admin</p>
          <span className="mt-3 flex items-center gap-2 text-xs text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.85)]" />
            Live and listening
          </span>
        </Link>

        {openClaimCount > 0 ? (
          <Link
            href="/reklamacije"
            className="mt-3 flex min-h-11 items-center justify-between rounded-lg border border-red-300/25 bg-red-300/[0.09] px-3 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-300/[0.14]"
          >
            <span>Otvorene reklamacije</span>
            <span className="rounded-full bg-red-300 px-2 py-0.5 text-xs text-neutral-950">{openClaimCount}</span>
          </Link>
        ) : null}

        <nav className="mt-6 flex flex-col gap-1.5" aria-label="Glavna navigacija">
          {desktopItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={`relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                item.active
                  ? "bg-white/[0.08] text-white"
                  : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"
              }`}
            >
              <span className={item.active ? "text-sky-300" : "text-neutral-500"}>{item.icon}</span>
              <span>{item.label}</span>
              {item.href === "/reklamacije" && openClaimCount > 0 ? (
                <span className="ml-auto rounded-full bg-red-300 px-2 py-0.5 text-[10px] font-bold text-neutral-950">{openClaimCount}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        <p className="mt-auto px-3 text-[10px] uppercase tracking-[0.18em] text-neutral-600">Google Sheets control panel</p>
      </aside>
    </>
  );
}
