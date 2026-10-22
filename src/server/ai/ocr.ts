import "server-only";
import path from "node:path";
import fs from "node:fs";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { DATA_DIR } from "../db";
import type { OcrLine } from "@/lib/interpret/receipt";

/**
 * Real OCR with Tesseract (runs locally in Node; the English model is downloaded once
 * from the tesseract.js CDN and cached in .data/tessdata). No result is ever fabricated:
 * if recognition fails, the caller marks the evidence unreadable and asks the user.
 */
type G = typeof globalThis & { __wusoolOcr?: Promise<Worker> };

async function worker(): Promise<Worker> {
  const g = globalThis as G;
  if (!g.__wusoolOcr) {
    const cachePath = path.join(DATA_DIR, "tessdata");
    fs.mkdirSync(cachePath, { recursive: true });
    g.__wusoolOcr = (async () => {
      const w = await createWorker("eng", 1, { cachePath });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: "1" });
      return w;
    })();
    g.__wusoolOcr.catch(() => {
      g.__wusoolOcr = undefined;
    });
  }
  return g.__wusoolOcr;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  confidence: number;
  engine: "tesseract";
}

/**
 * Receipt photos are often small, dim, tilted or low-contrast. Normalising them first (auto-rotate,
 * greyscale, upscale small images to ~1800px wide, stretch contrast, sharpen) makes Tesseract read
 * far more reliably. If preprocessing fails for any reason, the original image is used.
 */
async function preprocess(data: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(data, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    return await img
      .resize({ width: width && width < 1800 ? 1800 : undefined, withoutEnlargement: false, kernel: "lanczos3" })
      .greyscale()
      .normalise()
      .sharpen({ sigma: 1 })
      .png()
      .toBuffer();
  } catch (e) {
    console.warn("[wusool] image preprocessing skipped", e);
    return data;
  }
}

export async function ocrImage(data: Buffer): Promise<OcrResult> {
  const w = await worker();
  const { data: page } = await w.recognize(await preprocess(data), {}, { text: true, blocks: true });
  const lines: OcrLine[] = (page.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) => p.lines.map((l) => ({ text: l.text.replace(/\s+$/g, ""), confidence: Math.round(l.confidence) }))),
  );
  return { text: page.text, lines: lines.length ? lines : page.text.split("\n").map((t) => ({ text: t })), confidence: page.confidence, engine: "tesseract" };
}
