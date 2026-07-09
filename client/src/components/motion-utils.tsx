// Utilitários de motion pra Dashboard de Métricas. Bruno 2026-05-18.
//
// Princípios (UX-UI-Senior skill):
// - Animações 100-300ms (micro) / 400-600ms (entrada).
// - Curvas naturais (ease-out cubic-bezier).
// - Respeita prefers-reduced-motion.
// - Propósito > decoração: feedback, continuidade, atenção.

import { motion, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// CountUp — anima número de 0 ao valor final em 1s easeOut.
// Respeita reduced-motion (mostra valor final direto).
// ──────────────────────────────────────────────────────────────────────────
export function CountUp({
  value,
  format = (n) => Math.round(n).toString(),
  duration = 1000,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (prefersReduced) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = display;
    const delta = value - from;
    if (delta === 0) return;
    const tick = (t: number) => {
      const elapsed = t - start;
      const progress = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + delta * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, prefersReduced]);

  return <span className={className}>{format(display)}</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// Stagger container + child. Use pra entrada de lista de cards.
//   <StaggerContainer>
//     <StaggerItem>...</StaggerItem>
//     <StaggerItem>...</StaggerItem>
//   </StaggerContainer>
// ──────────────────────────────────────────────────────────────────────────
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

export function StaggerContainer({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="show"
      transition={{ delayChildren: delay }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// FadeIn — entrada simples com slide-up. Versão single-item.
// ──────────────────────────────────────────────────────────────────────────
export function FadeIn({
  children,
  delay = 0,
  className,
  y = 8,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// HoverLift — card que sobe levemente ao hover. Wrapper sutil.
// ──────────────────────────────────────────────────────────────────────────
export function HoverLift({
  children,
  className,
  lift = 2,
}: {
  children: ReactNode;
  className?: string;
  lift?: number;
}) {
  return (
    <motion.div
      className={className}
      whileHover={{ y: -lift, transition: { duration: 0.18 } }}
    >
      {children}
    </motion.div>
  );
}
