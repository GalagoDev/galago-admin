import Link from "next/link";

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

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md px-4 pb-4 sm:max-w-lg sm:px-5">
      <div className="mx-auto grid grid-cols-3 gap-2 rounded-[1.75rem] border border-white/10 bg-[#111214]/95 p-2 shadow-[0_20px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <Link
          href="/"
          className="flex flex-col items-center justify-center rounded-[1.2rem] bg-white/[0.06] px-3 py-2.5 text-neutral-100"
        >
          <OrdersIcon />
          <span className="mt-1 text-[11px] font-medium">Narudzbe</span>
        </Link>

        <Link
          href="/undelivered"
          className="flex flex-col items-center justify-center rounded-[1.2rem] px-3 py-2.5 text-neutral-400 transition hover:bg-white/[0.04] hover:text-neutral-200"
        >
          <BoxIcon />
          <span className="mt-1 text-[11px] font-medium">Nedostavljene</span>
        </Link>

        <button
          type="button"
          className="flex flex-col items-center justify-center rounded-[1.2rem] px-3 py-2.5 text-neutral-400 transition hover:bg-white/[0.04] hover:text-neutral-200"
        >
          <ChartIcon />
          <span className="mt-1 text-[11px] font-medium">Statistika</span>
        </button>
      </div>
    </nav>
  );
}
