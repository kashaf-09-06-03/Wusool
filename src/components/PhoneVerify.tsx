"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Button, TextField } from "./ui";

/**
 * Name + phone → one-time code. No SMS provider is configured in this prototype, so the
 * server returns the code and we show it in a clearly labelled box (Figma marks OTP as MOCK).
 */
export function PhoneVerify({ initialName = "", askName = true, cta = "Send code", onVerified, nameLabel = "Your name", nameHelper }: { initialName?: string; askName?: boolean; cta?: string; onVerified: (user: { id: string; name: string; onboarded: boolean }, name: string) => void; nameLabel?: string; nameHelper?: string }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [devCode, setDevCode] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const send = async () => {
    setErr(null);
    if (askName && !name.trim()) return setErr("Add your name so friends recognise you.");
    setBusy(true);
    try {
      const r = await api<{ devCode: string; resendInSec: number }>("/api/auth/start", "POST", { phone });
      setDevCode(r.devCode);
      setResendIn(r.resendInSec);
      setStep("code");
      setCode("");
      setTimeout(() => boxes.current[0]?.focus(), 250);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t send a code. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ user: { id: string; name: string; onboarded: boolean } }>("/api/auth/verify", "POST", { phone, code: value, name });
      onVerified(r.user, name);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t verify. Try again.");
      setCode("");
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (i: number, v: string) => {
    const digits = v.replace(/\D/g, "");
    if (digits.length > 1) {
      const next = digits.slice(0, 6);
      setCode(next);
      if (next.length === 6) verify(next);
      return;
    }
    const arr = code.padEnd(6, " ").split("");
    arr[i] = digits || " ";
    const next = arr.join("").replace(/\s+$/, "");
    setCode(next);
    if (digits && i < 5) boxes.current[i + 1]?.focus();
    if (next.replace(/\s/g, "").length === 6) verify(next.replace(/\s/g, ""));
  };

  return (
    <AnimatePresence mode="wait">
      {step === "phone" ? (
        <motion.div key="phone" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex flex-col gap-4">
          {askName && <TextField label={nameLabel} value={name} onChange={setName} autoComplete="name" maxLength={40} helper={nameHelper} />}
          <TextField label="Mobile number" value={phone} onChange={setPhone} inputMode="tel" placeholder="0300 1234567" autoComplete="tel" onEnter={send} helper="Identifies you so nobody can join as you. Never shown to other members." error={err} />
          <Button full onClick={send} loading={busy}>
            {cta}
          </Button>
        </motion.div>
      ) : (
        <motion.div key="code" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex flex-col gap-4">
          <div>
            <p className="t-label">Enter the 6-digit code</p>
            <p className="t-caption mt-0.5 text-ink-2">Sent to {phone}</p>
          </div>
          <div className="flex justify-between gap-2" onPaste={(e) => setDigit(0, e.clipboardData.getData("text"))}>
            {Array.from({ length: 6 }).map((_, i) => (
              <motion.input
                key={i}
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                aria-label={`Digit ${i + 1}`}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                maxLength={6}
                value={code[i]?.trim() ?? ""}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => e.key === "Backspace" && !code[i]?.trim() && i > 0 && boxes.current[i - 1]?.focus()}
                animate={err ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
                transition={{ duration: 0.4 }}
                className="t-amount-l h-14 w-full rounded-[14px] border-[1.5px] border-line-strong bg-paper text-center outline-none focus:border-blue focus:shadow-[0_0_0_4px_rgba(31,59,255,0.12)]"
              />
            ))}
          </div>
          {err && <p className="t-caption text-pink-text">{err}</p>}
          <div className="rounded-[16px] border-[1.5px] border-dashed border-pink-text bg-pink-tint p-3.5">
            <p className="t-overline text-pink-text">Prototype: SMS not connected</p>
            <p className="t-ui mt-1 text-[14px]">
              No SMS is sent in this prototype. Your code is <button type="button" className="t-amount-m tracking-[0.2em] text-ink underline decoration-pink decoration-2 underline-offset-4" onClick={() => setDigit(0, devCode)}>{devCode}</button> (tap to fill).
            </p>
          </div>
          <div className="flex items-center justify-between">
            <button type="button" className="t-label text-[15px] text-blue disabled:text-ink-2" disabled={resendIn > 0 || busy} onClick={send}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
            <button type="button" className="t-label text-[15px] text-ink-2" onClick={() => setStep("phone")}>
              Change number
            </button>
          </div>
          <Button full onClick={() => verify(code.replace(/\s/g, ""))} loading={busy} disabled={code.replace(/\s/g, "").length !== 6} icon={<ShieldCheck size={20} />}>
            Verify
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
