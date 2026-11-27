"use client";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { SWRConfig } from "swr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import useSWR from "swr";
import { Bell, ChevronLeft, House, User, Wallet, X } from "lucide-react";
import { fetcher } from "@/lib/client/api";
import { NavProvider, useNav } from "@/lib/client/nav";
import { ToastProvider } from "@/lib/client/toast";
import { IconButton } from "./ui";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, shouldRetryOnError: false }}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <Suspense>
            <NavProvider>{children}</NavProvider>
          </Suspense>
        </ToastProvider>
      </MotionConfig>
    </SWRConfig>
  );
}

/** Mobile-first column. On wider screens it stays a centred phone-width column (no desktop layout is designed). */
export function Screen({ children, className, tabBar, bg = "paper" }: { children: ReactNode; className?: string; tabBar?: boolean; bg?: "paper" | "warm" }) {
  return (
    <div className="flex min-h-dvh justify-center bg-paper-warm sm:py-6">
      <main className={clsx("relative w-full max-w-[480px] overflow-x-clip sm:min-h-[calc(100dvh-48px)] sm:rounded-[36px] sm:shadow-[0_20px_60px_rgba(17,17,20,0.12)]", bg === "paper" ? "bg-paper" : "bg-paper-warm", tabBar && "pb-28", className)}>
        {children}
        {tabBar && <TabBar />}
      </main>
    </div>
  );
}

export function TopBar({ title, back, close, right, onBack, transparent, collapse }: { title?: ReactNode; back?: string | boolean; close?: string | boolean; right?: ReactNode; onBack?: () => void; transparent?: boolean; collapse?: boolean }) {
  const nav = useNav();
  const goBack = () => {
    if (onBack) return onBack();
    if (typeof back === "string") return nav.push(back);
    if (typeof close === "string") return nav.push(close);
    if (window.history.length > 1) nav.back();
    else nav.push("/");
  };
  // Apple-style: with a large title on the page, the bar's title and glass fade in as you scroll.
  const { scrollY } = useScroll();
  const titleOpacity = useTransform(scrollY, [40, 96], collapse ? [0, 1] : [1, 1]);
  const titleY = useTransform(scrollY, [40, 96], collapse ? [8, 0] : [0, 0]);
  const glass = useTransform(scrollY, [0, 40], transparent ? [0, 1] : [0.7, 1]);
  return (
    <header className="sticky top-0 z-30 flex h-[64px] items-center gap-3 px-4">
      <motion.span aria-hidden style={{ opacity: glass }} className="absolute inset-0 border-b border-ink/[0.06] bg-paper/80 backdrop-blur-xl" />
      {(back || close) && (
        <IconButton label={close ? "Close" : "Back"} onClick={goBack} surface="solid" className="relative">
          {close ? <X size={21} /> : <ChevronLeft size={23} />}
        </IconButton>
      )}
      <motion.div style={{ opacity: titleOpacity, y: titleY }} className="relative t-label min-w-0 flex-1 truncate text-center text-[16px]">
        {title}
      </motion.div>
      {right ? <span className="relative">{right}</span> : (back || close) && <span className="w-11" aria-hidden />}
    </header>
  );
}

/** Large editorial page title that hands off to the TopBar when scrolled (pair with <TopBar collapse/>). */
export function PageTitle({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.8 }} className={clsx("px-5 pb-2", className)}>
      <h1 className="t-title">{children}</h1>
      {sub && <p className="t-body-s mt-2 text-ink-2">{sub}</p>}
    </motion.div>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: House },
  { href: "/balances", label: "Balances", icon: Wallet },
  { href: "/inbox", label: "Inbox", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
];

/**
 * Dark liquid-glass tab bar. Icon-only pill; the active tab sits on a lighter glass lens that slides between
 * icons. Scrolling down morphs the pill into a single round button (more room for content, iOS 26 style);
 * scrolling up or tapping it expands it again.
 */
