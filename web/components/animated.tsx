"use client";

import { motion, AnimatePresence, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// --- Fade In ---
export function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Slide Up (for modals, panels) ---
export function SlideUp({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Stagger Children ---
export function StaggerList({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.05 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Count Up Number ---
export function CountUp({ value, prefix = "", suffix = "", duration = 1, decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; duration?: number; decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const start = Date.now();
    const from = 0;
    const to = value;
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic
      setDisplay(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration, inView]);

  const formatted = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString();
  return <span ref={ref}>{prefix}{formatted}{suffix}</span>;
}

// --- Format USD with animation ---
export function AnimatedUsd({ value, className = "" }: { value: number; className?: string }) {
  const abs = Math.abs(value);
  let formatted: string;
  let decimals: number;

  if (abs >= 1_000_000) {
    formatted = "";
    decimals = 2;
    return <span className={className}><CountUp value={abs / 1_000_000} prefix="$" suffix="M" decimals={decimals} /></span>;
  } else if (abs >= 1_000) {
    return <span className={className}><CountUp value={abs / 1_000} prefix="$" suffix="K" decimals={1} /></span>;
  } else {
    return <span className={className}><CountUp value={abs} prefix="$" decimals={2} /></span>;
  }
}

// --- Pressure Bar Animated ---
export function AnimatedBar({ percentage, colorClass }: { percentage: number; colorClass: string }) {
  return (
    <motion.div
      className={`h-full rounded-full ${colorClass}`}
      initial={{ width: "0%" }}
      animate={{ width: `${percentage}%` }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    />
  );
}

// --- Live Feed Item (slide in from left) ---
export function FeedItemAnimation({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Chat Message Animation ---
export function MessageAnimation({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Button Press ---
export function PressableButton({ children, onClick, disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.02 }}
      className={className}
    >
      {children}
    </motion.button>
  );
}

// --- Hover Glow Card ---
export function GlowCard({ children, onClick, className = "" }: {
  children: React.ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={{ scale: 1.02, borderColor: "var(--accent)" }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Modal Wrapper with AnimatePresence ---
export function ModalAnimation({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-[100]"
          />
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
