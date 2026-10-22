"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, Check } from "lucide-react";

type Toast = { id: number; text: string; tone: "ok" | "error" | "info" };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 5200 : 2800);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.92, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 12, scale: 0.96, filter: "blur(4px)" }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className={`pointer-events-auto flex max-w-[358px] items-center gap-2.5 rounded-full px-5 py-3.5 shadow-[0_12px_30px_rgba(17,17,20,0.28)] ${
                t.tone === "error" ? "bg-pink-text text-white" : "bg-ink text-white"
              }`}
            >
              {t.tone === "error" ? <CircleAlert size={18} className="shrink-0" /> : <Check size={18} className="shrink-0 text-lime" strokeWidth={3} />}
              <span className="t-label text-[15px] font-medium">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
