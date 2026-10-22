import "server-only";
import fs from "node:fs";
import path from "node:path";
import { all, get, newId, now, run, UPLOAD_DIR } from "./db";
import { bad, forbidden, notFound } from "./http";
import { membersOf, requireMember } from "./outings";
import { logActivity, notify } from "./notify";
import type { User } from "./auth";

/** Memories (I1–I4): members-only photos, stored separately from receipt evidence. */
const OK = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

export async function addPhotos(outingId: string, user: User, files: File[]) {
  const { me } = requireMember(outingId, user);
  const results: { name: string; ok: boolean; error?: string; id?: string }[] = [];
  for (const f of files) {
    if (!OK.has(f.type)) {
      results.push({ name: f.name, ok: false, error: "Unsupported file type" });
      continue;
    }
    if (f.size > 15 * 1024 * 1024) {
      results.push({ name: f.name, ok: false, error: "Over 15 MB" });
      continue;
    }
    const id = newId("ph_");
    const file = id + OK.get(f.type);
    fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(await f.arrayBuffer()));
    run("INSERT INTO photos (id, outing_id, member_id, file_name, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, outingId, me.id, file, f.type, now());
    results.push({ name: f.name, ok: true, id });
  }
  const n = results.filter((r) => r.ok).length;
  if (n) logActivity(outingId, me.id, "photos", `${me.name} added ${n} photo${n > 1 ? "s" : ""} to Memories`);
  return results;
}

export function listPhotos(outingId: string, user: User) {
  const { me } = requireMember(outingId, user);
  const members = membersOf(outingId, true);
  return all<{ id: string; member_id: string; created_at: string }>("SELECT id, member_id, created_at FROM photos WHERE outing_id = ? ORDER BY created_at DESC", outingId).map((p) => {
    const reactions = all<{ emoji: string; member_id: string }>("SELECT emoji, member_id FROM photo_reactions WHERE photo_id = ?", p.id);
    const counts: Record<string, number> = {};
    for (const r of reactions) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
    const uploader = members.find((m) => m.id === p.member_id);
    const pendingRemoval = get<{ id: string; requester_member_id: string }>("SELECT * FROM removal_requests WHERE photo_id = ? AND status = 'pending'", p.id);
    return {
      id: p.id,
      uploader: { id: p.member_id, name: uploader?.name ?? "Former member", color: uploader?.color ?? "ink" },
      createdAt: p.created_at,
      reactions: counts,
      mine: reactions.filter((r) => r.member_id === me.id).map((r) => r.emoji),
      canDelete: p.member_id === me.id || me.role === "organizer",
      removalRequested: pendingRemoval ? { id: pendingRemoval.id, byMe: pendingRemoval.requester_member_id === me.id } : null,
      isUploader: p.member_id === me.id,
    };
  });
}

export function readPhoto(photoId: string, user: User) {
  const p = get<{ outing_id: string; file_name: string; mime: string }>("SELECT * FROM photos WHERE id = ?", photoId);
  if (!p) throw notFound();
  requireMember(p.outing_id, user);
  return { data: fs.readFileSync(path.join(UPLOAD_DIR, p.file_name)), mime: p.mime };
}

export function react(photoId: string, user: User, emoji: string) {
  const p = get<{ outing_id: string }>("SELECT outing_id FROM photos WHERE id = ?", photoId);
  if (!p) throw notFound();
  const { me } = requireMember(p.outing_id, user);
  if (!["♥", "😂", "🔥", "😮"].includes(emoji)) throw bad("Unknown reaction.");
  if (get("SELECT 1 FROM photo_reactions WHERE photo_id = ? AND member_id = ? AND emoji = ?", photoId, me.id, emoji))
    run("DELETE FROM photo_reactions WHERE photo_id = ? AND member_id = ? AND emoji = ?", photoId, me.id, emoji);
  else run("INSERT INTO photo_reactions (photo_id, member_id, emoji) VALUES (?, ?, ?)", photoId, me.id, emoji);
}

