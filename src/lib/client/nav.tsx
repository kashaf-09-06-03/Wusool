"use client";
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shared-element page transitions with the View Transitions API.
 * Elements that carry the same `view-transition-name` on two pages (e.g. an outing
 * card's banner on Home and the header on the Outing page) morph into each other.
 * Falls back to plain navigation where unsupported or when reduced motion is on.
 */
type Nav = { push: (href: string) => void; replace: (href: string) => void; back: () => void };
const Ctx = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    pending.current?.();
    pending.current = null;
  }, [pathname, search]);

  const go = useCallback(
    (fn: () => void, direction: "forward" | "back" | "replace") => {
      const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.documentElement.dataset.nav = direction;
      if (!doc.startViewTransition || reduce) return fn();
      doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            pending.current = resolve;
            fn();
            setTimeout(resolve, 900); // never block the UI if navigation is slow
          }),
      );
    },
    [],
  );

  // Depth heuristic for push/pop direction: going to a shorter path (or Home) reads as "back".
  const depth = (p: string) => (p === "/" ? 0 : p.split("?")[0].split("/").filter(Boolean).length);
  const dir = (href: string) => (depth(href) < depth(pathname) ? "back" : "forward");
  const nav: Nav = {
    push: (href) => go(() => router.push(href), dir(href)),
    replace: (href) => go(() => router.replace(href), "replace"),
    back: () => go(() => router.back(), "back"),
  };
  return <Ctx.Provider value={nav}>{children}</Ctx.Provider>;
}

export function useNav(): Nav {
  const n = useContext(Ctx);
  if (!n) throw new Error("useNav outside NavProvider");
  return n;
}

export const vt = (name: string) => ({ viewTransitionName: name.replace(/[^a-zA-Z0-9_-]/g, "_") }) as React.CSSProperties;
