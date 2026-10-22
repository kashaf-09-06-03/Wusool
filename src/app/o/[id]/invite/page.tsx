"use client";
import { use, useState } from "react";
import useSWR from "swr";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Screen, TopBar, useMe } from "@/components/shell";
import { Button, Skeleton } from "@/components/ui";
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
            <div className="min-w-0">
              <p className="t-h3 truncate">{data.outing.name}</p>
              <p className="t-caption text-ink-2">
                Outing {String(data.outing.seq).padStart(3, "0")} · {data.me.role === "organizer" ? "you’re the organizer" : `organized by ${data.outing.organizerName}`}
              </p>
            </div>
          </div>
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="t-hero mt-5">
            Get everyone in.
          </motion.h1>
          <p className="t-body mt-2 text-ink-2">Paste this link in your WhatsApp group. Friends tap it and join themselves. No need to add anyone.</p>
          <div className="mt-8">
            <InviteActions data={data} onSettings={() => setSettings(true)} onManual={() => setManual(true)} />
          </div>
          <div className="mt-7">
            <Roster data={data} live />
          </div>
          <Button variant="outline" full className="mt-6" icon={<ArrowRight size={18} />} onClick={() => nav.push(`/o/${id}`)}>
            Done · go to the outing
          </Button>
          <LinkSettingsSheet open={settings} onClose={() => setSettings(false)} data={data} onChanged={() => mutate()} />
          <ManualAddSheet open={manual} onClose={() => setManual(false)} outingId={id} onDone={() => mutate()} />
        </div>
      )}
    </Screen>
  );
}
