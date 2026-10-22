import "server-only";
import { get, newId, now, run, tx } from "./db";
import { createOuting, bumpDraft } from "./outings";
import { logActivity } from "./notify";
import { pickColor, type User } from "./auth";
import { SAMPLE_EXPENSES, SAMPLE_MEMBERS } from "@/lib/sample";

/**
 * Creates the labelled SAMPLE outing from the Figma screens ("Do Darya Night", PKR 12,060).
 * The signed-in user plays Ayesha (organizer); the other five are manual guests marked as sample.
 * Useful for demos and usability sessions; never mixed with real data.
 */
export function createSampleOuting(user: User) {
  return tx(() => {
    const o = createOuting(user, { name: "Do Darya Night", banner: "sea", logoType: "cup3d", date: "Sat 18 Oct", place: "Sea View, Karachi", isSample: true });
    const ids: Record<string, string> = {};
    const fullNames: Record<string, string> = { mariam: "Mariam Siddiqui", talha: "Talha Hussain", hamza: "Hamza Ali", sara: "Sara Raza", bilal: "Bilal Ahmed" };
    const orgMember = get<{ id: string }>("SELECT id FROM members WHERE outing_id = ? AND role = 'organizer'", o.id)!;
    ids.ayesha = orgMember.id;
    for (const m of SAMPLE_MEMBERS) {
      if (m.id === "ayesha") continue;
      const id = newId("m_");
      ids[m.id] = id;
      run(
        "INSERT INTO members (id, outing_id, name, kind, status, role, added_by_member_id, color, created_at) VALUES (?, ?, ?, 'manual', 'active', 'member', ?, ?, ?)",
        id,
        o.id,
        fullNames[m.id] ?? m.name,
        orgMember.id,
        pickColor(m.id + id),
        now(),
      );
    }
    SAMPLE_EXPENSES.forEach((e, pos) => {
      const eid = newId("e_");
      const total = e.items.reduce((a, i) => a + i.lineTotal, 0) + e.charges.reduce((a, c) => a + c.amount, 0);
      run(
        "INSERT INTO expenses (id, outing_id, source, title, declared_total, payer_source, share_source, confirmed, created_by_member_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'sample', 'sample', 1, ?, ?, ?, ?)",
        eid,
        o.id,
        e.id === "parking" ? "manual" : e.id === "careem" ? "ride" : "receipt",
        e.title,
        total,
        orgMember.id,
        pos,
        now(),
        now(),
      );
      for (const p of e.payers) run("INSERT INTO expense_payers (expense_id, member_id, amount) VALUES (?, ?, ?)", eid, ids[p.memberId], p.amount);
      e.items.forEach((it, i) => {
        const iid = newId("it_");
        run("INSERT INTO items (id, expense_id, name, quantity, line_total, confidence, position) VALUES (?, ?, ?, ?, ?, 'high', ?)", iid, eid, it.name, it.quantity ?? 1, it.lineTotal, i);
        for (const s of it.shares) run("INSERT INTO item_shares (item_id, member_id, weight) VALUES (?, ?, ?)", iid, ids[s.memberId], s.weight);
      });
      for (const c of e.charges) run("INSERT INTO charges (id, expense_id, kind, label, amount, basis) VALUES (?, ?, ?, ?, ?, 'prorata')", newId("ch_"), eid, c.kind, c.label, c.amount);
    });
    bumpDraft(o.id);
    logActivity(o.id, orgMember.id, "sample", "Loaded the SAMPLE outing (synthetic names, places and amounts)");
    return o.id;
  });
}
