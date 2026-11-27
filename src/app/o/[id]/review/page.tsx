"use client";
import { use, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import { CheckCheck, ChevronLeft, CircleAlert, Ellipsis, Mic, Pencil, Send, Sparkles } from "lucide-react";
import clsx from "clsx";
import { Fab, Screen, TopBar, useMe } from "@/components/shell";
import { AvatarStack, Button, Chip, IconButton, Notice, OptionCard, Segmented, Sheet, Skeleton, SourcePill, TextField, Toggle, type Provenance } from "@/components/ui";
import { DebtGraph } from "@/components/DebtGraph";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { formatAmount, formatPKR, parsePKR } from "@/lib/money";
import type { ExpenseData, OutingData, PreviewData, QuestionData } from "@/lib/client/types";
import { expenseTotal, isUniformEqual, memberLookup, participantsOf, SourceIcon } from "../tabs/util";

type Rules = { onlyKnown?: boolean; collectorId?: string | null; skipNoAccount?: boolean };

/** 10a/10b · What Wusool understood: verify, correct, then two separate decisions. */
export default function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data, mutate } = useSWR<OutingData>(me ? `/api/outings/${id}` : null);
  const nav = useNav();
  const [allocation, setAllocation] = useState<"actual" | "equal" | null>(null);
  const [routing, setRouting] = useState<"original" | "optimized" | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [graph, setGraph] = useState(false);
  const isOrg = data?.me.role === "organizer";

  useEffect(() => {
    if (data && allocation === null) {
      setAllocation(data.outing.allocation);
      setRouting(data.outing.routing);
      setRules({ onlyKnown: true, ...data.outing.rules });
    }
  }, [data, allocation]);

  const qs = allocation && routing && rules ? `allocation=${allocation}&routing=${routing}&rules=${encodeURIComponent(JSON.stringify(rules))}` : null;
  const { data: preview, mutate: refreshPreview } = useSWR<PreviewData>(data && qs ? `/api/outings/${id}/settlement?${qs}&rev=${data.outing.draftRev}` : null, { keepPreviousData: true });

  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const choose = (patch: { allocation?: "actual" | "equal"; routing?: "original" | "optimized"; rules?: Rules }) => {
    if (patch.allocation) setAllocation(patch.allocation);
    if (patch.routing) setRouting(patch.routing);
    if (patch.rules) setRules(patch.rules);
    // Persist so every member sees the organizer's current choices.
    if (isOrg) saving.current = api(`/api/outings/${id}/settlement`, "PATCH", { allocation: patch.allocation ?? allocation, routing: patch.routing ?? routing, rules: patch.rules ?? rules }).then(() => mutate()).catch(() => {});
  };
  const goConfirm = async () => {
    await saving.current;
    // Pass the exact choices shown here so Confirm publishes what the organizer saw.
    nav.push(`/o/${id}/confirm?allocation=${allocation}&routing=${routing}&rules=${encodeURIComponent(JSON.stringify(rules))}`);
  };
  const refresh = async () => {
    await mutate();
    await refreshPreview();
  };

  if (!data) {
    return (
      <Screen>
        <TopBar back={`/o/${id}`} title="Review" />
        <div className="flex flex-col gap-4 px-5">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-44" />
          <Skeleton className="h-60" />
        </div>
      </Screen>
    );
  }

  const m = memberLookup(data);
  const total = data.expenses.reduce((a, e) => a + expenseTotal(e), 0);
  const blocking = data.questions.filter((q) => q.blocking && q.status !== "answered");
  const blockingAll = data.questions.filter((q) => q.blocking);
  const answered = blockingAll.length - blocking.length;
  const notes = data.questions.filter((q) => !q.blocking && q.status !== "answered");

  return (
    <Screen>
      <TopBar back={`/o/${id}`} title="What Wusool understood" collapse right={<IconButton label="Outing" surface="solid" onClick={() => nav.push(`/o/${id}`)}><Ellipsis size={20} /></IconButton>} />
      <div className="flex flex-col gap-5 px-5 pb-4">
        <div>
          <h1 className="t-title">What Wusool understood</h1>
          <p className="t-ui mt-2 text-[14px] text-ink-2">
            {data.members.length} people · {formatPKR(total)}
          </p>
        </div>

        {/* Quick questions (≤ a handful, 2–3 chips each) */}
        {blockingAll.length > 0 && (
          <motion.section layout className="rounded-[24px] bg-paper-warm p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="t-h3">
                {blockingAll.length} quick question{blockingAll.length > 1 ? "s" : ""}
              </h2>
              <span className="t-caption text-ink-2">
                {answered} of {blockingAll.length} answered
              </span>
            </div>
            <div className="mt-2 divide-y divide-line">
              {blockingAll.map((q) => (
                <QuestionView key={q.id} q={q} onDone={refresh} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Expense cards with provenance */}
        <div className="flex flex-col gap-3">
          {data.expenses.map((e, i) => (
            <ExpenseCard key={e.id} e={e} data={data} index={i} questions={data.questions.filter((q) => q.expenseId === e.id && q.status !== "answered")} onEdit={() => nav.push(`/o/${id}/expense/${e.id}`)} onChanged={refresh} optimized={routing === "optimized"} />
          ))}
          {data.expenses.length === 0 && <Notice tone="warm">No expenses yet. Add receipts or a manual expense first.</Notice>}
        </div>

        {notes.length > 0 && (
          <div className="flex flex-col gap-2">
            {notes.map((q) => (
              <Notice key={q.id} tone="warm" icon={<CircleAlert size={16} />}>
                <span className="t-label text-[14px]">{q.text}</span>
                {q.detail && <span className="t-caption block text-ink-2">{q.detail}</span>}
                <button className="t-chip mt-1 text-blue" onClick={async () => (await api(`/api/questions/${q.id}`, "POST", { optionId: q.options[0]?.id ?? "ok" }), refresh())}>
                  {q.options[0]?.label ?? "OK"}
                </button>
              </Notice>
            ))}
          </div>
        )}

        <CorrectionBar outingId={id} onApplied={refresh} />

        {/* Two separate decisions: cost allocation, then payment routing (CLAUDE.md §5.6). */}
        <section className="mt-2 rounded-[24px] bg-paper-warm p-4" role="radiogroup" aria-label="Who pays for what">
          <h3 className="t-h3">Who pays for what?</h3>
          <p className="t-caption mt-0.5 text-ink-2">Sets how much each person owes.</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <OptionCard title="Actual / individual" tag="Recommended" selected={allocation === "actual"} onClick={() => isOrg && choose({ allocation: "actual" })} description="Each person pays for what they had. Tax & fees split pro-rata." />
            <OptionCard title="Equal split" selected={allocation === "equal"} onClick={() => isOrg && choose({ allocation: "equal" })} description={preview ? `Everyone pays ${formatPKR(preview.equalShare)} for eligible expenses.` : "Everyone pays the same."} />
            {preview && <EqualWarning preview={preview} data={data} />}
          </div>
        </section>

        <section className="rounded-[24px] bg-paper-warm p-4" role="radiogroup" aria-label="Who pays whom">
          <h3 className="t-h3">Who pays whom?</h3>
          <p className="t-caption mt-0.5 text-ink-2">Only changes who sends money to whom. Nobody’s total changes.</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <OptionCard title="Original debts" tag="Default" tagTone="lime" selected={routing === "original"} onClick={() => isOrg && choose({ routing: "original" })} description={`Pay back whoever paid for you${preview ? ` · ${preview.originalDebts.length} transfer${preview.originalDebts.length === 1 ? "" : "s"}` : ""}.`} />
            <OptionCard title="Optimized" tag="Opt-in" selected={routing === "optimized"} onClick={() => isOrg && choose({ routing: "optimized" })} description={`Fewer transfers, same totals for everyone${preview ? ` · ${preview.optimizedEdges.length} transfer${preview.optimizedEdges.length === 1 ? "" : "s"}` : ""}.`} />
            <AnimatePresence>{routing === "optimized" && preview && <OptimizedPanel preview={preview} data={data} onOpen={() => setGraph(true)} onBack={() => isOrg && choose({ routing: "original" })} />}</AnimatePresence>
          </div>
          {!isOrg && <p className="t-caption mt-3 text-ink-2">Only the organizer ({data.outing.organizerName.split(" ")[0]}) can change these choices.</p>}
        </section>

      </div>

      <Fab>
        {isOrg ? (
          <Button full onClick={goConfirm} disabled={!preview || data.expenses.length === 0}>
            Review & confirm
          </Button>
        ) : (
          <Button full variant="outline" onClick={() => nav.push(data.plan ? `/o/${id}/me` : `/o/${id}`)}>
            {data.plan ? "See my breakdown" : "Back to outing"}
          </Button>
        )}
        {blocking.length > 0 && <p className="t-caption mt-2 text-center text-ink-2">Answer {blocking.length} question{blocking.length > 1 ? "s" : ""} before publishing</p>}
      </Fab>

      {preview && rules && <GraphSheet open={graph} onClose={() => setGraph(false)} preview={preview} data={data} rules={rules} isOrg={!!isOrg} onRules={(r) => choose({ rules: r })} onUse={() => (choose({ routing: "optimized" }), setGraph(false))} onBack={() => (choose({ routing: "original" }), setGraph(false))} />}
    </Screen>
  );
}

function QuestionView({ q, onDone }: { q: QuestionData; onDone: () => Promise<unknown> | void }) {
  const toast = useToast();
  const [amountFor, setAmountFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const send = async (payload: object, optimistic: string | null) => {
    setPending(optimistic);
    try {
      await api(`/api/questions/${q.id}`, "POST", payload);
      setAmountFor(null);
      await onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save", "error");
    } finally {
      setPending(null);
    }
  };
  const done = q.status === "answered";
  const selectedId = pending ?? (done ? (q.selected as string | null) : null);
  return (
    <motion.div layout className="py-4">
      <div className="flex items-start gap-3">
        <motion.span layout className={clsx("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", done ? "bg-blue text-white" : "bg-lime ring-[1.5px] ring-inset ring-ink")} aria-hidden>
          {done ? <CheckCheck size={12} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="t-label text-[16px]">{q.text}</p>
          {q.detail && <p className="t-caption mt-0.5 text-ink-2">{q.detail}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {q.options.map((o) => {
              const selected = selectedId === o.id || (typeof q.answer === "object" && q.answer?.opt === o.id && done && !pending);
              return (
                <Chip
                  key={o.id}
                  selected={Boolean(selected)}
                  onClick={() => {
                    if (pending) return;
                    if (selected) return send({ optionId: "", reopen: true }, null); // tap again to clear
                    if (o.input) return setAmountFor(o.id);
                    send({ optionId: o.id }, o.id);
                  }}
                >
                  {o.label}
                </Chip>
              );
            })}
            {!done && q.status !== "skipped" && (
              <button className="t-chip px-2 text-ink-2" onClick={() => send({ skip: true }, null)}>
                Skip
              </button>
            )}
          </div>
          {done && <p className="t-caption mt-2 text-ink-3">Tap another answer to change it, or the selected one to clear it.</p>}
          {q.status === "skipped" && <p className="t-caption mt-2 text-pink-text">Skipped: still flagged. Answer it before publishing.</p>}
          <AnimatePresence>
            {amountFor && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 flex items-end gap-2 overflow-hidden">
                <div className="flex-1">
                  <TextField label="Amount" prefix="PKR" value={amount} onChange={setAmount} inputMode="decimal" autoFocus onEnter={() => send({ optionId: amountFor, amount: parsePKR(amount) ?? null }, amountFor)} />
                </div>
                <Button size="M" loading={pending === amountFor} onClick={() => send({ optionId: amountFor, amount: parsePKR(amount) ?? null }, amountFor)}>
                  Save
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function shareSourcePill(e: ExpenseData): Provenance | null {
  const s = e.shareSource;
  if (s === "story") return "story";
  if (s === "you" || s === "manual") return e.source === "manual" && s === "manual" ? null : "you";
  if (s === "assumed") return "assumed";
  if (s === "sample") return "sample";
  return null;
}

function ExpenseCard({ e, data, index, questions, onEdit, onChanged, optimized }: { e: ExpenseData; data: OutingData; index: number; questions: QuestionData[]; onEdit: () => void; onChanged: () => void; optimized: boolean }) {
  const toast = useToast();
  const setOption = async (body: { splitMode?: "itemised" | "equal"; direct?: boolean }) => {
    try {
      await api(`/api/expenses/${e.id}`, "PATCH", body);
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn’t change that", "error");
    }
  };
  const m = memberLookup(data);
  const ids = participantsOf(e);
  const people = ids.map((id) => m.byId(id)).filter(Boolean) as OutingData["members"];
  const uniform = isUniformEqual(e);
  const lowItems = e.items.filter((i) => i.confidence === "low");
  const sourcePill: Provenance = e.source === "ride" ? "ride" : e.source === "manual" ? "manual" : e.source === "story" ? "story" : e.source === "sample" ? "sample" : "receipt";
  const sharePill = shareSourcePill(e);
  const who = uniform ? (ids.length === data.members.length && ids.length > 3 ? `${ids.length} people` : people.map((p) => p.name.split(" ")[0]).join(", ")) : `${ids.length} people`;
  const kindLine = e.splitMode === "equal" ? `${people.map((p) => p.name.split(" ")[0]).join(", ")} · split equally` : e.source === "ride" ? `Riders: ${people.map((p) => p.name.split(" ")[0]).join(", ")} · equal` : uniform ? `${who} · equal` : `${who} · ${e.items.length} items, by who had what`;
  const open = questions.filter((q) => q.blocking);
  return (
    <motion.article layout initial={{ opacity: 0, y: 22, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.06 * index, type: "spring", stiffness: 240, damping: 26 }} className="surface p-5">
      <div className="flex items-center gap-3">
        <SourceIcon source={e.source} />
        <h3 className="t-label min-w-0 flex-1 truncate text-[18px]">{e.title}</h3>
        <span className="t-amount-m text-[18px]">{formatPKR(expenseTotal(e))}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="t-ui text-[14px]">{e.payers.length ? `Paid by ${e.payers.map((p) => m.first(p.memberId)).join(" & ")}` : <span className="font-semibold text-pink-text">Who paid?</span>}</span>
        <SourcePill kind={sourcePill} />
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <AvatarStack people={people.slice(0, 6)} extra={Math.max(0, people.length - 6)} size={28} />
        <span className="t-caption min-w-0 truncate text-ink-2">{kindLine}</span>
      </div>
      {sharePill && sharePill !== "sample" && (
        <div className="mt-2.5">
          <SourcePill kind={sharePill} />
        </div>
      )}
      {e.charges.length > 0 && <p className="t-caption mt-2.5 text-ink-2">{e.charges.map((c) => c.label.replace(/\s*\(.*\)$/, "")).join(" & ")} split by what each person ordered.</p>}
      {(lowItems.length > 0 || open.length > 0) && (
        <div className="mt-3 flex items-center gap-2 rounded-[14px] border-[1.5px] border-ink bg-lime-tint px-3 py-2.5">
          <CircleAlert size={16} className="shrink-0" />
          <span className="t-ui min-w-0 flex-1 text-[14px]">{lowItems.length ? `Unsure: ${lowItems[0].name} (${formatPKR(lowItems[0].lineTotal)}?)` : open[0].text}</span>
          <button className="t-label text-[14px] text-blue" onClick={onEdit}>
            Fix
          </button>
        </div>
      )}
      {(e.items.length > 1 || e.splitMode === "equal") && (
        <div className="mt-4">
          <Segmented
            ariaLabel={`How to split ${e.title}`}
            layoutId={`split-${e.id}`}
            size="S"
            value={e.splitMode}
            onChange={(v) => setOption({ splitMode: v })}
            options={[
              { value: "itemised", label: "Who had what" },
              { value: "equal", label: "Split equally" },
            ]}
          />
        </div>
      )}
      {optimized && e.payers.length > 0 && (
        <label className="mt-3 flex items-center justify-between gap-3">
          <span className="t-caption text-ink-2">Pay {e.payers.map((p) => m.first(p.memberId)).join(" & ")} directly for this one</span>
          <button type="button" role="switch" aria-checked={e.direct} aria-label={`Pay ${e.title} directly`} onClick={() => setOption({ direct: !e.direct })} className={clsx("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors", e.direct ? "bg-blue" : "bg-ink/15")}>
            <motion.span layout transition={{ type: "spring", stiffness: 700, damping: 35 }} className={clsx("absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow", e.direct ? "right-[2px]" : "left-[2px]")} />
          </button>
        </label>
      )}
      <button onClick={onEdit} className="t-label mt-3 flex items-center gap-1.5 text-[15px] text-blue">
        <Pencil size={15} /> Edit details
      </button>
    </motion.article>
  );
}

/** Conversational correction (MOCK in Figma; here it runs the same interpreter on your fix). */
function CorrectionBar({ outingId, onApplied }: { outingId: string; onApplied: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ changes: string[]; unparsed: string[] } | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const send = async (t = text) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ changes: string[]; understood: boolean; unparsed: string[] }>(`/api/outings/${outingId}/correction`, "POST", { text: t });
      setResult(r);
      if (r.understood) {
        toast("Fixed. Re-validated.");
        setText("");
        onApplied();
      } else toast("Couldn’t match that to an expense. Try naming the expense and the person.", "error");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t apply that", "error");
    } finally {
      setBusy(false);
    }
  };
  const listen = () => {
    const w = window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as unknown as (new () => { lang: string; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start: () => void; stop: () => void }) | undefined;
    if (!Ctor) return toast("Speech isn’t supported in this browser. Type the fix instead.", "info");
    if (listening) return recRef.current?.stop();
    const rec = new Ctor();
    rec.lang = "en-PK";
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setText(t);
      send(t);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  return (
    <div>
      <div className="flex h-14 items-center gap-2 rounded-full border-[1.5px] border-ink bg-paper pl-5 pr-1.5 shadow-[var(--elev-1)]">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Type or say a fix" aria-label="Say or type a fix" className="t-ui min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
        {text.trim() ? (
          <IconButton label="Apply fix" surface="plain" onClick={() => send()} disabled={busy}>
            {busy ? <Sparkles size={18} className="animate-pulse" /> : <Send size={18} />}
          </IconButton>
        ) : (
          <IconButton label={listening ? "Stop listening" : "Speak a fix"} surface="plain" onClick={listen}>
            <Mic size={19} className={listening ? "text-pink" : ""} />
          </IconButton>
        )}
      </div>
      <AnimatePresence>
        {result && result.changes.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 rounded-[16px] bg-blue-tint p-3">
            {result.changes.map((c, i) => (
              <li key={i} className="t-caption flex items-center gap-1.5">
                <CheckCheck size={14} className="text-blue" /> {c}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function EqualWarning({ preview, data }: { preview: PreviewData; data: OutingData }) {
  const m = memberLookup(data);
  const entries = Object.entries(preview.equalDeltas)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="t-caption px-1 text-ink-2">Equal and actual give the same result here.</p>;
  return (
    <div className="flex gap-2.5 rounded-[16px] border-[1.5px] border-pink-text bg-pink-tint p-3.5">
      <CircleAlert size={17} className="mt-0.5 shrink-0 text-pink-text" />
      <p className="t-ui min-w-0 flex-1 text-[14px]">
        Equal ignores what people actually had:{" "}
        {entries.map(([id, v], i) => (
          <span key={id}>
            <span className="whitespace-nowrap">
              {m.first(id)} {v > 0 ? "+" : "−"}
              {i === 0 ? "PKR " : ""}
              {formatAmount(Math.abs(v))}
            </span>
            {i < entries.length - 1 ? " · " : "."}
          </span>
        ))}
      </p>
    </div>
  );
}

function nodesFor(data: OutingData) {
  return data.members.map((mm) => ({ id: mm.id, label: mm.name.split(" ")[0], initials: mm.initials, color: mm.color }));
}

function OptimizedPanel({ preview, data, onOpen, onBack }: { preview: PreviewData; data: OutingData; onOpen: () => void; onBack: () => void }) {
  const m = memberLookup(data);
  const nodes = nodesFor(data);
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
      <div className="rounded-[20px] border-[1.5px] border-ink bg-paper p-4">
        <div className="flex items-baseline justify-between">
          <p className="t-label">Optimized settlement</p>
          <p className="t-amount-m">
            {preview.originalDebts.length} → {preview.optimizedEdges.length} transfers
          </p>
        </div>
        <button onClick={onOpen} className="mt-3 grid w-full grid-cols-2 gap-3" aria-label="Open the full debt graph">
          <div className="rounded-[14px] bg-paper-warm p-2">
            <p className="t-overline text-[9px] text-ink-2">Before · original</p>
            <DebtGraph nodes={nodes} edges={preview.originalDebts} size={140} mini />
          </div>
          <div className="rounded-[14px] bg-blue-tint p-2">
            <p className="t-overline text-[9px] text-blue">After · optimized</p>
            <DebtGraph nodes={nodes} edges={preview.optimizedEdges} size={140} mini />
          </div>
        </button>
        <ul className="mt-3 divide-y divide-line">
          {preview.optimizedEdges.map((e) => (
            <li key={`${e.from}-${e.to}`} className="flex justify-between py-2 t-ui text-[15px]">
              <span>
                {m.first(e.from)} → {m.first(e.to)}
              </span>
              <span className="tabular font-semibold">{formatPKR(e.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="t-caption mt-2 flex items-center gap-1.5">
          <CheckCheck size={15} className={preview.netsPreserved ? "text-blue" : "text-pink-text"} />
          {preview.netsPreserved
            ? "Net amounts unchanged for everyone. We only removed middle steps."
            : preview.invariants && !preview.invariants.netsSumToZero
              ? "An expense still needs a payer. Fix that first, then optimize."
              : "These rules would change someone’s total; not allowed."}
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="S" variant="outline" onClick={onOpen}>
            See full graph
          </Button>
          <Button size="S" variant="text" icon={<ChevronLeft size={15} />} onClick={onBack}>
            Back to original
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** 11 · Debt graph sheet: proof that fewer transfers are fair. */
function GraphSheet({ open, onClose, preview, data, rules, isOrg, onRules, onUse, onBack }: { open: boolean; onClose: () => void; preview: PreviewData; data: OutingData; rules: Rules; isOrg: boolean; onRules: (r: Rules) => void; onUse: () => void; onBack: () => void }) {
  const [view, setView] = useState<"original" | "optimized">("optimized");
  const m = memberLookup(data);
  const nodes = nodesFor(data);
  const edges = view === "original" ? preview.originalDebts : preview.optimizedEdges;
  const biggestCreditor = Object.entries(preview.net).sort((a, b) => b[1] - a[1])[0]?.[0];
  const example = useMemo(() => {
    // Find a removed middle step: a→b and b→c in original, a→c in optimized.
    for (const ab of preview.originalDebts)
      for (const bc of preview.originalDebts)
        if (ab.to === bc.from && preview.optimizedEdges.some((x) => x.from === ab.from && x.to === bc.to) && !preview.optimizedEdges.some((x) => x.from === ab.from && x.to === ab.to))
          return `Before, ${m.first(ab.from)} paid ${m.first(ab.to)} ${formatPKR(ab.amount)} while ${m.first(ab.to)} owed ${m.first(bc.to)}; now ${m.first(ab.from)} pays ${m.first(bc.to)} directly.`;
    return null;
  }, [preview, m]);
  const hub = preview.optimizedEdges.length > 1 && preview.optimizedEdges.every((e) => e.to === preview.optimizedEdges[0].to) ? preview.optimizedEdges[0].to : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="Who pays whom"
      subtitle={`${data.outing.name} · routing only${data.outing.isSample ? " (sample)" : ""}`}
      footer={
        <div className="flex flex-col gap-2">
          <Button full onClick={onUse} disabled={!isOrg || !preview.netsPreserved}>
            Use optimized · {preview.optimizedEdges.length} transfers
          </Button>
          <Button full variant="outline" icon={<ChevronLeft size={18} />} onClick={onBack} disabled={!isOrg}>
            Back to original debts
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex rounded-full bg-paper-warm p-1" role="tablist">
          {(["original", "optimized"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className="relative h-11 flex-1 rounded-full">
              {view === k && <motion.span layoutId="graph-view" className="absolute inset-0 rounded-full bg-ink" />}
              <span className={clsx("relative t-label text-[14px]", view === k ? "text-white" : "text-ink-2")}>
                {k === "original" ? `Original · ${preview.originalDebts.length} transfers` : `Optimized · ${preview.optimizedEdges.length} transfers`}
              </span>
            </button>
          ))}
        </div>
        <div className="rounded-[20px] bg-paper-warm p-2">
          <DebtGraph nodes={nodes} edges={edges} size={330} />
        </div>
        <p className="t-caption text-ink-2">
          Arrows point from who pays to who receives.
          {view === "optimized" && hub ? ` Everyone pays ${m.first(hub)} directly; no one is routed through someone else.` : ""}
        </p>

        <div>
          <h3 className="t-label mb-1 text-[17px]">{view === "optimized" ? "Proposed transfers" : "Original transfers"}</h3>
          <ul className="divide-y divide-line">
            {edges.map((e) => (
              <li key={`${e.from}-${e.to}`} className="flex items-center gap-2 py-2.5">
                <AvatarStack people={[m.byId(e.from)!, m.byId(e.to)!].filter(Boolean).map((x) => ({ initials: x.initials, color: x.color }))} size={28} />
                <span className="t-ui min-w-0 flex-1 text-[15px]">
                  {m.first(e.from)} pays {m.first(e.to)}
                </span>
                <span className="t-amount-m">{formatPKR(e.amount)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[20px] bg-blue-tint p-4">
          <p className="t-label flex items-center gap-2">
            <CheckCheck size={18} className="text-blue" /> Net amounts unchanged for everyone
          </p>
          <table className="mt-2 w-full t-ui text-[14px]">
            <thead>
              <tr className="t-overline text-[10px] text-ink-2">
                <th className="py-1 text-left font-bold">Person</th>
                <th className="text-right font-bold">Original</th>
                <th className="text-right font-bold">Optimized</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.members.map((mm) => (
                <tr key={mm.id}>
                  <td className="py-1">{mm.name.split(" ")[0]}</td>
                  <td className="text-right">{formatAmount(preview.net[mm.id] ?? 0, { signed: true })}</td>
                  <td className="text-right">{formatAmount(preview.optimizedNets[mm.id] ?? 0, { signed: true })}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-1">Total</td>
                <td className="text-right">{formatAmount(Object.values(preview.net).reduce((a, b) => a + b, 0))}</td>
                <td className="text-right">{formatAmount(Object.values(preview.optimizedNets).reduce((a, b) => a + b, 0))}</td>
              </tr>
            </tbody>
          </table>
          <p className="t-caption mt-2">
            Same totals, fewer steps.{example ? ` ${example}` : ""} Nobody’s share changed: that was decided by allocation.
          </p>
        </div>

        <div>
          <p className="t-label mb-2">Routing rules (optional)</p>
          <Toggle checked={!!rules.onlyKnown} onChange={(v) => onRules({ ...rules, onlyKnown: v })} label="Only pay people I know" description="Money only moves between people who shared an expense." disabled={!isOrg} />
          <Toggle checked={!!rules.collectorId} onChange={(v) => onRules({ ...rules, collectorId: v ? biggestCreditor ?? null : null })} label={`Collector: ${biggestCreditor ? m.first(biggestCreditor) : "—"}`} description="Everyone pays one person, who pays the others. Off by default: it routes money through someone." disabled={!isOrg} />
          <Toggle checked={!!rules.skipNoAccount} onChange={(v) => onRules({ ...rules, skipNoAccount: v })} label="Skip people without a bank account" description="Their original transfers stay as they are (cash)." disabled={!isOrg} />
        </div>
      </div>
    </Sheet>
  );
}
