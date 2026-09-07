"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/markets", label: "MARKETS" },
  { href: "/ledger", label: "LEDGER" },
  { href: "/skills", label: "SKILLS" },
];

export function BaoNav() {
  const pathname = usePathname();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-12 bg-[var(--bg-panel)]/90 backdrop-blur border-b border-[var(--border)] flex items-center px-4 gap-6">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Image src="/bao-logo.png" alt="elizaBAO" width={26} height={26} className="logo-breathe rounded" />
        <span className="mono text-sm font-bold tracking-wider text-[var(--accent)]">elizaBAO</span>
      </Link>
      <nav className="flex items-center gap-4 text-[11px] mono tracking-widest">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`transition-colors hover:text-[var(--accent-bright)] ${
              pathname?.startsWith(l.href) ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-4 text-[10px] mono">
        <span className="hidden sm:flex items-center gap-1.5 text-[var(--text-muted)]">
          <span className="live-dot" />
          ACCEPTANCE LAYER
        </span>
        <a
          href="https://github.com/elizabaoxyz/polymarket-agent"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--text-secondary)] hover:text-[var(--accent-bright)] transition-colors"
        >
          GITHUB
        </a>
        <Link
          href="/console"
          className="text-[var(--text-muted)] hover:text-[var(--accent-bright)] transition-colors"
        >
          CONSOLE
        </Link>
      </div>
    </header>
  );
}