export function deletePhoto(photoId: string, user: User) {
  const p = get<{ outing_id: string; member_id: string; file_name: string }>("SELECT * FROM photos WHERE id = ?", photoId);
  if (!p) throw notFound();
  const { me } = requireMember(p.outing_id, user);
  if (p.member_id !== me.id && me.role !== "organizer") throw forbidden("Only the uploader or organizer can remove this photo. You can request removal.");
  run("DELETE FROM photos WHERE id = ?", photoId);
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, p.file_name));
  } catch {
    /* ignore */
  }
  if (p.member_id !== me.id) {
    const uploader = membersOf(p.outing_id, true).find((m) => m.id === p.member_id);
    notify({ userId: uploader?.user_id, outingId: p.outing_id, type: "photo", title: "A photo was removed", body: `${me.name} (organizer) removed one of your photos.` });
  }
  logActivity(p.outing_id, me.id, "photo_removed", `${me.name} removed a photo`);
}

export function requestRemoval(photoId: string, user: User, reason: string) {
  const p = get<{ outing_id: string; member_id: string }>("SELECT * FROM photos WHERE id = ?", photoId);
  if (!p) throw notFound();
  const { me } = requireMember(p.outing_id, user);
  if (get("SELECT 1 FROM removal_requests WHERE photo_id = ? AND status = 'pending'", photoId)) return;
  run("INSERT INTO removal_requests (id, photo_id, requester_member_id, reason, created_at) VALUES (?, ?, ?, ?, ?)", newId("rr_"), photoId, me.id, reason.slice(0, 200) || null, now());
  const members = membersOf(p.outing_id, true);
  const uploader = members.find((m) => m.id === p.member_id);
  const org = members.find((m) => m.role === "organizer");
  for (const uid of new Set([uploader?.user_id, org?.user_id]))
    notify({ userId: uid, outingId: p.outing_id, type: "photo", title: "Photo removal request", body: `${me.name} asked to remove a photo they’re in${reason ? `: “${reason}”` : ""}.`, link: `/o/${p.outing_id}?tab=memories&photo=${photoId}` });
}

export function decideRemoval(photoId: string, user: User, approve: boolean) {
  const p = get<{ outing_id: string; member_id: string }>("SELECT * FROM photos WHERE id = ?", photoId);
  if (!p) throw notFound();
  const { me } = requireMember(p.outing_id, user);
  if (p.member_id !== me.id && me.role !== "organizer") throw forbidden();
  const rr = get<{ id: string; requester_member_id: string }>("SELECT * FROM removal_requests WHERE photo_id = ? AND status = 'pending'", photoId);
  if (!rr) throw notFound("No pending request.");
  run("UPDATE removal_requests SET status = ? WHERE id = ?", approve ? "approved" : "declined", rr.id);
  const requester = membersOf(p.outing_id, true).find((m) => m.id === rr.requester_member_id);
  if (approve) deletePhoto(photoId, user);
  notify({ userId: requester?.user_id, outingId: p.outing_id, type: "photo", title: approve ? "Photo removed" : "Removal declined", body: approve ? "The photo you asked about was removed." : "The uploader kept the photo. You can ask the organizer to step in." });
}

/** I4: members suggest a banner; only the organizer can set it. */
export function suggestBanner(photoId: string, user: User) {
  const p = get<{ outing_id: string }>("SELECT outing_id FROM photos WHERE id = ?", photoId);
  if (!p) throw notFound();
  const { me } = requireMember(p.outing_id, user);
  const org = membersOf(p.outing_id).find((m) => m.role === "organizer");
  notify({ userId: org?.user_id, outingId: p.outing_id, type: "photo", title: "Banner suggestion", body: `${me.name} suggests a Memories photo as the outing banner.`, link: `/o/${p.outing_id}?tab=memories&photo=${photoId}` });
}
