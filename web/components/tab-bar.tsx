"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Mobile-only bottom tab bar — native-app navigation over the broadsheet. */
const TABS = [
  { href: "/", label: "FRONT", glyph: "\u2302" },
  { href: "/markets", label: "MARKETS", glyph: "\u00a2" },
  { href: "/ledger", label: "LEDGER", glyph: "\u2263" },
  { href: "/skills", label: "SKILLS", glyph: "\u00bb" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--paper)] border-t-[3px] border-[var(--blue)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="border-t border-[var(--blue)] mt-[2px] grid grid-cols-4">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-1 pt-2.5 pb-2 transition-colors ${
                active
                  ? "bg-[var(--blue)] text-white"
                  : "text-[var(--ink-soft)] active:bg-[var(--blue-wash)]"
              }`}
            >
              <span className="text-[17px] leading-none font-bold">{t.glyph}</span>
              <span className="text-[8px] tracking-[0.22em] font-bold">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
