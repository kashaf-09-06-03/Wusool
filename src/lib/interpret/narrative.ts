/**
 * Deterministic, rule-based interpreter for an outing story ("Ayesha paid for dinner…").
 * It proposes *facts* with provenance and confidence; it never calculates money.
 *
 * Built for how students actually talk (and how speech-to-text writes it down):
 * run-on sentences ("I had the fried rice and then Talha had whatever was left"), number words
 * ("a thousand rupees"), Roman Urdu ("Hamza ne sab ke liye diye"), several items per person,
 * per-expense instructions ("which we want to split equally"), and expenses mentioned only in the
 * story ("we took an inDrive, it cost us 1000"). Anything uncertain becomes a question.
 */
import { parsePKR, type Paisa } from "../money";
import { normalizeAmounts } from "./numbers";

export interface NarrativeMember {
  id: string;
  name: string;
}
export interface NarrativeExpense {
  id: string;
  title: string;
  kind: "receipt" | "ride" | "manual" | "other";
  vendor?: string | null;
  /** Current total, used to recognise an expense the story mentions again. */
  total?: Paisa | null;
  items: { id: string; name: string }[];
}
export interface NarrativeContext {
  members: NarrativeMember[];
  narratorId?: string | null;
  expenses: NarrativeExpense[];
}

type Conf = "high" | "low";
export type SplitMode = "equal" | "itemised";
export type Fact =
  | { type: "payer"; expenseId: string; memberIds: string[]; sentence: string; confidence: Conf; uncertainIds?: string[] }
  | { type: "participants"; expenseId: string; memberIds: string[]; sentence: string; confidence: Conf; uncertainIds?: string[] }
  | { type: "item"; expenseId: string; itemId: string; memberIds: string[]; sentence: string; confidence: Conf; uncertainIds?: string[] }
  /** "Talha had whatever was left": every still-unassigned item of the expense. */
  | { type: "rest"; expenseId: string; memberIds: string[]; sentence: string }
  | { type: "split"; expenseId: string; mode: SplitMode; sentence: string }
  | {
      type: "newExpense";
      title: string;
      kind: "ride" | "other";
      amount: Paisa | null;
      /** Empty when the story doesn't say who paid ("it cost us 1000"): becomes a question. */
      payerIds: string[];
      participantIds: string[];
      split?: SplitMode;
      sentence: string;
      confidence: Conf;
    }
  | {
      type: "handoff";
      fromId: string;
      viaId: string;
      toId: string;
      given: Paisa;
      forwarded: Paisa | null;
      changeReturned: "yes" | "no" | "unknown";
      sentence: string;
    }
  | { type: "unknownName"; name: string; sentence: string; suggestionIds: string[] }
  /** Understood, nothing to change (e.g. "taxes according to what we got" is already the default). */
  | { type: "note"; text: string; sentence: string }
  | { type: "unparsed"; sentence: string };

export interface NarrativeResult {
  facts: Fact[];
  /** Words in the transcript the interpreter wasn't sure about (shown underlined). */
  uncertainWords: string[];
  interpreter: "rules" | "claude" | "gemini";
}

