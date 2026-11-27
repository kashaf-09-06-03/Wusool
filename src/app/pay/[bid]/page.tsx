"use client";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Hourglass, QrCode, Share } from "lucide-react";
import QRCode from "qrcode";
import { Screen, TopBar, useMe } from "@/components/shell";
import { Amount, Avatar, Button, haptic, initialsOf, Notice, press, Sheet, Skeleton } from "@/components/ui";
import { PayDetailsForm } from "@/components/PayDetailsForm";
import { Burst } from "@/components/fx";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatIban, hasPayDetails, type PayDetails } from "@/lib/payments";
import { formatPKR } from "@/lib/money";

type PayInfo = {
  balanceId: string;
  version: number;
  role: "debtor" | "creditor" | "organizer";
  outing: { id: string; name: string };
  payee: { name: string; color: string; isUser: boolean };
  payer: { name: string };
  amount: number;
  outstanding: number;
  due: number;
  claimed: number;
  status: string;
  superseded: boolean;
  details: PayDetails | null;
  link: string;
};

/**
 * Pay page for one balance. Everything needed to pay from any Pakistani bank or wallet app, each value one tap
 * to copy. Wusool never moves money: "I've paid" records a claim that the person being paid confirms.
 */
export default function PayPage({ params }: { params: Promise<{ bid: string }> }) {
  const { bid } = use(params);
  const { me } = useMe();
  const { data, error, mutate } = useSWR<PayInfo>(me ? `/api/pay/${bid}` : null);
  const nav = useNav();
  const toast = useToast();
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const [editing, setEditing] = useState(false);

  const markPaid = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await api(`/api/balances/${bid}`, "POST", { action: { type: "mark_paid", amount: data.due }, expectedVersion: data.version, idempotencyKey: `pay:${bid}:${data.version}` });
      haptic();
      setCelebrate((c) => c + 1);
      toast(`Marked paid. ${data.payee.name.split(" ")[0]} will confirm.`);
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t mark it paid", "error");
    } finally {
      setBusy(false);
    }
  };

  const shareLink = async () => {
    if (!data) return;
    const text = `${data.payer.name.split(" ")[0]}, here’s how to pay me ${formatPKR(data.due)} for ${data.outing.name}: ${data.link}`;
    try {
      if (navigator.share) await navigator.share({ title: "Pay link", text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Pay link copied");
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  if (error)
    return (
      <Screen>
        <TopBar back />
        <div className="px-5 pt-6">
          <Notice tone="pink">{error instanceof ApiError ? error.message : "Couldn’t open this pay link."}</Notice>
        </div>
      </Screen>
    );

  const first = data?.payee.name.split(" ")[0] ?? "";
  const iAmPayee = data?.role === "creditor";
  const settled = data && data.due <= 0;

  return (
    <Screen bg="warm">
      <TopBar back title={data ? (iAmPayee ? "Your pay link" : `Pay ${first}`) : ""} collapse />
      <Burst trigger={celebrate} kind="coins" origin={{ x: 0.5, y: 0.3 }} />
      {!data ? (
        <div className="flex flex-col gap-4 px-5 pt-2">
          <Skeleton className="h-52" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 pb-10">
          {/* The pass: who, how much, for what. */}
          <motion.div
            initial={{ opacity: 0, y: 24, rotateX: 18 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
            style={{ transformPerspective: 900 }}
            className="chrome-ring relative overflow-hidden rounded-[28px] bg-ink p-5 text-white shadow-[0_24px_48px_-24px_rgba(17,17,20,0.6)]"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <span className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue/50 blur-3xl" />
              <span className="absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-pink/30 blur-3xl" />
            </div>
            <div className="relative flex items-center gap-3">
              <Avatar initials={initialsOf(data.payee.name)} color={data.payee.color} size={44} ring={false} />
              <div className="min-w-0">
                <p className="t-caption text-white/60">{iAmPayee ? `${data.payer.name.split(" ")[0]} pays you` : "You pay"}</p>
                <p className="t-card truncate text-white">{iAmPayee ? "You" : data.payee.name}</p>
              </div>
            </div>
            <Amount value={data.due > 0 ? data.due : data.outstanding} className="t-amount-xl relative mt-6 block text-[46px]" />
            <p className="t-caption relative mt-1 text-white/60">for {data.outing.name}</p>
            <AnimatePresence>
              {data.claimed > 0 && (
                <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="t-chip relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-white/90">
                  <Hourglass size={13} /> {formatPKR(data.claimed)} marked paid · waiting for {iAmPayee ? "you" : first} to confirm
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          {data.superseded && <Notice tone="pink">This balance was replaced by a newer split. Open the outing for the current amount.</Notice>}

          {/* How to pay */}
          {hasPayDetails(data.details) && !editing ? (
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, type: "spring", stiffness: 260, damping: 28 }} className="surface overflow-hidden">
              <p className="t-label px-4 pt-4 text-[15px]">{iAmPayee ? "What friends see" : `Send to ${first}`}</p>
              <div className="mt-1 divide-y divide-line">
                {data.due > 0 && <CopyRow label="Amount" value={data.due % 100 ? (data.due / 100).toFixed(2) : String(data.due / 100)} display={formatPKR(data.due)} />}
                {data.details!.raast && <CopyRow label="Raast ID" value={data.details!.raast} display={data.details!.raast.replace(/^(\d{4})(\d{7})$/, "$1 $2")} />}
                {data.details!.iban && <CopyRow label="IBAN" value={data.details!.iban} display={formatIban(data.details!.iban)} mono />}
                {data.details!.title && <CopyRow label="Account title" value={data.details!.title} display={data.details!.title} />}
                {data.details!.bank && <CopyRow label="Bank" value={data.details!.bank} display={data.details!.bank} />}
              </div>
              <p className="t-caption px-4 pb-4 pt-3 text-ink-2">Open any bank or wallet app, choose Raast or IBAN transfer, and paste.</p>
            </motion.section>
          ) : iAmPayee ? (
            <section className="surface p-4">
              <p className="t-label text-[16px]">How should friends pay you?</p>
              <p className="t-caption mb-4 mt-0.5 text-ink-2">Only people who owe you see this.</p>
              <PayDetailsForm initial={data.details} onSaved={() => (setEditing(false), mutate(), toast("Saved"))} />
            </section>
          ) : (
            <Notice tone="warm">{first} hasn’t added payment details yet. Ask them in your group chat, then tap “I’ve paid” here.</Notice>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {!iAmPayee && !settled && !data.superseded && (
              <Button full onClick={markPaid} loading={busy} icon={<Check size={20} strokeWidth={2.6} />}>
                I’ve paid {formatPKR(data.due)}
              </Button>
            )}
            {settled && !data.superseded && (
              <Notice tone="blue" icon={<Check size={18} className="text-blue" />}>
                Nothing left to pay here.
              </Notice>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="glass" size="M" icon={<QrCode size={18} />} onClick={() => setQr(true)}>
                QR code
              </Button>
              {iAmPayee ? (
                <Button variant="glass" size="M" icon={<Share size={18} />} onClick={shareLink}>
                  Send link
                </Button>
              ) : (
                <Button variant="glass" size="M" onClick={() => nav.push(`/o/${data.outing.id}?tab=settle`)}>
                  Open outing
                </Button>
              )}
            </div>
            {iAmPayee && hasPayDetails(data.details) && !editing && (
              <Button variant="text" size="M" onClick={() => setEditing(true)}>
                Edit my payment details
              </Button>
            )}
          </div>
        </div>
      )}
      {data && <QrSheet open={qr} onClose={() => setQr(false)} link={data.link} title={iAmPayee ? "Show this to whoever owes you" : "Open on your phone"} />}
    </Screen>
  );
}

/** One value per row; tapping anywhere on the row copies it and the icon turns into a check. */
function CopyRow({ label, value, display, mono }: { label: string; value: string; display: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt(`Copy ${label}`, value);
    }
    haptic();
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <motion.button {...press(0.985, 0.97)} onClick={copy} aria-label={`Copy ${label}`} className="press-own flex w-full items-center gap-3 px-4 py-3.5 text-left">
      <span className="min-w-0 flex-1">
        <span className="t-caption block text-ink-2">{label}</span>
        <span className={mono ? "t-label block text-[16px] tracking-[0.02em] tabular" : "t-label block text-[16px]"}>{display}</span>
      </span>
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-paper-warm">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={done ? "d" : "c"} initial={{ scale: 0.3, opacity: 0, rotate: done ? -90 : 0 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.3, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 26 }} className={done ? "text-blue" : "text-ink-2"}>
            {done ? <Check size={17} strokeWidth={3} /> : <Copy size={16} />}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

/**
 * QR of this pay page. A phone camera opens it, so someone on a laptop (or across the table) can pay from
 * their phone. It is NOT a bank-app payment QR: Raast payment QRs follow an SBP specification that this
 * prototype doesn't implement, so we don't pretend a bank app can scan it.
 */
function QrSheet({ open, onClose, link, title }: { open: boolean; onClose: () => void; link: string; title: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111114", light: "#ffffff" } }).then(setSvg).catch(() => setSvg(null));
  }, [open, link]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col items-center pb-4">
        <motion.div initial={{ scale: 0.85, opacity: 0, rotate: -4 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 20 }} className="rounded-[24px] bg-white p-4 shadow-[var(--elev-2)]">
          {svg ? <div className="h-56 w-56" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code of this pay link" role="img" /> : <Skeleton className="h-56 w-56" />}
        </motion.div>
        <p className="t-caption mt-4 max-w-[280px] text-center text-ink-2">Scan with a phone camera to open this pay page. Bank apps can’t scan it yet.</p>
      </div>
    </Sheet>
  );
}
