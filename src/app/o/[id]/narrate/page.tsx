"use client";
import { use, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { Mic, Pencil, RotateCcw, Sparkles, Square } from "lucide-react";
import clsx from "clsx";
import { Fab, PageTitle, Screen, TopBar, useMe } from "@/components/shell";
import { Button, Notice, press, Segmented, StarSpinner } from "@/components/ui";
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
      <PageTitle sub="Who paid, who had what, who rode with whom.">Tell the story</PageTitle>
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
            <motion.div key="voice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="relative">
              {/* Soft colour field the glass sits on; it brightens while listening. */}
              <motion.div
                aria-hidden
                className="pointer-events-none absolute -inset-x-6 -inset-y-8 -z-0"
                animate={{ opacity: recording ? 1 : 0.65 }}
                transition={{ duration: 0.6 }}
              >
                <span className="absolute left-[4%] top-0 h-40 w-48 rounded-full bg-[#9fb2ff] opacity-70 blur-3xl" />
                <span className="absolute right-[2%] top-6 h-44 w-48 rounded-full bg-[#d7c2ff] opacity-80 blur-3xl" />
                <span className="absolute bottom-0 left-1/3 h-28 w-40 rounded-full bg-[#ffc6e8] opacity-60 blur-3xl" />
              </motion.div>

              <motion.div layout transition={{ type: "spring", stiffness: 300, damping: 32, mass: 0.9 }} style={{ borderRadius: 28 }} className="glass relative overflow-hidden">
                <motion.div layout="position" className="flex items-center gap-3 p-2.5 pl-4">
                  <div className="min-w-0 flex-1">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {polishing ? (
                        <motion.p key="think" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="t-label shimmer-text text-[15px]">
                          Thinking…
                        </motion.p>
                      ) : recording ? (
                        <motion.div key="rec" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="flex items-center gap-3">
                          <Waveform level={smooth} />
                          <span className="t-amount-m tabular text-[15px] text-ink-2">
                            {mm}:{ss}
                          </span>
                        </motion.div>
                      ) : (
                        <motion.p key="idle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="t-label text-[15px] text-ink-2">
                          {transcript.trim() ? "Tap to add more" : "Tap and tell it like you would a friend"}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                  <motion.button
                    aria-label={recording ? "Stop recording" : "Start recording"}
                    {...press(0.88, 0.92)}
                    onClick={() => (recording ? stop() : start())}
                    disabled={polishing}
                    className={clsx("press-own relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full", recording ? "gloss-pink text-white" : "glass-solid text-blue")}
                  >
                    {recording && <motion.span aria-hidden className="absolute inset-0 rounded-full bg-pink/40" style={{ scale: ring2 }} />}
                    <AnimatePresence mode="wait" initial={false}>
                      {polishing ? (
                        <motion.span key="p" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="relative">
                          <StarSpinner size={22} />
                        </motion.span>
                      ) : recording ? (
                        <motion.span key="s" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} className="relative">
                          <Square size={16} fill="white" />
                        </motion.span>
                      ) : (
                        <motion.span key="m" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="relative">
                          <Mic size={21} strokeWidth={2.2} />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </motion.div>

                {/* Expanded body: the words appear as you say them. */}
                <AnimatePresence initial={false}>
                  {(recording || polishing) && (
                    <motion.div key="body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", stiffness: 300, damping: 32 }} className="overflow-hidden">
                      <div className="min-h-[92px] px-4 pb-4 pt-1">
                        {live ? (
                          <p className="t-body text-[16px] leading-relaxed text-ink">
                            {live.slice(-220).split(" ").map((w, i, arr) => (
                              <motion.span key={`${arr.length - i}-${w}`} initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.35 }}>
                                {w}{" "}
                              </motion.span>
                            ))}
                          </p>
                        ) : (
                          <p className="t-body text-[16px] text-ink-3">{polishing ? "Turning your voice into text" : "Listening…"}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {transcript.trim() && !recording && !polishing && (
                <button aria-label="Start over" onClick={() => (stop(), setTranscript(""), setLive(""))} className="t-caption relative mt-2 ml-auto flex items-center gap-1.5 px-1 text-ink-2">
                  <RotateCcw size={13} /> Start over
                </button>
              )}
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
            <p className="t-label">{mode === "voice" ? "Transcript" : "Your story"}</p>
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
          {uncertain.length > 0 && <p className="t-caption mt-2 text-ink-2">Underlined words may be wrong. Tap one to fix it.</p>}
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
      </Fab>
    </Screen>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

/** Live waveform: each bar follows the real microphone level with its own gain, so speech looks like speech. */
function Waveform({ level }: { level: MotionValue<number> }) {
  const gains = [0.55, 0.9, 1.25, 0.8, 1.1, 0.6, 0.95];
  return (
    <span aria-hidden className="flex h-7 items-center gap-[3px]">
      {gains.map((g, i) => (
        <WaveBar key={i} level={level} gain={g} delay={i * 0.11} />
      ))}
    </span>
  );
}
function WaveBar({ level, gain, delay }: { level: MotionValue<number>; gain: number; delay: number }) {
  const scaleY = useTransform(level, (v) => Math.min(1, 0.22 + v * gain * 1.4));
  return (
    <motion.span style={{ scaleY }} className="block h-7 w-[3.5px] origin-center rounded-full bg-[linear-gradient(180deg,#7b8dff,#1f3bff)]">
      <motion.span className="block h-full w-full rounded-full" animate={{ opacity: [0.75, 1, 0.75] }} transition={{ repeat: Infinity, duration: 1.2, delay }} />
    </motion.span>
  );
}
