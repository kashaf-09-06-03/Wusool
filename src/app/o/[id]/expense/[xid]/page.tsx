"use client";
import { use, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Plus, ScanLine, Trash } from "lucide-react";
import clsx from "clsx";
import { Fab, Screen, TopBar, useMe } from "@/components/shell";
import { Avatar, Button, Chip, ConfirmSheet, Notice, SourcePill, TextField, Toggle, type Provenance } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { computeLedger, splitByWeights } from "@/lib/ledger";
import { formatPKR, parsePKR, type Paisa } from "@/lib/money";
import type { ExpenseData, MemberData, OutingData } from "@/lib/client/types";

export default function ExpensePage({ params }: { params: Promise<{ id: string; xid: string }> }) {
  const { id, xid } = use(params);
  const { me } = useMe();
  const { data, mutate } = useSWR<OutingData>(me ? `/api/outings/${id}` : null);
  if (!data) return <Screen><TopBar back={`/o/${id}`} title="Expense" /></Screen>;
  if (xid === "new") return <ManualExpense data={data} />;
  const exp = data.expenses.find((e) => e.id === xid);
  if (!exp) return <Screen><TopBar back={`/o/${id}`} title="Expense" /><p className="px-5 t-body">This expense was removed.</p></Screen>;
  return <ExpenseEditor key={exp.id} data={data} exp={exp} onSaved={() => mutate()} />;
}

const toPKR = (p: Paisa) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
const first = (n: string) => n.split(" ")[0];

