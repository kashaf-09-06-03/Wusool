/**
 * Turn spoken amounts into digits so the interpreter can read them:
 * "a thousand rupees" → "1000 rupees", "fifteen hundred" → "1500", "1.5k" → "1500",
 * "two thousand five hundred" → "2500", "do hazar" → "2000", "paanch sau" → "500".
 */
const UNITS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Roman Urdu
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chay: 6, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
  dhai: 2.5, dedh: 1.5, sava: 1.25,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, k: 1000, lakh: 100000, lac: 100000, sau: 100, so: 100, hazar: 1000, hazaar: 1000, hajar: 1000 };

const WORD = Object.keys(UNITS).concat(Object.keys(SCALES)).join("|");
const RUN = new RegExp(`\\b(?:(?:${WORD})(?:[\\s-]+(?:and[\\s-]+)?)?)+\\b`, "gi");

function wordsToNumber(phrase: string): number | null {
  const tokens = phrase.toLowerCase().split(/[\s-]+/).filter((t) => t && t !== "and");
  if (!tokens.some((t) => t in SCALES || (t in UNITS && UNITS[t] >= 2 && !["a", "an", "do", "so"].includes(t)))) return null;
  // "a"/"an"/"do"/"so" alone are ordinary words; only treat them as numbers next to a scale word.
  if (tokens.every((t) => ["a", "an", "do", "so", "das"].includes(t))) return null;
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of tokens) {
    if (t in UNITS) {
      current += UNITS[t];
      seen = true;
    } else if (t in SCALES) {
      const s = SCALES[t];
      if (s === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * s;
        current = 0;
      }
      seen = true;
    }
  }
  if (!seen) return null;
  return Math.round(total + current);
}

export function normalizeAmounts(text: string): string {
  let out = text
    // 1.5k / 2k / 1,500/- / Rs.1500
    .replace(/\b(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(Math.round(parseFloat(n) * 1000)))
    .replace(/(\d)\/-/g, "$1");
  out = out.replace(RUN, (m) => {
    const trimmed = m.trim();
    const n = wordsToNumber(trimmed);
    if (n === null || n < 10) return m;
    const trail = /\s$/.test(m) ? " " : "";
    return String(n) + trail;
  });
  return out;
}