const RIDE_PROVIDERS: Record<string, string> = { careem: "Careem", uber: "Uber", indrive: "inDrive", indriver: "inDrive", bykea: "Bykea", yango: "Yango", airlift: "Airlift", swvl: "Swvl" };
const RIDE_WORDS = [...Object.keys(RIDE_PROVIDERS), "ride", "rides", "cab", "taxi", "rickshaw", "rikshaw", "lift", "car", "gaari", "gari", "petrol", "fuel"];
const FOOD_WORDS = ["dinner", "lunch", "breakfast", "brunch", "food", "meal", "khana", "dessert", "snacks", "restaurant", "bill", "coffee", "cafe"];
const PAY = /^(paid|pays|pay|paying|covered|booked|bought|treated|settled|footed|cleared|transferred|sent|bhare|bhara|diye|diya|kiye)$/;
const CONSUME = /^(had|have|has|having|ate|eaten|drank|drunk|ordered|took|takes|got|get|gets|shared|khaya|khayi|piya|pi|li|liya|mangwaya)$/;
const STOP = new Set(
  "the a an and aur or of at to in on for with from by was were is are had has have we i me my he she him her his they them it this that then after before also too ne ke ka ki ko se liye saath sath paid pay got booked bought ordered one each some our us you your so just like really basically around about approx approximately which will be going want wanted".split(" "),
);
const PRONOUN_SELF = /^(himself|herself|themselves|him|her|his|hers|khud|apne)$/;
const PRONOUN_ME = /^(i|me|myself|mine|main|mein|maine|mujhe|mere|mera)$/;
const ALL = /\b(everyone|everybody|all of us|we all|all|together|us all|the whole group|whole group|sab|sabh|sab log|sab ne|sab ke|each of us)\b/;
const EQUAL = /\b(split(ting)?\s+(it\s+|this\s+|that\s+)?(equally|evenly|equal)|equally|evenly|50\s*[-/]\s*50|barabar|half\s+half|divide(d)?\s+(it\s+)?(equally|evenly|by))\b/;
const ITEMISED = /\b(according to what (we|each|everyone|people)\s+(got|had|ordered|ate)|what (we|each person|everyone) (got|had|ordered)|pro[\s-]?rata|proportional(ly)?|not equally|individually|by item|itemi[sz]ed)\b/;
const REST = /\b(whatever (was|is) left|what(ever)? remained|the rest( of it)?|everything else|all the rest|baqi|baki)\b/;
const NUMBER = /(?:pkr|rs\.?|₨)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*(?:pkr|rs|rupees?|rupay|rupaye|ka|ki|ke)?/i;

