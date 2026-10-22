"use client";
import { use, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Keyboard, Mic, Pencil, RotateCcw, Sparkles, Square } from "lucide-react";
import clsx from "clsx";
import { Fab, PageTitle, Screen, TopBar, useMe } from "@/components/shell";
import { Button, Notice, Segmented, StarSpinner } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useNav } from "@/lib/client/nav";
import { useToast } from "@/lib/client/toast";
import { interpretNarrative } from "@/lib/interpret/narrative";
import type { OutingData } from "@/lib/client/types";

type Lang = "en" | "ur" | "both";
const LANG_CODE: Record<Lang, string> = { en: "en-US", ur: "ur-PK", both: "en-IN" };

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const ENGINE_LABEL = { gemini: "Gemini · high accuracy", openai: "OpenAI · high accuracy", browser: "Browser · basic" } as const;

/** 08 · Tell the story (E3): voice or text; edit the transcript before Wusool reads it. */
export default function Narrate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const { data } = useSWR<OutingData>(me ? `/api/outings/${id}` : null);
  const nav = useNav();
  const toast = useToast();
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [lang, setLang] = useState<Lang>("both");
  const [recording, setRecording] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [live, setLive] = useState("");
  const [editing, setEditing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<{ word: string; idx: number } | null>(null);
  const [lastEngine, setLastEngine] = useState<string | null>(null);
  const level = useMotionValue(0);
  const smooth = useSpring(level, { stiffness: 300, damping: 20 });
  const ring1 = useTransform(smooth, [0, 1], [1, 1.55]);
  const ring2 = useTransform(smooth, [0, 1], [1, 1.95]);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const srRef = useRef<SR | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const prefixRef = useRef("");
  const liveFinal = useRef("");
  const engine = data?.capabilities.stt ?? "browser";

  useEffect(() => {
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) setMode("text");
  }, []);
  useEffect(() => {
    if (data?.narrative?.transcript && !transcript) setTranscript(data.narrative.transcript);
  }, [data?.narrative?.transcript]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const teardown = () => {
    const sr = srRef.current;
    srRef.current = null;
    sr?.stop();
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    level.set(0);
  };

  const start = async () => {
    setMicError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setMicError("Microphone access is blocked. Allow it from the lock icon in the address bar, or type your story instead.");
      setMode("text");
      return;
    }
    streamRef.current = stream;
    prefixRef.current = transcript.trim() ? transcript.trim() + " " : "";
    liveFinal.current = "";
    setLive("");

    // Real level meter for the orb.
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      level.set(Math.min(1, peak / 64));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    // Full-quality audio for the transcription service.
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => finish(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
    recRef.current = rec;
    rec.start(1000);

    // Live captions while talking (browser recognition, if available).
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Ctor) {
      const sr = new Ctor();
      sr.lang = LANG_CODE[lang];
      sr.continuous = true;
      sr.interimResults = true;
      sr.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) liveFinal.current += r[0].transcript.trim() + " ";
          else interim += r[0].transcript;
        }
        setLive((liveFinal.current + interim).trim());
      };
      sr.onerror = () => {};
      sr.onend = () => {
        if (srRef.current === sr)
          try {
            sr.start();
          } catch {
            /* ignore */
          }
      };
      srRef.current = sr;
      try {
        sr.start();
      } catch {
        /* captions are optional */
      }
    }
    setSeconds(0);
    setRecording(true);
  };

  const stop = () => {
    setRecording(false);
    recRef.current?.state === "recording" && recRef.current.stop();
    teardown();
  };

  const finish = async (blob: Blob) => {
    const browserText = liveFinal.current.trim() || live.trim();
    if (engine === "browser") {
      if (browserText) setTranscript(prefixRef.current + capitalise(browserText));
      else toast("Didn’t catch anything. Try again or type it.", "info");
      setLastEngine("browser");
      return;
    }
    setPolishing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "story.webm");
      const res = await fetch(`/api/outings/${id}/transcribe`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "", json?.error?.message ?? "Transcription failed");
      setTranscript(prefixRef.current + json.text);
      setLastEngine(json.engine);
    } catch (e) {
      if (browserText) setTranscript(prefixRef.current + capitalise(browserText));
      toast(e instanceof ApiError ? e.message : "Transcription failed; kept the live transcript.", "error");
      setLastEngine("browser");
    } finally {
      setPolishing(false);
    }
  };

  // Words the interpreter isn't sure about (same deterministic rules the server uses).
  const uncertain = useMemo(() => {
    if (!data || !transcript.trim()) return [] as string[];
    return interpretNarrative(transcript, {
      members: data.members.map((m) => ({ id: m.id, name: m.name })),
      narratorId: data.me.id,
      expenses: data.expenses.map((e) => ({ id: e.id, title: e.title, kind: e.source === "ride" ? "ride" : e.source === "manual" ? "manual" : "receipt", items: e.items.map((i) => ({ id: i.id, name: i.name })) })),
    }).uncertainWords;
  }, [transcript, data]);
  const words = useMemo(() => transcript.split(/(\s+)/), [transcript]);
  const replaceWord = (idx: number, next: string) => {
    const arr = [...words];
    const trail = arr[idx].match(/[.,!?;:]+$/)?.[0] ?? "";
    arr[idx] = next + trail;
    setTranscript(arr.join(""));
    setFix(null);
  };

  const interpret = async () => {
    if (recording) stop();
    setBusy(true);
    try {
      if (transcript.trim()) await api(`/api/outings/${id}/narrative`, "POST", { transcript, mode });
      nav.push(`/o/${id}/processing`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn’t save the story", "error");
      setBusy(false);
    }
  };

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, "0");
  const names = data?.members.map((m) => m.name.split(" ")[0]).slice(0, 3).join(", ");

  return (
    <Screen>
      <TopBar back={`/o/${id}/evidence`} title="Tell the story" collapse />
      <PageTitle sub="Say it like you’d tell a friend: who paid, who had what, who rode with whom, and anything to split equally.">Tell the story</PageTitle>
      <div className="flex flex-col gap-5 px-5 pb-6 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="w-44">
            <Segmented
              ariaLabel="Input mode"
              layoutId="narrate-mode"
              value={mode}
              onChange={(v) => (recording && stop(), setMode(v))}
              options={[
                { value: "voice", label: <span className="inline-flex items-center gap-1.5"><Mic size={14} /> Voice</span> },
                { value: "text", label: <span className="inline-flex items-center gap-1.5"><Pencil size={13} /> Text</span> },
              ]}
            />
          </div>
          {mode === "voice" && (
            <Segmented ariaLabel="Language" layoutId="narrate-lang" size="S" value={lang} onChange={setLang} options={[{ value: "en", label: "EN" }, { value: "ur", label: "اردو" }, { value: "both", label: "Both" }]} />
          )}
        </div>

        {micError && <Notice tone="pink">{micError}</Notice>}

        <AnimatePresence mode="wait">
          {mode === "voice" && (
            <motion.div key="voice" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="relative flex flex-col items-center overflow-hidden rounded-[28px] bg-ink px-5 pb-5 pt-8 text-white">
              <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60">
                <span className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-blue blur-3xl" />
                <span className="absolute -bottom-20 right-0 h-48 w-48 rounded-full bg-pink/70 blur-3xl" />
              </div>
              <div className="relative flex h-40 w-40 items-center justify-center">
                <motion.span style={{ scale: ring2 }} className="absolute inset-6 rounded-full bg-white/[0.06]" />
                <motion.span style={{ scale: ring1 }} className="absolute inset-6 rounded-full bg-white/[0.12]" />
                <motion.button
                  aria-label={recording ? "Stop recording" : "Start recording"}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => (recording ? stop() : start())}
                  disabled={polishing}
                  className={clsx("chrome-ring relative flex h-24 w-24 items-center justify-center rounded-full", recording ? "gloss-pink" : "gloss-blue")}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {polishing ? (
                      <motion.span key="p" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                        <StarSpinner size={34} light />
                      </motion.span>
                    ) : recording ? (
                      <motion.span key="s" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}>
                        <Square size={28} fill="white" />
                      </motion.span>
                    ) : (
                      <motion.span key="m" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                        <Mic size={34} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              </div>
              <p className="relative mt-2 t-amount-m text-[20px] tabular">
                {mm}:{ss}
              </p>
              <p className="relative mt-1 t-caption text-white/70">{polishing ? "Turning your voice into text…" : recording ? "Listening. Tap ■ when you’re done." : "Tap the mic and talk naturally"}</p>
              <AnimatePresence>
                {recording && live && (
                  <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative mt-3 line-clamp-2 text-center t-body-i text-white/85">
                    “{live.slice(-140)}”
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="relative mt-4 flex w-full items-center justify-between">
                <span className="t-overline rounded-full bg-white/10 px-2.5 py-1 text-[9.5px] text-white/80">{ENGINE_LABEL[engine as keyof typeof ENGINE_LABEL]}</span>
                <button aria-label="Start over" onClick={() => (stop(), setTranscript(""), setLive(""))} className="flex items-center gap-1.5 t-caption text-white/70">
                  <RotateCcw size={14} /> Start over
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {mode === "voice" && engine === "browser" && (
          <Notice tone="warm">
            Using your browser’s built-in recognition, which struggles with Urdu–English mixing. For accurate transcripts, add a free <b>GEMINI_API_KEY</b> (Google AI Studio) to <code>.env.local</code> and restart. Until then, edit the transcript below.
          </Notice>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="t-label">{mode === "voice" ? "Transcript · edit before Wusool reads it" : "Your story"}</p>
            {lastEngine && mode === "voice" && <span className="t-caption text-ink-2">{ENGINE_LABEL[lastEngine as keyof typeof ENGINE_LABEL] ?? lastEngine}</span>}
          </div>
          {editing || mode === "text" || !transcript ? (
            <textarea
              aria-label="Story transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              onBlur={() => setEditing(false)}
              autoFocus={editing}
              rows={6}
              placeholder={`e.g. ${names ? names.split(", ")[0] : "Ayesha"} paid for dinner. We took an inDrive back, it cost 900, split it equally. I had the biryani.`}
              className="t-body w-full resize-none rounded-[22px] bg-paper p-4 shadow-[inset_0_0_0_1.5px_rgba(17,17,20,0.14)] outline-none transition-shadow focus:shadow-[inset_0_0_0_2px_var(--color-blue)]"
            />
          ) : (
            <div role="textbox" tabIndex={0} aria-label="Story transcript (tap to edit)" onClick={() => setEditing(true)} onKeyDown={(e) => e.key === "Enter" && setEditing(true)} className="t-body min-h-[150px] cursor-text rounded-[22px] bg-paper p-4 shadow-[inset_0_0_0_1.5px_rgba(17,17,20,0.14)]">
              {words.map((w, i) => {
                const clean = w.replace(/[.,!?;:]+$/, "");
                return uncertain.includes(clean) ? (
                  <span key={i} className="unsure-word" role="button" tabIndex={0} onClick={(e) => (e.stopPropagation(), setFix({ word: clean, idx: i }))}>
                    {w}
                  </span>
                ) : (
                  <span key={i}>{w}</span>
                );
              })}
            </div>
          )}
          <p className="t-caption mt-2 text-ink-2">{uncertain.length ? `${uncertain.length} word${uncertain.length > 1 ? "s" : ""} we weren’t sure about ${uncertain.length > 1 ? "are" : "is"} underlined. Tap to fix, or edit anything.` : "Tap the text to edit anything before Wusool reads it."}</p>
          <AnimatePresence>
            {fix && data && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="surface mt-2 p-3">
                <p className="t-label text-[14px]">Replace “{fix.word}” with</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.members.map((m) => (
                    <button key={m.id} onClick={() => replaceWord(fix.idx, m.name.split(" ")[0])} className="t-chip h-9 rounded-full bg-paper-warm px-3">
                      {m.name.split(" ")[0]}
                    </button>
                  ))}
                  <button onClick={() => (setFix(null), setEditing(true))} className="t-chip h-9 rounded-full px-3 text-blue">
                    Edit text…
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <Fab>
        <Button full icon={<Sparkles size={19} />} onClick={interpret} loading={busy} disabled={recording || polishing}>
          {transcript.trim() ? "Read my outing" : "Skip: read receipts only"}
        </Button>
        {mode === "voice" && (
          <Button variant="text" size="M" full className="mt-1" icon={<Keyboard size={17} />} onClick={() => (stop(), setMode("text"))}>
            Switch to typing
          </Button>
        )}
      </Fab>
    </Screen>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");
