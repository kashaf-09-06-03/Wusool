"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { BellOff, Link2 } from "lucide-react";
import { useSWRConfig } from "swr";
import { Screen } from "@/components/shell";
import { Button, Sticker, TextField } from "@/components/ui";
import { Doodle } from "@/components/collage";
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
                <motion.img
                  src="/assets/star3d-cut.png"
                  alt=""
                  initial={{ scale: 0.2, rotate: -120, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1, y: [0, -10, 0] }}
                  transition={{ scale: { type: "spring", stiffness: 160, damping: 14 }, rotate: { type: "spring", stiffness: 120, damping: 12 }, y: { repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1 } }}
                  className="w-44 drop-shadow-[0_24px_30px_rgba(31,59,255,0.25)]"
                />
                <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="t-hero mt-6 text-[56px]">
                  Wusool
                </motion.h1>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="t-body mt-2 max-w-[300px] text-ink-2">
                  Tell Wusool what happened. Receipts and a short story in, a fair split out.
                </motion.p>
                <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: -6 }} transition={{ delay: 0.7, type: "spring", stiffness: 300, damping: 14 }} className="mt-6">
                  <Sticker color="lime">tap. join. split. Maaf if it’s tiny ✦</Sticker>
                </motion.div>
                <Doodle kind="squiggle" draw className="absolute left-2 top-10 h-8 w-24 text-pink" />
                <Doodle kind="spark" color="#c6f432" className="absolute right-6 top-24 h-8 w-8" />
                <Doodle kind="burst" className="absolute bottom-24 left-8 h-8 w-8 text-blue" />
              </div>
              <div className="flex flex-col gap-2">
                <Button full onClick={() => setStep("auth")}>
                  Get started
                </Button>
                <Button variant="text" size="M" full icon={<Link2 size={18} />} onClick={() => setStep("paste")}>
                  Have an invite link? Paste to join
                </Button>
              </div>
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
                    <p className="t-overline text-ink-2">Step 1 of 2</p>
                    <h1 className="t-title mt-1">Who are you?</h1>
                    <p className="t-body-s mt-2 text-ink-2">Your name is what friends see. Your phone is only for signing in.</p>
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
              <div>
                <p className="t-overline text-ink-2">Step 2 of 2</p>
                <h1 className="t-title mt-1">You’re in. One thing about messages.</h1>
              </div>
              <div className="rounded-[24px] bg-paper-warm p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper"><BellOff size={22} /></span>
                  <div>
                    <p className="t-label">WhatsApp notifications: OFF</p>
                    <p className="t-caption text-ink-2">That’s the default for everyone.</p>
                  </div>
                </div>
                <p className="t-body-s mt-4">
                  You’ll always see breakdowns and requests here in Wusool. If you want them on WhatsApp too, turn it on yourself any time in <b>Profile → Notifications</b>. Sharing an invite link never turns it on.
                </p>
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