const tokens = (s: string): string[] => Array.from(s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const singular = (t: string) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
function wordMatch(a: string, b: string): boolean {
  a = singular(a);
  b = singular(b);
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return lev(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1) || a.startsWith(b) || b.startsWith(a);
  return false;
}

interface NameHit {
  id: string;
  index: number;
  word: string;
  confidence: Conf;
}

class NameIndex {
  private aliases: { alias: string; id: string }[] = [];
  constructor(private members: NarrativeMember[]) {
    for (const m of members) {
      const parts = tokens(m.name);
      if (parts.length) this.aliases.push({ alias: parts[0], id: m.id });
      if (parts.length > 1) this.aliases.push({ alias: parts.join(" "), id: m.id });
    }
  }
  match(word: string): { ids: string[]; confidence: Conf } | null {
    const w = word.toLowerCase();
    const exact = [...new Set(this.aliases.filter((a) => a.alias === w).map((a) => a.id))];
    if (exact.length === 1) return { ids: exact, confidence: "high" };
    if (exact.length > 1) return { ids: exact, confidence: "low" };
    if (w.length < 4 || STOP.has(w)) return null;
    const tol = w.length >= 7 ? 2 : 1;
    const fuzzy = [...new Set(this.aliases.filter((a) => !a.alias.includes(" ") && lev(a.alias, w) <= tol).map((a) => a.id))];
    return fuzzy.length ? { ids: fuzzy, confidence: "low" } : null;
  }
  find(text: string, from = 0, to = text.length): NameHit[] {
    const hits: NameHit[] = [];
    const re = /[\p{L}']+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index < from || m.index >= to) continue;
      const r = this.match(m[0]);
      if (r && r.ids.length === 1) hits.push({ id: r.ids[0], index: m.index, word: m[0], confidence: r.confidence });
    }
    return hits;
  }
  all = () => this.members.map((m) => m.id);
  firstNames = (): string[] => this.members.map((m) => tokens(m.name)[0]).filter((x): x is string => Boolean(x));
}

/** Split a sentence into clauses: "I had X and then Talha had Y" → ["I had X", "Talha had Y"]. */
function clauses(sentence: string, names: NameIndex, extraNames: string[]): string[] {
  const subj = ["i", "we", "you", "he", "she", "they", "each", "everyone", "everybody", ...names.firstNames(), ...extraNames]
    .map((s) => s.replace(/[^a-z']/gi, ""))
    .filter(Boolean)
    .join("|");
  const verbs = "had|have|has|got|get|paid|pay|ordered|ate|drank|took|booked|bought|shared|covered|treated|split|gave|handed";
  const re = new RegExp(`(?:,?\\s+(?:and then|and|then|but|plus|while|after that|aur|phir)\\s+|,\\s+|\\s+)(?=(?:${subj})(?:\\s+\\w+)?\\s+(?:${verbs})\\b)`, "gi");
  const parts = sentence
    .split(re)
    .map((c) => c.trim().replace(/^(and then|and|then|so|but|aur|phir)\s+/i, ""))
    .filter((c) => c.length > 1);
  // A fragment with no verb ("Sara" in "Sara and Ayesha shared…") belongs to the next clause.
  const merged: string[] = [];
  let carry = "";
  for (const p of parts) {
    const hasVerb = tokens(p).some((t) => PAY.test(t) || CONSUME.test(t) || /^(cost|costs|split|splitting|was|were)$/.test(t));
    if (!hasVerb && merged.length === 0) carry = carry ? `${carry} and ${p}` : p;
    else if (!hasVerb) merged[merged.length - 1] += ` and ${p}`;
    else {
      merged.push(carry ? `${carry} and ${p}` : p);
      carry = "";
    }
  }
  if (carry) merged.push(carry);
  return merged;
}

interface ExpenseMatch {
  e: NarrativeExpense;
  score: number;
  items: { id: string; name: string; hits: number }[];
}
function matchExpenses(ctx: NarrativeContext, ts: string[], amount: Paisa | null): ExpenseMatch[] {
  const set = ts.map(singular);
  return ctx.expenses
    .map((e) => {
      let score = 0;
      const titleTokens = tokens(`${e.title} ${e.vendor ?? ""}`).filter((t) => t.length >= 3 && !STOP.has(t));
      for (const t of titleTokens) if (set.some((s) => wordMatch(s, t))) score += 3;
      const isRide = e.kind === "ride" || titleTokens.some((t) => t in RIDE_PROVIDERS || t === "ride");
      if (isRide && ts.some((t) => RIDE_WORDS.includes(t))) score += 2;
      if (!isRide && ts.some((t) => FOOD_WORDS.includes(t)) && titleTokens.some((t) => FOOD_WORDS.includes(t))) score += 2;
      if (amount !== null && e.total && Math.abs(e.total - amount) <= Math.max(100, e.total * 0.01)) score += 3;
      const items = e.items
        .map((it) => {
          const its = tokens(it.name).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d/.test(t));
          const hits = its.filter((t) => set.some((s) => s.length >= 3 && wordMatch(s, t))).length;
          return { id: it.id, name: it.name, hits };
        })
        .filter((x) => x.hits > 0);
      return { e, score: score + (items.length ? Math.max(...items.map((x) => x.hits)) : 0), items };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

function titleFor(text: string, names: NameIndex, isRide: boolean): string {
  const ts = tokens(text);
  if (isRide) {
    const p = ts.find((t) => t in RIDE_PROVIDERS);
    return p ? `${RIDE_PROVIDERS[p]} ride` : ts.includes("rickshaw") ? "Rickshaw" : ts.includes("petrol") || ts.includes("fuel") ? "Petrol" : "Ride";
  }
  const words = text
    .replace(new RegExp(NUMBER.source, "gi"), " ")
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        /[a-z]/i.test(w) &&
        !STOP.has(w.toLowerCase()) &&
        !PRONOUN_SELF.test(w.toLowerCase()) &&
        !PRONOUN_ME.test(w.toLowerCase()) &&
        !(names.match(w)?.confidence === "high") &&
        !/^(cost|costs|was|came|total|together|everyone|everybody|all|split|splitting|equally|evenly|also|rupees?|rs|pkr|ride|got|had|took|were|cost|us|it)$/i.test(w),
    );
  const t = words.slice(0, 3).join(" ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

export function interpretNarrative(transcript: string, ctx: NarrativeContext): NarrativeResult {
  const names = new NameIndex(ctx.members);
  const facts: Fact[] = [];
  const uncertain = new Set<string>();
  let lastSubject: string[] = [];
  let lastExpense: string | null = null;

  const text = normalizeAmounts(transcript)
    .replace(/\b(i|me),\s*([A-Za-z]+),/gi, (m, p, n) => (names.match(n) ? `${p}` : m)) // "I, Kashaf, had" → "I had"
    .replace(/\s+/g, " ");
  // Capitalised words that look like people's names (for clause splitting and unknown-name questions).
  const capitalised = [...new Set((text.match(/(?<=[a-z,]\s|^)[A-Z][a-z]{2,}(?=\s+(?:\w+\s+)?(?:had|have|has|got|paid|ordered|ate|drank|took|booked|bought|shared)\b)/g) ?? []).map((w) => w.toLowerCase()))];
  const sentences = text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?;]+$/, ""))
    .filter(Boolean);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const sentenceEqual = EQUAL.test(lower);
    const sentenceAmount = (() => {
      const m = sentence.match(NUMBER);
      const v = m ? parsePKR(m[1]) : null;
      return v !== null && v >= 1000 ? v : null; // ≥ PKR 10: ignore stray small numbers like "2 naans"
    })();

    // --- Cash handoff through an intermediary (Talha / Mariam / Ayesha).
    const hitsAll = names.find(sentence);
    hitsAll.filter((h) => h.confidence === "low").forEach((h) => uncertain.add(h.word));
    if (/\b(gave|handed|passed|diye|diya|di)\b/.test(lower) && hitsAll.length >= 3 && /\b(to pay|to give|on behalf|for|ke liye|dene)\b/.test(lower) && sentenceAmount) {
      const [from, via, to] = hitsAll;
      const changeReturned = /\b(didn'?t|did not|never|forgot to|wapas nahi|nahi diye)\b.*\b(return|back|change|wapas)\b|\bkept the change\b/.test(lower)
        ? "no"
        : /\b(returned|gave back|wapas (kiye|diye|kar))\b/.test(lower)
          ? "yes"
          : "unknown";
      facts.push({ type: "handoff", fromId: from.id, viaId: via.id, toId: to.id, given: sentenceAmount, forwarded: null, changeReturned, sentence });
      continue;
    }
    if (/\b(change|baqi|balance)\b/.test(lower) && /\b(return|back|wapas|kept|forgot)\b/.test(lower)) {
      const prior = [...facts].reverse().find((f): f is Extract<Fact, { type: "handoff" }> => f.type === "handoff");
      if (prior) {
        prior.changeReturned = /\b(didn'?t|did not|never|forgot|kept|nahi)\b/.test(lower) ? "no" : "yes";
        continue;
      }
    }

    // --- Instructions about tax / charges ("we want taxes according to what we got").
    if (/\b(tax|taxes|charges?|service|gst|sst|fees?)\b/.test(lower) && (ITEMISED.test(lower) || /\b(according|proportion)/.test(lower))) {
      const target = lastExpense ?? ctx.expenses.find((e) => e.kind === "receipt")?.id ?? null;
      if (target) facts.push({ type: "split", expenseId: target, mode: "itemised", sentence });
      facts.push({ type: "note", text: "Tax and charges follow what each person had (pro-rata).", sentence });
      continue;
    }

    let usedSentence = false;
    let newExpenseInSentence: Extract<Fact, { type: "newExpense" }> | null = null;
    const clauseList = clauses(sentence, names, capitalised);
    for (const clause of clauseList) {
      const cl = clause.toLowerCase();
      const ts = tokens(clause);
      const hits = names.find(clause);
      const amountMatch = clause.match(NUMBER);
      const amountRaw = amountMatch ? parsePKR(amountMatch[1]) : null;
      const amount = amountRaw !== null && amountRaw >= 1000 ? amountRaw : null;

      // Verb: the first payment or consumption verb in the clause.
      let verbIdx = -1;
      let kind: "pay" | "consume" | "cost" | null = null;
      for (let i = 0; i < ts.length && !kind; i++) {
        if (PAY.test(ts[i])) (verbIdx = i), (kind = "pay");
        else if (CONSUME.test(ts[i])) (verbIdx = i), (kind = "consume");
      }
      const verbWord = verbIdx >= 0 ? ts[verbIdx] : "";
      const verbPos = verbIdx >= 0 ? cl.search(new RegExp(`\\b${verbWord}\\b`)) : cl.length;
      if (!kind && amount !== null && /\b(cost|costs|came to|was|were|total(led)?)\b/.test(cl)) kind = "cost";
      // "Mariam got chai for her, Ayesha and Sara" means paying for others.
      if (kind === "consume" && /^(got|get|gets|took)$/.test(verbWord) && /\b(for|ke liye)\b/.test(cl.slice(verbPos)) && hits.some((h) => h.index > verbPos)) kind = "pay";
      if (/\bne\b/.test(cl) && /\b(diye|diya|di|kiye|kiya|pay)\b/.test(cl)) kind = "pay";

      // Subject: names / I / we before the verb; otherwise carried over from the previous clause.
      const nePos = cl.indexOf(" ne ");
      const subjEnd = nePos >= 0 && nePos < verbPos ? nePos : verbPos;
      let subject = hits.filter((h) => h.index < subjEnd).map((h) => h.id);
      const subjectLow = hits.filter((h) => h.index < subjEnd && h.confidence === "low").map((h) => h.id);
      const head = cl.slice(0, Math.max(0, subjEnd));
      let weSubject = false;
      if (!subject.length && /\b(i|main|mein|maine)\b/.test(head) && ctx.narratorId) subject = [ctx.narratorId];
      if (!subject.length && /\b(we|hum|humne|us)\b/.test(head)) (subject = names.all()), (weSubject = true);
      if (!subject.length && /\b(each|everyone|everybody|sab)\b/.test(head)) (subject = names.all()), (weSubject = true);
      if (!subject.length && /\b(he|she|they)\b/.test(head) && lastSubject.length) subject = lastSubject;

      // Unknown capitalised names in subject position (not members, not places or items).
      const knownWords = new Set(ctx.expenses.flatMap((e) => tokens(`${e.title} ${e.vendor ?? ""} ${e.items.map((i) => i.name).join(" ")}`)));
      const listOpen = cl.match(/\b(for|with|between|among|amongst|ke liye|ke saath|ke sath)\b/);
      const listStart = listOpen?.index !== undefined && listOpen.index >= subjEnd ? listOpen.index : -1;
      const scan = clause.slice(0, Math.max(subjEnd, 0)) + " " + (listStart >= 0 ? clause.slice(listStart) : "");
      for (const w of scan.match(/\b[A-Z][\p{L}']{2,}\b/gu) ?? []) {
        const lw = w.toLowerCase();
        if (names.match(lw) || knownWords.has(lw) || STOP.has(lw) || RIDE_WORDS.includes(lw) || FOOD_WORDS.includes(lw) || /^(so|then|also|actually|the|we|our|my|okay|ok|after|before|later|everyone|everybody|each)$/i.test(lw)) continue;
        const suggestionIds = ctx.members.filter((m) => lev(tokens(m.name)[0] ?? "", lw) <= 2).map((m) => m.id);
        if (!facts.some((f) => f.type === "unknownName" && f.name.toLowerCase() === lw)) facts.push({ type: "unknownName", name: w, sentence, suggestionIds });
        uncertain.add(w);
      }

      // People after "for / with / between / ke liye", or "together".
      let list: string[] = [];
      const listLow: string[] = [];
      const opener = cl.match(/\b(for|with|between|among|amongst|ke liye|ke saath|ke sath)\b/);
      if (opener?.index !== undefined && opener.index >= subjEnd) {
        const fragStart = opener.index + opener[0].length;
        const frag = cl.slice(fragStart);
        if (ALL.test(frag)) list = names.all();
        else {
          for (const h of names.find(clause, fragStart)) {
            if (!list.includes(h.id)) list.push(h.id);
            if (h.confidence === "low") listLow.push(h.id);
          }
          if (/\b(himself|herself|themselves|him|her|khud|apne)\b/.test(frag)) subject.forEach((s) => !list.includes(s) && list.push(s));
          if (/\b(me|myself|mujhe)\b/.test(frag) && ctx.narratorId && !list.includes(ctx.narratorId)) list.push(ctx.narratorId);
          if (/\b(us|we)\b/.test(frag)) list = names.all();
        }
      }
      if (!list.length && /\b(together|all of us|we all|everyone|everybody|sab)\b/.test(cl)) list = names.all();

      const matches = matchExpenses(ctx, ts, amount);
      const best = matches[0] ?? null;
      const tie = Boolean(matches[1] && best && matches[1].score === best.score);
      const isRideClause = ts.some((t) => RIDE_WORDS.includes(t));
      const clauseEqual = EQUAL.test(cl) || (sentenceEqual && clauseList.length === 1);
      const conf: Conf = subjectLow.length || listLow.length || tie ? "low" : "high";
      const uncertainIds = [...new Set([...subjectLow, ...listLow])];

      // "Talha had whatever was left"
      if (REST.test(cl) && subject.length) {
        const target: string | undefined = best?.e.id ?? lastExpense ?? ctx.expenses.find((e) => e.items.length > 1)?.id;
        if (target) {
          facts.push({ type: "rest", expenseId: target, memberIds: subject, sentence });
          lastSubject = subject;
          lastExpense = target;
          usedSentence = true;
          continue;
        }
      }

      // Items: "Ayesha had the Alfredo pasta and the Americano" (several items, one person).
      if (kind === "consume" && best && best.items.length && best.e.items.length > 1) {
        const who = list.length && /\b(shared|split)\b/.test(cl) ? [...new Set([...subject, ...list])] : subject.length ? subject : list;
        if (who.length) {
          for (const it of best.items)
            facts.push({ type: "item", expenseId: best.e.id, itemId: it.id, memberIds: who, sentence, confidence: weSubject && !list.length ? "low" : conf, uncertainIds });
          if (clauseEqual) facts.push({ type: "split", expenseId: best.e.id, mode: "equal", sentence });
          lastSubject = subject.length ? subject : lastSubject;
          lastExpense = best.e.id;
          usedSentence = true;
          continue;
        }
      }

      // A known expense: a receipt, a ride screenshot, or one you added separately (same amount or kind).
      const amountMatches = Boolean(best && amount !== null && best.e.total && Math.abs(best.e.total - amount) <= Math.max(100, best.e.total * 0.01));
      const existing = best && (best.score >= 3 || amountMatches || (isRideClause && best.e.kind === "ride")) ? best.e : null;
      if (existing) {
        if (kind === "pay" && subject.length && !weSubject) facts.push({ type: "payer", expenseId: existing.id, memberIds: subject, sentence, confidence: conf, uncertainIds: subjectLow });
        if (list.length) facts.push({ type: "participants", expenseId: existing.id, memberIds: list, sentence, confidence: conf, uncertainIds: listLow });
        else if (kind === "consume" && subject.length && !weSubject) facts.push({ type: "participants", expenseId: existing.id, memberIds: subject, sentence, confidence: conf, uncertainIds: subjectLow });
        if (clauseEqual) facts.push({ type: "split", expenseId: existing.id, mode: "equal", sentence });
        else if (ITEMISED.test(cl)) facts.push({ type: "split", expenseId: existing.id, mode: "itemised", sentence });
        lastSubject = subject.length ? subject : lastSubject;
        lastExpense = existing.id;
        usedSentence = true;
        continue;
      }

      // An expense only the story mentions ("we got an inDrive to CBTL, it cost us 1000").
      const mentionsThing = isRideClause || amount !== null || /\b(got|took|bought|ordered|paid|booked|covered)\s+(for\s+)?(an?|the|some)\b/.test(cl);
      if (mentionsThing && (amount !== null || kind === "pay" || isRideClause)) {
        if (newExpenseInSentence) {
          // The same thing described across clauses: "we took an inDrive … it cost 1000 … split equally".
          if (newExpenseInSentence.amount === null && amount !== null) newExpenseInSentence.amount = amount;
          if (!newExpenseInSentence.participantIds.length && list.length) newExpenseInSentence.participantIds = list;
          if (kind === "pay" && subject.length && !weSubject) newExpenseInSentence.payerIds = subject;
          if (clauseEqual) newExpenseInSentence.split = "equal";
        } else {
          const title = titleFor(clause, names, isRideClause) || titleFor(sentence, names, isRideClause) || "Expense from your story";
          newExpenseInSentence = {
            type: "newExpense",
            title,
            kind: isRideClause ? "ride" : "other",
            amount: amount ?? sentenceAmount,
            payerIds: kind === "pay" && subject.length && !weSubject ? subject : [],
            participantIds: list.length ? list : weSubject ? names.all() : [],
            split: clauseEqual || sentenceEqual ? "equal" : undefined,
            sentence,
            confidence: conf,
          };
          facts.push(newExpenseInSentence);
        }
        lastSubject = subject.length ? subject : lastSubject;
        usedSentence = true;
        continue;
      }

      // "…which we want to split equally" on its own: applies to what was just mentioned.
      if (clauseEqual && (newExpenseInSentence || lastExpense)) {
        if (newExpenseInSentence) newExpenseInSentence.split = "equal";
        else facts.push({ type: "split", expenseId: lastExpense!, mode: "equal", sentence });
        usedSentence = true;
        continue;
      }
      if (subject.length) lastSubject = subject;
    }
    if (newExpenseInSentence && sentenceEqual) newExpenseInSentence.split = "equal";
    if (!usedSentence) facts.push({ type: "unparsed", sentence });
  }

  return { facts, uncertainWords: [...uncertain], interpreter: "rules" };
}
