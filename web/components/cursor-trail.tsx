"use client";

import { useEffect } from "react";

/**
 * ASCII ink trail. The cursor sheds tiny mono glyphs as it moves —
 * like a pen dragging halftone dust across the paper. Clicks splatter.
 * Desktop (fine pointer) only; capped and self-cleaning.
 */
const GLYPHS = ["+", "\u00b7", "\u00d7", "\u25aa", ":", "\u2044"];
const MAX_LIVE = 40;

export function CursorTrail() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let last = { x: -100, y: -100 };
    let live = 0;

    const spawn = (x: number, y: number, burst = false) => {
      if (live >= MAX_LIVE) return;
      live++;
      const el = document.createElement("span");
      el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      el.className = "trail-glyph";
      const spread = burst ? 44 : 12;
      el.style.left = `${x + (Math.random() - 0.5) * spread}px`;
      el.style.top = `${y + (Math.random() - 0.5) * spread}px`;
      el.style.fontSize = `${9 + Math.random() * 9}px`;
      el.style.animationDuration = `${burst ? 700 : 450 + Math.random() * 250}ms`;
      if (Math.random() < 0.2) el.style.color = "#4a2810";
      document.body.appendChild(el);
      el.addEventListener("animationend", () => {
        el.remove();
        live--;
      });
    };

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (dx * dx + dy * dy < 500) return; // shed a glyph every ~22px of travel
      last = { x: e.clientX, y: e.clientY };
      spawn(e.clientX, e.clientY);
    };

    const onClick = (e: MouseEvent) => {
      for (let i = 0; i < 8; i++) spawn(e.clientX, e.clientY, true);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  return null;
}
