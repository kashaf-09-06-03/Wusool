"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { BellOff, Link2 } from "lucide-react";
import { useSWRConfig } from "swr";
import { Screen } from "@/components/shell";
import { Button, TextField } from "@/components/ui";
import { Constellation } from "@/components/fx";
import { PhoneVerify } from "@/components/PhoneVerify";
import { api } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";

/** A1 · First launch & identity: Welcome → name + phone → code (mock SMS) → notifications intro → Home. */
export default function Welcome() {
  const search = useSearchParams();
  const adding = search.get("add") === "1";
  const [step, setStep] = useState<"welcome" | "auth" | "notifs" | "paste">(adding ? "auth" : "welcome");
  const [link, setLink] = useState("");
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const nav = useNav();
  const next = search.get("next") || "/";
  const { mutate } = useSWRConfig();

  const finish = async () => {
    await api("/api/me", "PATCH", { onboarded: true });
    await mutate(() => true, undefined, { revalidate: true });
    nav.replace(next.startsWith("/") ? next : "/");
  };

  const openLink = () => {
    const m = link.match(/\/j\/([A-Za-z0-9-]+)/) ?? link.trim().match(/^([A-Za-z0-9]{3}-[A-Za-z0-9]{4})$/);
    if (!m) return setLinkErr("That doesn’t look like a Wusool invite link (…/j/AbC-1234).");
    nav.push(`/j/${m[1]}`);
  };

  return (
    <Screen>
      <div className="flex min-h-dvh flex-col px-5 pb-8 pt-10 sm:min-h-[calc(100dvh-48px)]">
        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <motion.div key="w" className="flex flex-1 flex-col" exit={{ opacity: 0, y: -20 }}>
              <div className="relative flex flex-1 flex-col items-center justify-center text-center">
                <Constellation />
                <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, type: "spring", stiffness: 260, damping: 30 }} className="t-hero mt-4 text-[56px]">
                  Wusool
                </motion.h1>
                <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, type: "spring", stiffness: 260, damping: 30 }} className="t-body mt-2 max-w-[290px] text-ink-2">
                  Tell it what happened. Receipts and a short story in, a fair split out.
                </motion.p>
              </div>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, type: "spring", stiffness: 260, damping: 30 }} className="flex flex-col gap-2">
                <Button full onClick={() => setStep("auth")}>
                  Get started
                </Button>
                <Button variant="text" size="M" full icon={<Link2 size={18} />} onClick={() => setStep("paste")}>
                  Join with an invite link
                </Button>
              </motion.div>
            </motion.div>
          )}
          {step === "paste" && (
            <motion.div key="p" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="flex flex-1 flex-col gap-5 pt-8">
              <h1 className="t-title">Join with a link</h1>
              <TextField label="Invite link" value={link} onChange={(v) => (setLink(v), setLinkErr(null))} placeholder="wusool.app/j/7Kx-93Q" error={linkErr} onEnter={openLink} autoFocus />
              <Button full onClick={openLink}>
                Open invite
              </Button>
              <Button variant="text" size="M" onClick={() => setStep("welcome")}>
                Back
              </Button>
            </motion.div>
          )}
          {step === "auth" && (
            <motion.div key="a" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="flex flex-1 flex-col gap-6 pt-6">
              <div>
                {adding ? (
                  <>
                    <h1 className="t-title">Add another person</h1>
                    <p className="t-body-s mt-2 text-ink-2">For testing on one device: sign in as a friend with a different number. Switch back any time from Profile → Accounts on this device.</p>
                  </>
                ) : (
                  <>
                    <h1 className="t-title">Who are you?</h1>
                    <p className="t-body-s mt-2 text-ink-2">Friends see your name. Your number is only for signing in.</p>
                  </>
                )}
              </div>
              <PhoneVerify
                onVerified={(u) => {
                  if (u.onboarded || adding) finish();
                  else setStep("notifs");
                }}
              />
            </motion.div>
          )}
          {step === "notifs" && (
            <motion.div key="n" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} className="flex flex-1 flex-col gap-6 pt-6">
              <h1 className="t-title">You’re in.</h1>
              <div className="rounded-[24px] bg-paper-warm p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper"><BellOff size={22} /></span>
                  <p className="t-label">WhatsApp notifications: OFF</p>
                </div>
                <p className="t-body-s mt-4 text-ink-2">Everything arrives here in Wusool. Turn on WhatsApp any time in Profile.</p>
              </div>
              <div className="mt-auto">
                <Button full onClick={finish}>
                  Continue
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Screen>
  );
}
