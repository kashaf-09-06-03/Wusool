"use client";
import type { ReactNode } from "react";
import { Calendar, Pencil, User } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { AvatarStack } from "./ui";
import { Banner, Logo } from "./collage";
import { vt } from "@/lib/client/nav";

/** LinkedIn-style identity block: banner, overlapping logo, name, meta, members (Figma "Outing header"). */
export function OutingHeader({
  outing,
  members,
  memberCount,
  onRename,
  topLeft,
  topRight,
  sticker,
}: {
  outing: { id: string; seq: number; name: string; banner: string; logoType: string; logoValue: string | null; date: string | null; place: string | null; organizerName: string; isSample?: boolean };
  members: { initials: string; color: string }[];
  memberCount: number;
  onRename?: () => void;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  sticker?: ReactNode;
}) {
  // Parallax: the banner drifts slower than the page; pulling down stretches it (iOS-style).
  const { scrollY } = useScroll();
  const bannerY = useTransform(scrollY, [0, 220], [0, 70]);
  const bannerScale = useTransform(scrollY, [-120, 0], [1.2, 1]);
  const logoScale = useTransform(scrollY, [0, 160], [1, 0.82]);
  return (
    <div>
      <div className="relative overflow-hidden">
        <motion.div style={{ y: bannerY, scale: bannerScale, transformOrigin: "50% 0%" }}>
          <Banner banner={outing.banner} className="h-[200px]" interactive vtName={`banner-${outing.id}`} sticker={sticker} />
        </motion.div>
        <div className="absolute inset-x-4 top-4 flex items-center justify-between">
          {topLeft}
          <div className="flex gap-2">{topRight}</div>
        </div>
      </div>
      <div className="relative z-10 -mt-12 px-4">
        <motion.div style={{ scale: logoScale, transformOrigin: "0% 100%" }} className="inline-block">
          <Logo type={outing.logoType} value={outing.logoValue} name={outing.name} size={92} vtName={`logo-${outing.id}`} />
        </motion.div>
      </div>
      <div className="px-5 pt-2">
        <p className="t-overline text-ink-2">
          Outing {String(outing.seq).padStart(3, "0")}
          {outing.isSample && <span className="ml-2 rounded-full bg-pink-tint px-1.5 py-0.5 text-pink-text">Sample data</span>}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="t-title" style={vt(`title-${outing.id}`)}>
            {outing.name}
          </h1>
          {onRename && (
            <motion.button whileTap={{ scale: 0.9 }} onClick={onRename} aria-label="Rename outing" className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-warm">
              <Pencil size={17} />
            </motion.button>
          )}
        </div>
        {(outing.date || outing.place) && (
          <p className="t-ui mt-2 flex items-center gap-2 text-[14px] text-ink-2">
            <Calendar size={15} /> {[outing.date, outing.place].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="t-ui mt-1 flex items-center gap-2 text-[14px] text-ink-2">
          <User size={15} /> Organized by {outing.organizerName}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <AvatarStack people={members.slice(0, 3)} extra={Math.max(0, memberCount - 3)} size={34} />
          <span className="t-label text-[14px]">
            {memberCount} member{memberCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}
