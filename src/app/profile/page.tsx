"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { motion } from "motion/react";
import { ChevronRight, Landmark, LogOut, MessageCircle, ShieldCheck, Trash } from "lucide-react";
import { useSWRConfig } from "swr";
import { Screen, useMe } from "@/components/shell";
import { Avatar, Button, Chip, ConfirmSheet, Notice, press, Sheet, Skeleton, TextField, Toggle } from "@/components/ui";
import { PayDetailsForm } from "@/components/PayDetailsForm";
import { formatIban, hasPayDetails, type PayDetails } from "@/lib/payments";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatPKR, parsePKR } from "@/lib/money";
import type { ProfileData } from "@/lib/client/types";

/** Profile & settings: H1 WhatsApp opt-in (OFF by default), J1 small-debt threshold, J2 privacy & data. */
export default function Profile() {
  const { me } = useMe();
  const { data, mutate } = useSWR<ProfileData>(me ? "/api/me" : null);
  const { data: accounts } = useSWR<{ accounts: { id: string; name: string; phone: string; color: string; current: boolean }[] }>(me ? "/api/auth/accounts" : null);
  const { mutate: globalMutate } = useSWRConfig();
  const { data: pay, mutate: refreshPay } = useSWR<{ details: PayDetails }>(me ? "/api/me/payment" : null);
  const [editPay, setEditPay] = useState(false);
  const nav = useNav();
  const toast = useToast();
  const [consent, setConsent] = useState(false);
  const [agree, setAgree] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [thErr, setThErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.user) setThreshold(String(data.user.threshold / 100));
  }, [data?.user]);

  const patch = async (body: object, ok?: string) => {
    try {
      const r = await api<ProfileData>("/api/me", "PATCH", body);
      mutate(r, { revalidate: false });
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
      return false;
    }
  };

  const saveThreshold = async (v: string) => {
    setThreshold(v);
    const p = parsePKR(v);
    if (p === null || p < 0 || p > 500000) return setThErr("Choose an amount between PKR 0 and PKR 5,000.");
    setThErr(null);
    await patch({ threshold: p }, "Saved. Changes only which balances show the quick Wusool/Maaf card.");
  };

  if (!data?.user) {
    return (
      <Screen tabBar>
        <div className="flex flex-col gap-4 p-5 pt-10">
          <Skeleton className="h-24" />
          <Skeleton className="h-60" />
        </div>
      </Screen>
    );
  }
  const u = data.user;
  const p = data.prefs;
  const caps = data.capabilities;

  return (
    <Screen tabBar>
      <div className="px-5 pt-8">
        <div className="flex items-center gap-4">
          <Avatar initials={u.initials} color={u.color} size={64} />
          <div>
            <h1 className="t-card">{u.name}</h1>
            <p className="t-caption text-ink-2">{u.phone}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-5 pt-6">
        {/* H1 · WhatsApp notifications */}
        <section className="rounded-[24px] border border-line p-4">
          <h2 className="t-h3">Notifications</h2>
          <Toggle
            checked={p.whatsappEnabled}
            label="WhatsApp notifications"
            description={p.whatsappEnabled ? `On since ${p.consentAt ? new Date(p.consentAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" }) : "—"}` : "Everything still arrives in-app."}
            onChange={(v) => (v ? (setAgree(false), setConsent(true)) : patch({ whatsappEnabled: false }, "WhatsApp off. In-app continues."))}
          />
          {p.whatsappEnabled && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1 border-t border-line pt-1">
              <p className="t-label mt-3 text-[14px] text-ink-2">Send me on WhatsApp</p>
              <Toggle checked={p.breakdown} label="Breakdowns" onChange={(v) => patch({ types: { breakdown: v } })} />
              <Toggle checked={p.request} label="Payment requests" onChange={(v) => patch({ types: { request: v } })} />
              <Toggle checked={p.reminder} label="Reminders" onChange={(v) => patch({ types: { reminder: v } })} />
              <Toggle checked={p.wusoolMaaf} label="Wusool / Maaf updates" onChange={(v) => patch({ types: { wusoolMaaf: v } })} />
            </motion.div>
          )}
          <button onClick={() => nav.push("/wa")} className="mt-2 flex w-full items-center gap-3 rounded-[16px] bg-paper-warm p-3 text-left">
            <MessageCircle size={20} className="text-[#25D366]" />
            <span className="min-w-0 flex-1">
              <span className="t-label block text-[15px]">WhatsApp preview</span>
              <span className="t-caption text-ink-2">Simulated. Nothing is sent.</span>
            </span>
            <ChevronRight size={18} />
          </button>
        </section>

        {/* Get paid: Raast ID / IBAN shown on pay pages to people who owe you */}
        <section className="rounded-[24px] border border-line p-4">
          <h2 className="t-h3">Get paid</h2>
          {hasPayDetails(pay?.details) ? (
            <motion.button {...press(0.985, 0.97)} onClick={() => setEditPay(true)} className="press-own mt-3 flex w-full items-center gap-3 rounded-[16px] bg-paper-warm p-3 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                <Landmark size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-label block truncate text-[15px]">{pay!.details.raast ? `Raast ${pay!.details.raast}` : formatIban(pay!.details.iban!)}</span>
                <span className="t-caption block truncate text-ink-2">{[pay!.details.title, pay!.details.bank, pay!.details.raast && pay!.details.iban ? "IBAN added" : null].filter(Boolean).join(" · ") || "Tap to edit"}</span>
              </span>
              <ChevronRight size={18} />
            </motion.button>
          ) : (
            <>
              <p className="t-caption mt-0.5 text-ink-2">Add a Raast ID or IBAN so friends can pay you from any bank app.</p>
              <Button size="M" full className="mt-3" icon={<Landmark size={17} />} onClick={() => setEditPay(true)}>
                Add payment details
              </Button>
            </>
          )}
        </section>

        {/* J1 · Small-debt threshold */}
        <section id="threshold" className="rounded-[24px] border border-line p-4">
          <h2 className="t-h3">Small-debt threshold</h2>
          <p className="t-caption mt-0.5 text-ink-2">Below this, you get a quick Wusool or Maaf choice.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[50, 100, 200].map((v) => (
              <Chip key={v} className="justify-center px-2" selected={u.threshold === v * 100} onClick={() => saveThreshold(String(v))}>
                {formatPKR(v * 100)}
              </Chip>
            ))}
          </div>
          <div className="mt-3">
            <TextField label="Custom amount" prefix="PKR" value={threshold} onChange={setThreshold} inputMode="decimal" error={thErr} onEnter={() => saveThreshold(threshold)} />
            <Button size="S" variant="outline" className="mt-2" onClick={() => saveThreshold(threshold)}>
              Save
            </Button>
          </div>
        </section>

        {/* J2 · Privacy & data */}
        <section className="rounded-[24px] border border-line p-4">
          <h2 className="t-h3">Privacy & data</h2>
          <p className="t-label mt-3 text-[15px]">Who can see receipts I upload</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip selected={u.receiptVisibility === "members"} onClick={() => patch({ receiptVisibility: "members" }, "Saved")}>
              All members
            </Chip>
            <Chip selected={u.receiptVisibility === "payer_organizer"} onClick={() => patch({ receiptVisibility: "payer_organizer" }, "Saved")}>
              Payer + organizer only
            </Chip>
          </div>
          <Toggle checked={u.hideItems} onChange={(v) => patch({ hideItems: v }, "Saved")} label="Hide my individual items from others" description="Others see totals and who to pay, not what you ordered." />
          <div className="mt-2 flex flex-col gap-2">
            <Button variant="danger" size="M" icon={<Trash size={17} />} onClick={() => setDel(true)}>
              Delete account
            </Button>
          </div>
        </section>

        {/* Several people on one device, for testing invites and Wusool/Maaf without WhatsApp */}
        <section className="surface p-5">
          <h2 className="t-h3">Accounts on this device</h2>
          <ul className="mt-3 flex flex-col gap-1">
            {(accounts?.accounts ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <Avatar initials={a.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()} color={a.color} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="t-label block truncate">{a.name}</span>
                  <span className="t-caption text-ink-2">{a.phone}</span>
                </span>
                {a.current ? (
                  <span className="t-chip rounded-full bg-blue-tint px-3 py-1.5 text-blue">You’re here</span>
                ) : (
                  <Button
                    size="S"
                    variant="outline"
                    onClick={async () => {
                      await api("/api/auth/accounts", "POST", { userId: a.id });
                      await globalMutate(() => true, undefined, { revalidate: true });
                      toast(`Switched to ${a.name.split(" ")[0]}`);
                      nav.replace("/");
                    }}
                  >
                    Switch
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button variant="glass" size="M" full className="mt-2" onClick={() => nav.push("/welcome?add=1")}>
            Add another person
          </Button>
        </section>

        {/* Honest capability labelling */}
        <details className="group rounded-[24px] bg-paper-warm p-4">
          <summary className="t-label flex cursor-pointer list-none items-center gap-2">
            <ShieldCheck size={18} className="text-blue" /> <span className="flex-1">About this prototype</span>
            <ChevronRight size={18} className="transition-transform duration-300 group-open:rotate-90" />
          </summary>
          <ul className="t-caption mt-3 flex flex-col gap-1.5">
            <li>
              <b>Calculations:</b> real, deterministic, integer-paisa ledger with tests.
            </li>
            <li>
              <b>Receipt reading:</b> {caps.ocr === "claude-vision" ? "Claude vision (your API key)" : caps.ocr === "gemini-vision" ? "Gemini vision (your API key)" : "real OCR with Tesseract on this server (add GEMINI_API_KEY for much better accuracy)"}.
            </li>
            <li>
              <b>Story interpretation:</b> {caps.interpreter === "claude" ? "Claude (your API key), validated before use" : caps.interpreter === "gemini" ? "Gemini (your API key), validated before use" : "deterministic rule-based interpreter (no AI key configured)"}.
            </li>
            <li>
              <b>Voice:</b> {caps.stt === "gemini" ? "recorded audio transcribed by Gemini (handles English/Urdu mixing)" : caps.stt === "openai" ? "recorded audio transcribed by OpenAI gpt-4o-transcribe" : "your browser’s built-in recognition (basic; add GEMINI_API_KEY for accurate transcripts)"}.
            </li>
            <li>
              <b>WhatsApp:</b> {caps.whatsapp === "configured" ? "Business Platform configured" : "simulated in-app; share links open real WhatsApp with prefilled text"}.
            </li>
            <li>
              <b>SMS codes:</b> not connected; codes are shown on screen.
            </li>
          </ul>
        </details>

        <Button
          variant="outline"
          full
          icon={<LogOut size={18} />}
          onClick={async () => {
            await api("/api/auth/logout");
            await globalMutate(() => true, undefined, { revalidate: false });
            nav.replace("/welcome");
          }}
        >
          Sign out
        </Button>
      </div>

      <Sheet open={editPay} onClose={() => setEditPay(false)} title="How friends pay you" subtitle="Only people who owe you see this." tall>
        {editPay && <PayDetailsForm initial={pay?.details} name={u.name} maskedPhone={u.phone} onSaved={() => (setEditPay(false), refreshPay(), toast("Saved"))} />}
      </Sheet>

      {/* H1 consent sheet: deliberate, explained, revocable */}
      <Sheet
        open={consent}
        onClose={() => setConsent(false)}
        title="Turn on WhatsApp notifications?"
        footer={
          <Button
            full
            disabled={!agree}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await patch({ whatsappEnabled: true, consent: true }, "WhatsApp notifications on. Change any time.");
              setBusy(false);
              if (ok) setConsent(false);
            }}
          >
            Turn on
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-3">
          <p className="t-body-s">{data.consentText}</p>
          <Notice tone="warm">Messages go to your verified number ({u.phone}). In this prototype they’re simulated in-app: nothing is sent to WhatsApp.</Notice>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--color-blue)]" />
            <span className="t-ui text-[15px]">I agree to receive these WhatsApp messages. I can turn them off any time.</span>
          </label>
        </div>
      </Sheet>

      <ConfirmSheet
        open={del}
        onClose={() => setDel(false)}
        title="Delete your account?"
        body="You’re signed out everywhere. Your entries in outings stay in the ledger but are anonymised, so nobody else’s split breaks. You can’t delete while you have open balances."
        confirmLabel="Delete account"
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api("/api/me", "DELETE");
            await globalMutate(() => true, undefined, { revalidate: false });
            nav.replace("/welcome");
          } catch (e) {
            toast(e instanceof ApiError ? e.message : "Couldn’t delete", "error");
          } finally {
            setBusy(false);
            setDel(false);
          }
        }}
      />
    </Screen>
  );
}
