"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMarkets, type BaoMarket } from "@/lib/bao-api";
import { CursorTrail } from "@/components/cursor-trail";

const LINKS = [
  { href: "/markets", label: "MARKETS" },
  { href: "/ledger", label: "LEDGER" },
  { href: "/skills", label: "SKILLS" },
];

function today(): string {
  return new Date().toUTCString().slice(0, 16).toUpperCase();
}

export function Masthead({ dense = false }: { dense?: boolean }) {
  const pathname = usePathname();
  const [board, setBoard] = useState<BaoMarket[]>([]);

  useEffect(() => {
    fetchMarkets(20).then(setBoard);
    const iv = setInterval(() => fetchMarkets(20).then(setBoard), 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <header>
      <CursorTrail />
      {/* hairline info row */}
      <div className="flex items-center justify-between px-4 md:px-8 py-1.5 text-[9px] md:text-[10px] tracking-[0.2em] text-[var(--ink-soft)] border-b border-[var(--rule)]">
        <span className="hidden sm:inline">THE ACCEPTANCE LAYER FOR PREDICTION MARKETS</span>
        <span className="sm:hidden">ACCEPTANCE LAYER</span>
        <span className="flex items-center gap-2">
          <span className="ink-dot" />
          {today()} · USDC ONLY
        </span>
      </div>

      {/* masthead proper — solid #e66516 ink band */}
      <div className="bg-[var(--blue)] relative">
        <div className="absolute inset-x-0 bottom-0 h-3 halftone opacity-25 pointer-events-none" style={{ filter: "invert(1)" }} />
        <div
          className={`flex items-end justify-between px-4 md:px-8 ${dense ? "py-3" : "py-5 md:py-7"} gap-4`}
        >
          <Link href="/" className="flex items-end gap-3 md:gap-4 group">
            <Image
              src="/eliza-portrait.png"
              alt="Eliza"
              width={dense ? 44 : 72}
              height={dense ? 44 : 72}
              className="border-2 border-[var(--paper)] group-hover:rotate-[-2deg] transition-transform"
            />
            <span
              className={`font-display leading-none tracking-tight text-[var(--paper)] ${
                dense ? "text-3xl md:text-4xl" : "text-4xl md:text-6xl"
              }`}
              style={{ textShadow: "3px 3px 0 rgba(74, 40, 16, 0.45)" }}
            >
              elizaBAO
            </span>
          </Link>
          <nav className="flex items-baseline gap-3 md:gap-6 pb-1 text-[11px] md:text-[12px] tracking-[0.18em]">
            {LINKS.map((l) => {
              const active = pathname?.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`transition-colors ${
                    active
                      ? "text-white font-bold underline underline-offset-4 decoration-2"
                      : "text-[rgba(250,246,238,0.85)] hover:text-white"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <a
              href="https://x.com/elizabao_ai"
              target="_blank"
              rel="noreferrer"
              aria-label="elizaBAO on X (Twitter)"
              className="flex items-center gap-1.5 font-bold text-white border-2 border-[rgba(250,246,238,0.7)] hover:bg-white hover:text-[var(--blue)] transition-colors px-2.5 py-1"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              TWITTER
            </a>
            {/* console link hidden — route still reachable at /console */}
          </nav>
        </div>
      </div>

      <div className="rule-double mx-4 md:mx-8 mt-2" />

      {/* ticker tape of live venue prices */}
      {board.length > 0 && (
        <div className="overflow-hidden border-b border-[var(--rule)] py-1.5 mx-4 md:mx-8">
          <div className="flex gap-10 tape w-max">
            {[...board, ...board].map((m, i) => (
              <span key={`${m.slug}-${i}`} className="text-[10px] whitespace-nowrap tracking-wide">
                <span className="text-[var(--ink-soft)]">{m.title.slice(0, 44)}</span>{" "}
                <span className="text-[var(--blue-deep)] font-bold">
                  {(m.midYes * 100).toFixed(1)}¢
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
