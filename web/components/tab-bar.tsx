"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile-only bottom bar — an ink banner with a rubber stamp on the active page.
 * Solid literal colors (no CSS vars): a fixed bar must never render transparent.
 */
const INK = "#2b1507";
const ORANGE = "#e66516";
const PAPER = "#faf6ee";
const FADED = "#c89268";

const TABS = [
  { href: "/", label: "FRONT", glyph: "¶", index: "01" },
  { href: "/markets", label: "MARKETS", glyph: "¢", index: "02" },
  { href: "/ledger", label: "LEDGER", glyph: "≣", index: "03" },
  { href: "/skills", label: "SKILLS", glyph: "§", index: "04" },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden select-none"
      style={{
        // inline so `.paper > *` (position: relative, z-index: 1) can never override it
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9000,
        background: INK,
        borderTop: `3px solid ${ORANGE}`,
        boxShadow: "0 -6px 18px rgba(43, 21, 7, 0.35)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* ticket perforation line */}
      <div
        aria-hidden
        style={{ borderTop: "1px dashed rgba(250,246,238,0.3)", margin: "3px 10px 0" }}
      />
      {/* faint halftone texture over the ink */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage: `radial-gradient(circle, ${PAPER} 1px, transparent 1.4px)`,
          backgroundSize: "7px 7px",
        }}
      />
      <div className="relative grid grid-cols-4 px-1.5 pt-1.5 pb-2">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className="relative flex items-center justify-center py-1.5 active:scale-90 transition-transform"
            >
              {active ? (
                /* the rubber stamp — re-keyed by path so it re-stamps on every switch */
                <span
                  key={pathname}
                  className="tab-stamp flex items-baseline gap-1.5 px-2.5 py-2"
                  style={{
                    background: ORANGE,
                    color: PAPER,
                    border: `1.5px solid ${PAPER}`,
                    outline: `1.5px solid ${ORANGE}`,
                    outlineOffset: "1.5px",
                    boxShadow: "3px 3px 0 rgba(0,0,0,0.4)",
                  }}
                >
                  <span className="text-[13px] leading-none font-bold">{t.glyph}</span>
                  <span className="text-[10px] tracking-[0.18em] font-bold leading-none">
                    {t.label}
                  </span>
                </span>
              ) : (
                <span className="flex flex-col items-center gap-[5px]" style={{ color: FADED }}>
                  <span className="flex items-baseline gap-1">
                    <span className="text-[8px] leading-none opacity-60">{t.index}</span>
                    <span className="text-[15px] leading-none font-bold">{t.glyph}</span>
                  </span>
                  <span className="text-[8px] tracking-[0.22em] font-bold leading-none">
                    {t.label}
                  </span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