function MemberChips({ members, selected, onToggle, size = "M" }: { members: MemberData[]; selected: string[]; onToggle: (id: string) => void; size?: "S" | "M" }) {
  return (
    <div className="flex flex-wrap gap-2">
      {members.map((m) => {
        const on = selected.includes(m.id);
        return (
          <motion.button
            key={m.id}
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => onToggle(m.id)}
            aria-pressed={on}
            className={clsx("inline-flex items-center gap-1.5 rounded-full pr-3 pl-1 transition-colors", size === "S" ? "h-9" : "h-11", on ? "bg-ink text-white" : "border-[1.5px] border-line-strong bg-paper text-ink")}
          >
            <Avatar initials={m.initials} color={m.color} size={size === "S" ? 26 : 32} ring={false} />
            <span className="t-label text-[14px]">{first(m.name)}</span>
            {on && <Check size={14} strokeWidth={3} className="text-lime" />}
          </motion.button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// E2 · Manual expense with split modes, validated to the paisa
// ---------------------------------------------------------------------------
function ManualExpense({ data }: { data: OutingData }) {
  const nav = useNav();
  const toast = useToast();
  const id = data.outing.id;
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [payers, setPayers] = useState<string[]>([data.me.id]);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({});
  const [sharers, setSharers] = useState<string[]>(data.members.map((m) => m.id));
  const [mode, setMode] = useState<"equal" | "exact" | "percent" | "weights">("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = parsePKR(amount) ?? 0;

  const payerSplit = useMemo(() => {
    if (payers.length === 1) return { [payers[0]]: total };
    const custom = payers.every((p) => payerAmounts[p] !== undefined && payerAmounts[p] !== "");
    if (custom) return Object.fromEntries(payers.map((p) => [p, parsePKR(payerAmounts[p]) ?? 0]));
    const parts = splitByWeights(total, payers.map(() => 1));
    return Object.fromEntries(payers.map((p, i) => [p, parts[i]]));
  }, [payers, payerAmounts, total]);
  const payerSum = Object.values(payerSplit).reduce((a, b) => a + b, 0);

  const remaining = useMemo(() => {
    if (mode === "exact") return total - sharers.reduce((a, m) => a + (parsePKR(values[m] ?? "") ?? 0), 0);
    if (mode === "percent") return 100 - sharers.reduce((a, m) => a + (Number(values[m] ?? 0) || 0), 0);
    return 0;
  }, [mode, sharers, values, total]);

  const preview = useMemo(() => {
    if (!total || !sharers.length) return null;
    let weights: number[];
    if (mode === "equal") weights = sharers.map(() => 1);
    else if (mode === "exact") weights = sharers.map((m) => parsePKR(values[m] ?? "") ?? 0);
    else weights = sharers.map((m) => Number(values[m] ?? 0) || 0);
    if (!weights.some((w) => w > 0) || (mode !== "equal" && remaining !== 0 && mode !== "weights")) return null;
    const parts = splitByWeights(total, weights);
    return sharers.map((m, i) => ({ m, v: parts[i] }));
  }, [total, sharers, mode, values, remaining]);

  const save = async () => {
    setErr(null);
    if (!title.trim()) return setErr("What was it?");
    if (!total) return setErr("Enter an amount above zero.");
    setBusy(true);
    try {
      await api(`/api/outings/${id}/expenses/manual`, "POST", {
        title,
        total,
        payers: payers.map((p) => ({ memberId: p, amount: payerSplit[p] })),
        mode,
        participants: sharers.map((m) => ({ memberId: m, value: mode === "equal" ? 1 : mode === "exact" ? (parsePKR(values[m] ?? "") ?? 0) : Number(values[m] ?? 0) || 0 })),
      });
      toast(`${title} saved`);
      nav.push(`/o/${id}/evidence`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn’t save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar back={`/o/${id}/evidence`} title="Manual expense" />
      <div className="flex flex-col gap-5 px-5 pb-4">
        <TextField label="What was it?" value={title} onChange={setTitle} placeholder="Parking, ice cream, petrol…" maxLength={60} autoFocus />
        <TextField label="Amount" prefix="PKR" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0" />

        <section>
          <p className="t-label mb-2">Who paid?</p>
          <MemberChips members={data.members} selected={payers} onToggle={(m) => setPayers((p) => (p.includes(m) ? (p.length > 1 ? p.filter((x) => x !== m) : p) : [...p, m]))} />
          {payers.length > 1 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {payers.map((p) => (
                <TextField key={p} label={first(data.members.find((m) => m.id === p)?.name ?? "")} prefix="PKR" inputMode="decimal" value={payerAmounts[p] ?? toPKR(payerSplit[p] ?? 0)} onChange={(v) => setPayerAmounts((a) => ({ ...a, [p]: v }))} />
              ))}
              {payerSum !== total && <p className="t-caption col-span-2 text-pink-text">Payers add up to {formatPKR(payerSum)}; the total is {formatPKR(total)}.</p>}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="t-label">Who shared it?</p>
            <button className="t-chip text-blue" onClick={() => setSharers(sharers.length === data.members.length ? [] : data.members.map((m) => m.id))}>
              {sharers.length === data.members.length ? "Clear" : "Everyone"}
            </button>
          </div>
          <MemberChips members={data.members} selected={sharers} onToggle={(m) => setSharers((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))} />
        </section>

        <section>
          <p className="t-label mb-2">Split details</p>
          <div className="glass flex rounded-full p-1" role="radiogroup" aria-label="Split mode">
            {(["equal", "exact", "percent", "weights"] as const).map((k) => (
              <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className="relative h-10 flex-1 rounded-full">
                {mode === k && <motion.span layoutId="split-mode" className="absolute inset-0 rounded-full bg-ink" />}
                <span className={clsx("relative t-label text-[14px]", mode === k ? "text-white" : "text-ink")}>{{ equal: "Equal", exact: "Exact", percent: "%", weights: "Weights" }[k]}</span>
              </button>
            ))}
          </div>
          {mode !== "equal" && (
            <div className="mt-3 flex flex-col gap-2">
              {sharers.map((mId) => {
                const m = data.members.find((x) => x.id === mId)!;
                return (
                  <div key={mId} className="flex items-center gap-3">
                    <Avatar initials={m.initials} color={m.color} size={32} />
                    <span className="t-label min-w-0 flex-1">{first(m.name)}</span>
                    <input aria-label={`${first(m.name)} ${mode}`} inputMode="decimal" value={values[mId] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [mId]: e.target.value }))} placeholder={mode === "exact" ? "PKR" : mode === "percent" ? "%" : "1"} className="t-amount-m h-11 w-28 rounded-[12px] border-[1.5px] border-line-strong px-3 text-right outline-none focus:border-blue" />
                  </div>
                );
              })}
            </div>
          )}
          <AnimatePresence mode="wait">
            {mode === "exact" && remaining !== 0 && total > 0 && (
              <motion.p key="r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="t-label mt-2 text-pink-text">
                {remaining > 0 ? `${formatPKR(remaining)} left to assign` : `${formatPKR(-remaining)} too much`}
              </motion.p>
            )}
            {mode === "percent" && Math.abs(remaining) > 0.001 && (
              <motion.p key="p" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="t-label mt-2 text-pink-text">
                {remaining > 0 ? `${remaining.toFixed(2)}% left to assign` : `${(-remaining).toFixed(2)}% too much`}
              </motion.p>
            )}
          </AnimatePresence>
          {preview && (
            <div className="mt-3 rounded-[16px] bg-paper-warm p-3">
              <p className="t-overline text-ink-2">Each person’s share</p>
              {preview.map(({ m, v }) => (
                <div key={m} className="mt-1.5 flex justify-between t-ui text-[14px]">
                  <span>{first(data.members.find((x) => x.id === m)?.name ?? "")}</span>
                  <span className="tabular font-semibold">{formatPKR(v)}</span>
                </div>
              ))}
              <p className="t-caption mt-2 text-ink-2">Rounded to the paisa; shares add up exactly to {formatPKR(total)}.</p>
            </div>
          )}
        </section>
        {err && <Notice tone="pink" icon={<CircleAlert size={18} />}>{err}</Notice>}
      </div>
      <Fab>
        <Button full onClick={save} loading={busy} disabled={!sharers.length || payerSum !== total}>
          Save expense
        </Button>
      </Fab>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// E5 manual edit: payers, items, sharers, charges with a live deterministic preview
// ---------------------------------------------------------------------------
type DraftItem = { id: string; name: string; amount: string; shares: string[]; confidence: "high" | "low"; weights?: Record<string, number> };
type DraftCharge = { id: string; kind: "tax" | "service" | "fee" | "tip" | "discount" | "other"; label: string; amount: string };

function ExpenseEditor({ data, exp, onSaved }: { data: OutingData; exp: ExpenseData; onSaved: () => void }) {
  const nav = useNav();
  const toast = useToast();
  const id = data.outing.id;
  const [title, setTitle] = useState(exp.title);
  const [payers, setPayers] = useState<string[]>(exp.payers.map((p) => p.memberId));
  const [items, setItems] = useState<DraftItem[]>(
    exp.items.map((i) => ({ id: i.id, name: i.name, amount: toPKR(i.lineTotal), shares: i.shares.map((s) => s.memberId), confidence: i.confidence, weights: Object.fromEntries(i.shares.map((s) => [s.memberId, s.weight])) })),
  );
  const [charges, setCharges] = useState<DraftCharge[]>(exp.charges.map((c) => ({ id: c.id, kind: c.kind as DraftCharge["kind"], label: c.label, amount: toPKR(Math.abs(c.amount)) })));
  const [declared, setDeclared] = useState(exp.declaredTotal != null ? toPKR(exp.declaredTotal) : "");
  const [eligible, setEligible] = useState(exp.equalEligible);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [showOcr, setShowOcr] = useState(false);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const evidence = data.evidence.find((e) => e.id === exp.evidenceId);

  const itemTotal = items.reduce((a, i) => a + (parsePKR(i.amount) ?? 0), 0);
  const chargeTotal = charges.reduce((a, c) => a + (c.kind === "discount" ? -1 : 1) * (parsePKR(c.amount) ?? 0), 0);
  const total = itemTotal + chargeTotal;
  const declaredP = declared.trim() ? parsePKR(declared) : null;
  const unassigned = items.filter((i) => i.shares.length === 0);

  const preview = useMemo(() => {
    if (!payers.length || unassigned.length) return null;
    const parts = splitByWeights(total, payers.map(() => 1));
    const l = computeLedger({
      members: data.members.map((m) => ({ id: m.id, name: m.name })),
      allocation: "actual",
      rounding: "rupee",
      expenses: [
        {
          id: "x",
          title,
          payers: payers.map((p, i) => ({ memberId: p, amount: parts[i] })),
          items: items.map((i) => ({ id: i.id, name: i.name, lineTotal: parsePKR(i.amount) ?? 0, shares: i.shares.map((m) => ({ memberId: m, weight: i.weights?.[m] ?? 1 })) })),
          charges: charges.map((c) => ({ id: c.id, kind: c.kind, label: c.label, amount: (c.kind === "discount" ? -1 : 1) * (parsePKR(c.amount) ?? 0) })),
        },
      ],
    });
    return l.consumed;
  }, [payers, items, charges, total, title, data.members, unassigned.length]);

  const save = async () => {
    if (!payers.length) return toast("Pick who paid", "error");
    if (unassigned.length) return toast(`Assign “${unassigned[0].name}” to someone`, "error");
    setBusy(true);
    const parts = splitByWeights(total, payers.map(() => 1));
    try {
      await api(`/api/expenses/${exp.id}`, "PUT", {
        title,
        payers: payers.map((p, i) => ({ memberId: p, amount: parts[i] })),
        items: items.map((i) => ({ id: i.id, name: i.name || "Item", quantity: 1, lineTotal: parsePKR(i.amount) ?? 0, confidence: "high", shares: i.shares.map((m) => ({ memberId: m, weight: i.weights?.[m] ?? 1 })) })),
        charges: charges.filter((c) => parsePKR(c.amount)).map((c) => ({ kind: c.kind, label: c.label || c.kind, amount: parsePKR(c.amount)!, basis: "prorata" })),
        declaredTotal: declaredP,
        equalEligible: eligible,
      });
      toast("Saved. Re-validated.");
      onSaved();
      nav.back();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (items.length === 1 && !openItem) setOpenItem(items[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const src: Provenance = exp.source === "ride" ? "ride" : exp.source === "manual" ? "manual" : exp.source === "story" ? "story" : exp.source === "sample" ? "sample" : "receipt";

  return (
    <Screen>
      <TopBar back title="Edit expense" right={<button aria-label="Delete expense" onClick={() => setDel(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-warm text-pink-text"><Trash size={18} /></button>} />
      <div className="flex flex-col gap-5 px-5 pb-4">
        <div className="flex items-center gap-2">
          <SourcePill kind={src} />
          {exp.payerSource && <span className="t-caption text-ink-2">payer: {exp.payerSource} · sharers: {exp.shareSource ?? "—"}</span>}
        </div>
        <TextField label="Title" value={title} onChange={setTitle} maxLength={60} />

        {evidence && (
          <div className="flex gap-3 rounded-[18px] bg-paper-warm p-3">
            <a href={`/api/evidence/${evidence.id}/file`} target="_blank" rel="noreferrer" className="h-24 w-20 shrink-0 overflow-hidden rounded-[10px] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/evidence/${evidence.id}/file`} alt="Source image" className="h-full w-full object-cover" />
            </a>
            <div className="min-w-0 flex-1">
              <p className="t-label text-[14px]">Source image</p>
              <p className="t-caption text-ink-2">Read with {evidence.engine === "claude-vision" ? "Claude vision" : evidence.engine === "tesseract" ? "Tesseract OCR (on this server)" : "—"}</p>
              {evidence.ocrText && (
                <button className="t-chip mt-2 inline-flex items-center gap-1 text-blue" onClick={() => setShowOcr((s) => !s)}>
                  <ScanLine size={14} /> {showOcr ? "Hide" : "Show"} raw OCR text
                </button>
              )}
            </div>
          </div>
        )}
        {showOcr && evidence?.ocrText && <pre className="t-caption max-h-48 overflow-auto whitespace-pre-wrap rounded-[12px] bg-ink p-3 text-white">{evidence.ocrText}</pre>}

        <section>
          <p className="t-label mb-2">Who paid?</p>
          <MemberChips members={data.members} selected={payers} onToggle={(m) => setPayers((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]))} />
          {payers.length > 1 && <p className="t-caption mt-1.5 text-ink-2">Split equally between payers. For other splits, add it as separate expenses.</p>}
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="t-label">Items · {items.length}</p>
            <span className="t-caption text-ink-2">Tap an item to change who had it</span>
          </div>
          <div className="flex flex-col gap-2">
            {items.map((it) => (
              <motion.div key={it.id} layout className={clsx("rounded-[16px] border p-3", it.confidence === "low" ? "border-[1.5px] border-ink bg-lime-tint" : it.shares.length ? "border-line" : "border-[1.5px] border-pink-text")}>
                <div className="flex items-center gap-2">
                  <input aria-label="Item name" value={it.name} onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)))} className="t-label min-w-0 flex-1 bg-transparent outline-none" />
                  <span className="t-caption text-ink-2">PKR</span>
                  <input aria-label="Item amount" inputMode="decimal" value={it.amount} onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, amount: e.target.value, confidence: "high" } : x)))} className="t-amount-m w-20 rounded-[10px] border border-line-strong bg-paper px-2 py-1 text-right outline-none focus:border-blue" />
                  <button aria-label="Remove item" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} className="p-1 text-ink-2">
                    <Trash size={15} />
                  </button>
                </div>
                <button onClick={() => setOpenItem(openItem === it.id ? null : it.id)} className="t-caption mt-1.5 flex items-center gap-1 text-left text-ink-2">
                  {it.confidence === "low" && <CircleAlert size={13} className="text-ink" />}
                  {it.shares.length === 0 ? <span className="text-pink-text">Nobody assigned · tap to pick</span> : it.shares.length === data.members.length ? "Shared by everyone" : it.shares.map((m) => first(data.members.find((x) => x.id === m)?.name ?? "?")).join(", ")}
                </button>
                <AnimatePresence>
                  {openItem === it.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pt-2.5">
                      <MemberChips size="S" members={data.members} selected={it.shares} onToggle={(m) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, shares: x.shares.includes(m) ? x.shares.filter((y) => y !== m) : [...x.shares, m] } : x)))} />
                      <div className="mt-2 flex gap-2">
                        <Chip className="h-9" onClick={() => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, shares: data.members.map((m) => m.id) } : x)))}>
                          Everyone
                        </Chip>
                        <Chip className="h-9" onClick={() => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, shares: [] } : x)))}>
                          Nobody
                        </Chip>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
            <Button variant="outline" size="M" icon={<Plus size={17} />} onClick={() => setItems((xs) => [...xs, { id: `new-${Date.now()}`, name: "New item", amount: "0", shares: data.members.map((m) => m.id), confidence: "high" }])}>
              Add item
            </Button>
          </div>
        </section>

        <section>
          <p className="t-label mb-1">Tax, service, fees & discounts</p>
          <p className="t-caption mb-2 text-ink-2">As printed on the receipt. Split pro-rata to what each person had: no tax rates are invented.</p>
          <div className="flex flex-col gap-2">
            {charges.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-[14px] border border-line p-2.5">
                <select aria-label="Charge type" value={c.kind} onChange={(e) => setCharges((xs) => xs.map((x) => (x.id === c.id ? { ...x, kind: e.target.value as DraftCharge["kind"] } : x)))} className="t-chip h-9 rounded-full bg-paper-warm px-2">
                  {["tax", "service", "fee", "tip", "discount", "other"].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input aria-label="Charge label" value={c.label} onChange={(e) => setCharges((xs) => xs.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} className="t-ui min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
                <input aria-label="Charge amount" inputMode="decimal" value={c.amount} onChange={(e) => setCharges((xs) => xs.map((x) => (x.id === c.id ? { ...x, amount: e.target.value } : x)))} className="t-amount-m w-20 rounded-[10px] border border-line-strong px-2 py-1 text-right outline-none" />
                <button aria-label="Remove charge" onClick={() => setCharges((xs) => xs.filter((x) => x.id !== c.id))} className="p-1 text-ink-2">
                  <Trash size={15} />
                </button>
              </div>
            ))}
            <Button variant="text" size="S" icon={<Plus size={15} />} onClick={() => setCharges((xs) => [...xs, { id: `c-${Date.now()}`, kind: "tax", label: "Tax", amount: "" }])}>
              Add a charge
            </Button>
          </div>
        </section>

        <div className="rounded-[18px] bg-paper-warm p-4">
          <div className="flex justify-between t-ui text-[15px]">
            <span>Items</span>
            <span className="tabular">{formatPKR(itemTotal)}</span>
          </div>
          <div className="mt-1 flex justify-between t-ui text-[15px]">
            <span>Charges</span>
            <span className="tabular">{formatPKR(chargeTotal)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 t-label">
            <span>Total</span>
            <span className="tabular">{formatPKR(total)}</span>
          </div>
          <div className="mt-3">
            <TextField label="Total printed on the receipt" prefix="PKR" value={declared} onChange={setDeclared} inputMode="decimal" helper={declaredP != null && declaredP !== total ? undefined : "Used to check the items add up."} error={declaredP != null && declaredP !== total ? `Differs from items + charges by ${formatPKR(declaredP - total, { signed: true })}` : null} />
          </div>
          <Toggle checked={eligible} onChange={setEligible} label="Include in Equal split" description="Turn off for one person’s private purchase." />
        </div>

        {preview && (
          <div className="rounded-[18px] border border-line p-4">
            <p className="t-overline text-ink-2">Who pays what for this expense (live)</p>
            {data.members
              .filter((m) => (preview[m.id] ?? 0) !== 0)
              .map((m) => (
                <div key={m.id} className="mt-1.5 flex justify-between t-ui text-[14px]">
                  <span>{first(m.name)}</span>
                  <span className="tabular font-semibold">{formatPKR(preview[m.id])}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <Fab>
        <Button full onClick={save} loading={busy}>
          Save changes
        </Button>
      </Fab>
      <ConfirmSheet
        open={del}
        onClose={() => setDel(false)}
        title={`Delete ${exp.title}?`}
        body="It’s removed from the draft and the activity history records it."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          try {
            await api(`/api/expenses/${exp.id}`, "DELETE");
            toast("Deleted");
            nav.push(`/o/${id}`);
          } catch (e) {
            toast(e instanceof ApiError ? e.message : "Couldn’t delete", "error");
          }
        }}
      />
    </Screen>
  );
}
