"use client";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Page transitions, two layers so a transition is ALWAYS visible:
 *
 * 1. View Transitions API (Chromium, Safari 18+): the browser snapshots the old page and slides the new one
 *    over it, and elements sharing a `view-transition-name` (an outing's banner, logo, title) morph between
 *    pages. This needs the next page to be ready quickly.
 * 2. Entrance fallback: if the next page isn't ready within the budget (first visit, slow network, the dev
 *    server compiling), or the browser has no View Transitions, we skip the snapshot (which would otherwise
 *    slide the OLD page into itself) and instead animate the new page in as it arrives.
 *
 * Directions: forward/back (iOS push/pop), tab-left/tab-right (sideways between tabs), replace (fade).
 */
type Direction = "forward" | "back" | "replace" | "tab-left" | "tab-right";
type Nav = { push: (href: string) => void; replace: (href: string) => void; back: () => void; tab: (href: string, direction: "tab-left" | "tab-right") => void };
const Ctx = createContext<Nav | null>(null);

/** Routes every signed-in user reaches from the tab bar; prefetched so tab switches are instant. */
const WARM = ["/", "/balances", "/inbox", "/profile", "/o/new"];
const BUDGET_MS = 650;

export function NavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const pending = useRef<(() => void) | null>(null);
  const enterNext = useRef<Direction | null>(null);

  useEffect(() => {
    pending.current?.();
    pending.current = null;
    // Fallback entrance for a page that arrived after the View Transition was skipped (or never started).
    const dir = enterNext.current;
    enterNext.current = null;
    if (!dir) return;
    const root = document.documentElement;
    root.dataset.enter = dir;
    const t = setTimeout(() => {
      if (root.dataset.enter === dir) delete root.dataset.enter;
    }, 560);
    return () => clearTimeout(t);
  }, [pathname, search]);

  useEffect(() => {
    const id = setTimeout(() => WARM.forEach((r) => router.prefetch(r)), 1200);
    return () => clearTimeout(id);
  }, [router]);

  const go = useCallback((fn: () => void, direction: Direction) => {
    type VT = { skipTransition: () => void; ready: Promise<void>; finished: Promise<void> };
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => VT };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.dataset.nav = direction;
    if (reduce) return fn();
    if (!doc.startViewTransition) {
      enterNext.current = direction;
      return fn();
    }
    let transition: VT | undefined = undefined;
    transition = doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          pending.current = resolve;
          fn();
          setTimeout(() => {
            if (pending.current !== resolve) return; // the new page committed in time: the browser animates it
            pending.current = null;
            transition?.skipTransition();
            enterNext.current = direction; // animate the page in when it lands instead
            resolve();
          }, BUDGET_MS);
        }),
    );
    // A skipped transition rejects these; that's expected, not an error.
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  }, []);

  // Depth heuristic for push/pop direction: going to a shorter path (or Home) reads as "back".
  const depth = (p: string) => (p === "/" ? 0 : p.split("?")[0].split("/").filter(Boolean).length);
  const dir = (href: string): Direction => (depth(href) < depth(pathname) ? "back" : "forward");
  const nav: Nav = {
    push: (href) => go(() => router.push(href), dir(href)),
    replace: (href) => go(() => router.replace(href), "replace"),
    back: () => go(() => router.back(), "back"),
    tab: (href, direction) => go(() => router.push(href), direction),
  };
  return <Ctx.Provider value={nav}>{children}</Ctx.Provider>;
}

export function useNav(): Nav {
  const n = useContext(Ctx);
  if (!n) throw new Error("useNav outside NavProvider");
  return n;
}

export const vt = (name: string) => ({ viewTransitionName: name.replace(/[^a-zA-Z0-9_-]/g, "_") }) as React.CSSProperties;
