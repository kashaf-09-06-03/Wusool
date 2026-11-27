"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Smartphone } from "lucide-react";
import clsx from "clsx";
import { Button, Chip, TextField } from "./ui";
import { api, ApiError } from "@/lib/client/api";
import { BANKS, ibanProblem, normalizeRaast, type PayDetails } from "@/lib/payments";

/**
 * "How should friends pay you?" Raast ID first: it's just your mobile number, works from every Raast-enabled
 * bank or wallet app, and you've already verified it, so it's one tap. IBAN, title and bank are optional.
 */
export function PayDetailsForm({
  initial,
  name,
  maskedPhone,
  submitLabel = "Save",
  onSaved,
  secondary,
}: {
  initial?: PayDetails | null;
  name?: string;
  maskedPhone?: string;
  submitLabel?: string;
  onSaved: (d: PayDetails) => void;
  secondary?: React.ReactNode;
}) {
  const [raast, setRaast] = useState(initial?.raast ?? "");
  const [useMine, setUseMine] = useState(false);
  const [iban, setIban] = useState(initial?.iban ?? "");
  const [ibanTouched, setIbanTouched] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? name ?? "");
  const [bank, setBank] = useState(initial?.bank ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ibanErr = iban.trim() && (ibanTouched || iban.replace(/\s/g, "").length >= 24) ? ibanProblem(iban) : null;
  const raastErr = raast.trim() && !useMine && !normalizeRaast(raast) ? "Use a Pakistani mobile number, like 0300 1234567." : null;
  const empty = !useMine && !raast.trim() && !iban.trim();

  const save = async () => {
    setErr(null);
    if (ibanErr || raastErr) return;
    setBusy(true);
    try {
      const r = await api<{ details: PayDetails }>("/api/me/payment", "PUT", {
        raast: useMine ? "@me" : raast.trim() || null,
        iban: iban.trim() || null,
        title: title.trim() || null,
        bank: bank || null,
      });
      onSaved(r.details);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {maskedPhone && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => (setUseMine((v) => !v), setRaast(""))}
          aria-pressed={useMine}
          className={clsx("press-own flex items-center gap-3 rounded-[18px] p-3.5 text-left transition-colors duration-300", useMine ? "bg-blue-tint shadow-[inset_0_0_0_2px_var(--color-blue)]" : "bg-paper-warm")}
        >
          <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-300", useMine ? "bg-blue text-white" : "bg-paper text-ink")}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={useMine ? "y" : "n"} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                {useMine ? <Check size={19} strokeWidth={3} /> : <Smartphone size={19} />}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-label block text-[15px]">Use my number as Raast ID</span>
            <span className="t-caption text-ink-2">{maskedPhone} · works from any bank app</span>
          </span>
        </motion.button>
      )}
      <AnimatePresence initial={false}>
        {!useMine && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <TextField label={maskedPhone ? "Or another Raast ID" : "Raast ID (mobile number)"} value={raast} onChange={setRaast} inputMode="tel" placeholder="0300 1234567" error={raastErr} />
          </motion.div>
        )}
      </AnimatePresence>
      <div onBlur={() => setIbanTouched(true)}>
        <TextField label="IBAN (optional)" value={iban} onChange={(v) => setIban(v.toUpperCase())} placeholder="PK36 SCBL 0000 0011 2345 6702" error={ibanErr} helper={!ibanErr && iban && !ibanProblem(iban) ? "Looks right ✓" : undefined} maxLength={34} />
      </div>
      <TextField label="Account title" value={title} onChange={setTitle} placeholder="As shown in your bank app" maxLength={60} />
      <div>
        <p className="t-label mb-2">Bank or wallet</p>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {BANKS.map((b) => (
            <Chip key={b} selected={bank === b} onClick={() => setBank(bank === b ? "" : b)} className="shrink-0 whitespace-nowrap">
              {b}
            </Chip>
          ))}
        </div>
      </div>
      {err && <p className="t-caption text-pink-text">{err}</p>}
      <div className="flex flex-col gap-1">
        <Button full onClick={save} loading={busy} disabled={empty || Boolean(ibanErr || raastErr)}>
          {submitLabel}
        </Button>
        {secondary}
      </div>
    </div>
  );
}