/** The bar rises in once per app launch, not on every page (pages remount it on each navigation). */
let tabBarShown = false;

export function TabBar() {
  const [rise] = useState(() => !tabBarShown);
  useEffect(() => {
    tabBarShown = true;
  }, []);
  const path = usePathname();
  const { data } = useSWR<{ unread: number }>("/api/home", { refreshInterval: 15000 });
  const active = TABS.find((t) => (t.href === "/" ? path === "/" || path.startsWith("/o/") : path.startsWith(t.href)))?.href;
  const [collapsed, setCollapsed] = useState(false);
  const { scrollY } = useScroll();
  const last = useRef(0);
  useMotionValueEvent(scrollY, "change", (y) => {
    const dy = y - last.current;
    if (Math.abs(dy) < 6) return;
    last.current = y;
    if (y < 80) setCollapsed(false);
    else setCollapsed(dy > 0);
  });
  const ActiveIcon = TABS.find((t) => t.href === active)?.icon ?? House;
  const nav = useNav();
  const spring = { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.9 };
  return (
    <nav aria-label="Main" style={{ viewTransitionName: "tabbar" }} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      <motion.div
        layout
        transition={spring}
        initial={rise ? { y: 90, opacity: 0 } : false}
        animate={{ y: 0, opacity: 1 }}
        style={{ borderRadius: 999 }}
        className="glass-dark pointer-events-auto flex items-center overflow-hidden p-1.5"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {collapsed ? (
            <motion.button
              key="collapsed"
              layout="position"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={spring}
              onClick={() => setCollapsed(false)}
              aria-label="Show tabs"
              className="press-own relative flex h-[50px] w-[50px] items-center justify-center rounded-full text-white"
            >
              <ActiveIcon size={21} strokeWidth={2} />
            </motion.button>
          ) : (
            <motion.div key="tabs" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="flex items-center gap-1">
              {TABS.map((t) => {
                const on = active === t.href;
                const Icon = t.icon;
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    onClick={(e) => {
                      // Route through the transition system: slide toward the tab you picked.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || on) return on && e.preventDefault();
                      e.preventDefault();
                      const from = TABS.findIndex((x) => x.href === active);
                      nav.tab(t.href, TABS.indexOf(t) > from ? "tab-right" : "tab-left");
                    }}
                    aria-label={t.label} title={t.label} aria-current={on ? "page" : undefined} className="press-own relative flex h-[50px] w-[62px] items-center justify-center rounded-full">
                    {on && <motion.span layoutId="tab-lens" className="glass-lens absolute inset-0 rounded-full" transition={spring} />}
                    <motion.span className="relative" initial={false} animate={on ? { scale: [0.84, 1.08, 1] } : { scale: 1 }} transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}>
                      <Icon size={22} strokeWidth={on ? 2.2 : 1.8} className={on ? "text-white" : "text-white/60"} />
                      {t.href === "/inbox" && (data?.unread ?? 0) > 0 && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-pink ring-2 ring-[#2a2a31]" aria-label={`${data!.unread} unread`} />}
                    </motion.span>
                  </Link>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </nav>
  );
}

/** Sends signed-out visitors to onboarding; returns the user once known. */
export function useMe(required = true) {
  const { data, error, isLoading, mutate } = useSWR<{ user: { id: string; name: string; initials: string; color: string; threshold: number; onboarded: boolean } | null }>("/api/me");
  const nav = useNav();
  const path = usePathname();
  useEffect(() => {
    if (required && !isLoading && data && !data.user) nav.replace(`/welcome?next=${encodeURIComponent(path)}`);
  }, [required, isLoading, data, nav, path]);
  return { me: data?.user ?? null, loading: isLoading, error, mutate };
}

export function Fab({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-30 -mx-0 mt-6 bg-gradient-to-t from-paper via-paper/95 to-paper/0 px-4 pt-6 pb-[max(18px,env(safe-area-inset-bottom))]">{children}</div>;
}
