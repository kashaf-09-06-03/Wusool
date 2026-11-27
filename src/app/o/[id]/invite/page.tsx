"use client";
import { use, useState } from "react";
import useSWR from "swr";
import { motion } from "motion/react";
import { ArrowRight, ChevronRight, Landmark } from "lucide-react";
import { Screen, TopBar, useMe } from "@/components/shell";
import { Button, press, Sheet, Skeleton } from "@/components/ui";
import { PayDetailsForm } from "@/components/PayDetailsForm";
import { hasPayDetails, type PayDetails } from "@/lib/payments";
import { Logo } from "@/components/collage";
import { InviteActions, LinkSettingsSheet, ManualAddSheet, Roster } from "@/components/invite";
import { useNav } from "@/lib/client/nav";
import type { OutingData } from "@/lib/client/types";

/** 04 · Invite (B4): link-first; manual add is a visible backup; roster updates live. */
export default function Invite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data, mutate } = useSWR<OutingData>(me ? `/api/outings/${id}` : null, { refreshInterval: 3000 });
  const nav = useNav();
  const [settings, setSettings] = useState(false);
  const [manual, setManual] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const { data: pay, mutate: refreshPay } = useSWR<{ details: PayDetails }>(me ? "/api/me/payment" : null);
  const { data: profile } = useSWR<{ user: { phone: string } | null }>(me ? "/api/me" : null);

  return (
    <Screen>
      <TopBar back={`/o/${id}`} title="Invite friends" collapse />
      {!data ? (
        <div className="flex flex-col gap-4 px-5">
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <div className="px-5 pb-10">
          <div className="flex items-center gap-3">
            <Logo type={data.outing.logoType} value={data.outing.logoValue} name={data.outing.name} size={48} />
            <p className="t-h3 min-w-0 truncate">{data.outing.name}</p>
          </div>
          <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 320, damping: 32 }} className="t-hero mt-5">
            Get everyone in.
          </motion.h1>
          <p className="t-body mt-2 text-ink-2">Paste the link in your group chat. Friends join themselves.</p>
          <div className="mt-8">
            <InviteActions data={data} onSettings={() => setSettings(true)} onManual={() => setManual(true)} />
          </div>
          {pay && !hasPayDetails(pay.details) && (
            <motion.button {...press(0.985, 0.97)} onClick={() => setPaySheet(true)} className="press-own mt-6 flex w-full items-center gap-3 rounded-[18px] bg-blue-tint p-3.5 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue text-white">
                <Landmark size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-label block text-[15px]">Add how friends pay you</span>
                <span className="t-caption text-ink-2">Your Raast ID, in one tap</span>
              </span>
              <ChevronRight size={18} className="text-ink-2" />
            </motion.button>
          )}
          <div className="mt-7">
            <Roster data={data} live />
          </div>
          <Button variant="outline" full className="mt-6" icon={<ArrowRight size={18} />} onClick={() => nav.push(`/o/${id}`)}>
            Go to outing
          </Button>
          <LinkSettingsSheet open={settings} onClose={() => setSettings(false)} data={data} onChanged={() => mutate()} />
          <Sheet open={paySheet} onClose={() => setPaySheet(false)} title="How friends pay you" subtitle="Only people who owe you see this." tall>
            {paySheet && <PayDetailsForm name={me?.name} maskedPhone={profile?.user?.phone} onSaved={() => (setPaySheet(false), refreshPay())} />}
          </Sheet>
          <ManualAddSheet open={manual} onClose={() => setManual(false)} outingId={id} onDone={() => mutate()} />
        </div>
      )}
    </Screen>
  );
}
