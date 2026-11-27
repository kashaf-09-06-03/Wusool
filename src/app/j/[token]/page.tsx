"use client";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { Clock, Lock } from "lucide-react";
import { Screen } from "@/components/shell";
import { Button, Notice, Skeleton, TextField } from "@/components/ui";
import { PayDetailsForm } from "@/components/PayDetailsForm";
import { hasPayDetails, type PayDetails } from "@/lib/payments";
import { OutingHeader } from "@/components/OutingHeader";
import { PhoneVerify } from "@/components/PhoneVerify";
import { api, ApiError, fetcher } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import type { InvitePreview } from "@/lib/client/types";

type JoinResult = { state: "joined" | "already" | "pending"; outingId: string } | { state: "claim"; outingId: string; guest: { id: string; name: string; addedBy: string } } | { state: "name_taken"; suggestion: string };

/** 05 · Join via link (C1/C2): browser, no install. Preview shows no expenses until you join. */
export default function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, mutate, error } = useSWR<InvitePreview>(`/api/invite/${token}`);
  const nav = useNav();
  const toast = useToast();
  const [name, setName] = useState("");
  const [step, setStep] = useState<"name" | "verify" | "claim" | "pending" | "declined" | "pay">("name");
  const [payFor, setPayFor] = useState<{ outingId: string; phone: string; name: string } | null>(null);
  const [claim, setClaim] = useState<{ id: string; name: string; addedBy: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.viewer?.name && !name) setName(data.viewer.name);
    if (data?.viewer?.membership === "active" && data.outing) nav.replace(`/o/${data.outing.id}`);
    if (data?.viewer?.membership === "pending") setStep("pending");
    if (data?.viewer?.membership === "declined") setStep("declined");
  }, [data, name, nav]);

  // Waiting for approval: the page updates live.
  useEffect(() => {
    if (step !== "pending") return;
    const t = setInterval(() => mutate(), 3000);
    return () => clearInterval(t);
  }, [step, mutate]);

  const join = async (opts: { claimGuestId?: string; notMe?: boolean } = {}) => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<JoinResult>(`/api/invite/${token}`, "POST", { name, ...opts });
      if (r.state === "joined" || r.state === "already") {
        toast(r.state === "joined" ? "You’re in!" : "You’re already in this outing");
        // First time in? Ask (optionally) how friends should pay them back, then go to the outing.
        const [pay, me] = await Promise.all([(fetcher("/api/me/payment") as Promise<{ details: PayDetails }>).catch(() => null), (fetcher("/api/me") as Promise<{ user: { phone: string; name: string } | null }>).catch(() => null)]);
        if (r.state === "joined" && pay && !hasPayDetails(pay.details) && me?.user) {
          setPayFor({ outingId: r.outingId, phone: me.user.phone, name: me.user.name });
          setStep("pay");
        } else nav.replace(`/o/${r.outingId}`);
      } else if (r.state === "pending") setStep("pending");
      else if (r.state === "claim") (setClaim(r.guest), setStep("claim"));
      else if (r.state === "name_taken") {
        setErr(`Someone here is already called ${name.trim()}. Try “${r.suggestion}”.`);
        setName(r.suggestion);
        setStep("name");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setStep("verify");
      else setErr(e instanceof ApiError ? e.message : "Couldn’t join. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = () => {
    if (!name.trim()) return setErr("Add your name so friends recognise you.");
    if (!data?.viewer) setStep("verify");
    else join();
  };

  if (error || (data && data.status !== "valid")) {
    const status = data?.status ?? "missing";
    return (
      <Screen>
        <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
          <motion.img src="/assets/heart3d-cut.png" alt="" className="w-28 opacity-80" initial={{ rotate: -10, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} />
          <h1 className="t-title mt-4">{status === "expired" ? "This link has expired" : status === "revoked" ? "This link was turned off" : "Link not found"}</h1>
          <p className="t-body mt-2 text-ink-2">{status === "expired" ? "Ask for a new link. We can let the organizer know." : "Ask the organizer for a new link."}</p>
          {status === "expired" && data?.outing && (
            <Button
              className="mt-6"
              onClick={async () => {
                try {
                  await api(`/api/invite/${token}/request-link`);
                  toast("The organizer was notified");
                } catch (e) {
                  if (e instanceof ApiError && e.status === 401) nav.push(`/welcome?next=/j/${token}`);
                  else toast("Couldn’t notify the organizer", "error");
                }
              }}
            >
              Request a new link
            </Button>
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      {!data?.outing ? (
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <motion.div initial={{ rotateX: 20, opacity: 0, y: 40 }} animate={{ rotateX: 0, opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 140, damping: 18 }} style={{ transformPerspective: 900 }}>
          <OutingHeader
            outing={{ ...data.outing, isSample: false }}
            members={data.outing.memberInitials}
            memberCount={data.outing.memberCount}
          />
          <div className="px-5 pb-10 pt-6">
            <AnimatePresence mode="wait">
              {step === "name" && (
                <motion.div key="name" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-4">
                  <div>
                    <p className="t-h3">{data.outing.organizerName.split(" ")[0]} invited you to split this outing.</p>
                    <p className="t-ui mt-1 flex items-center gap-1.5 text-[14px] text-ink-2">
                      <Lock size={14} /> You’ll see expenses only after you join.
                    </p>
                  </div>
                  <TextField label="Your name" value={name} onChange={(v) => (setName(v), setErr(null))} helper={`Shown to the ${data.outing.memberCount} member${data.outing.memberCount > 1 ? "s" : ""} of this outing only.`} error={err} maxLength={40} autoComplete="name" onEnter={onJoin} />
                  <Button full onClick={onJoin} loading={busy} className="h-14">
                    Join outing
                  </Button>
                  <p className="t-caption text-ink-2">{data.viewer ? `Signed in as ${data.viewer.name}.` : "Next, a one-time code to your phone. Your number stays private."}</p>
                  <button className="t-label text-[15px] text-blue" onClick={() => nav.push("/")}>
                    Not you, or wrong outing?
                  </button>
                </motion.div>
              )}
              {step === "verify" && (
                <motion.div key="verify" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                  <p className="t-h3">Verify it’s you, {name.split(" ")[0]}</p>
                  <PhoneVerify askName={false} initialName={name} cta="Send code" onVerified={async () => (await mutate(), join())} />
                </motion.div>
              )}
              {step === "claim" && claim && (
                <motion.div key="claim" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col gap-4 rounded-[24px] bg-paper-warm p-5">
                  <p className="t-h3">Are you {claim.name} (added by {claim.addedBy})?</p>
                  <p className="t-body-s text-ink-2">If yes, you’ll take over that entry, so your items and balances aren’t duplicated. The organizer confirms the match.</p>
                  <Button full onClick={() => join({ claimGuestId: claim.id })} loading={busy}>
                    Yes, that’s me
                  </Button>
                  <Button variant="outline" full onClick={() => join({ notMe: true })} loading={busy}>
                    No, I’m someone else
                  </Button>
                </motion.div>
              )}
              {step === "pending" && (
                <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 py-6 text-center">
                  <motion.span animate={{ rotate: [0, 180, 360] }} transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }} className="flex h-14 w-14 items-center justify-center rounded-full bg-lime">
                    <Clock size={26} />
                  </motion.span>
                  <p className="t-h3">Waiting for {data.outing.organizerName.split(" ")[0]} to approve</p>
                  <p className="t-body-s text-ink-2">They’ve been notified. This page updates by itself.</p>
                </motion.div>
              )}
              {step === "pay" && payFor && (
                <motion.div key="pay" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                  <div>
                    <p className="t-h3">How should friends pay you back?</p>
                    <p className="t-caption mt-1 text-ink-2">Only people who owe you see this, on their pay page.</p>
                  </div>
                  <PayDetailsForm
                    name={payFor.name}
                    maskedPhone={payFor.phone}
                    submitLabel="Save and open the outing"
                    onSaved={() => (toast("Saved. Friends can pay you in one tap."), nav.replace(`/o/${payFor.outingId}`))}
                    secondary={
                      <Button variant="text" size="M" full onClick={() => nav.replace(`/o/${payFor.outingId}`)}>
                        Skip for now
                      </Button>
                    }
                  />
                </motion.div>
              )}
              {step === "declined" && (
                <Notice tone="pink">The organizer declined this request. No outing details are shared.</Notice>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </Screen>
  );
}
