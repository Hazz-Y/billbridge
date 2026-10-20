/** extractInvoice(buffer, mime): Gemini when configured (15 s budget), else deterministic fallback. Both share postprocess(). */
import type { ExtractedInvoice } from '@billbridge/shared';
import { config } from '../config.js';
import { extractWithFallback } from './fallback.js';
import { extractWithGemini } from './gemini.js';

type Logger = { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void };

export async function extractInvoice(buffer: Buffer, mime: string, log?: Logger): Promise<ExtractedInvoice> {
  const ocrCachePath = `${config.uploadDir}/.tesseract`;
  if (config.gemini.apiKey) {
    try {
      const r = await extractWithGemini(buffer, mime, { apiKey: config.gemini.apiKey, model: config.gemini.model, timeoutMs: config.gemini.timeoutMs });
      log?.info({ source: 'GEMINI', confidence: r.confidence }, 'invoice extracted');
      return r;
    } catch (e) {
      log?.warn({ err: e instanceof Error ? e.message : String(e) }, 'Gemini extraction failed; using fallback extractor');
    }
  }
  const r = await extractWithFallback(buffer, mime, { ocrCachePath });
  log?.info({ source: 'FALLBACK', confidence: r.confidence, warnings: r.warnings }, 'invoice extracted');
  return r;
}
