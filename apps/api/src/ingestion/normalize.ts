import type { CreateChunk } from "@fieldfix/contracts";
import type { NormalizedSection } from "./types.js";

/** Sections -> size-bounded, storable chunks. */

export const DEFAULT_MAX_CHUNK_CHARS = 4000;

/**
 * Deterministic safety-keyword tagger. A heuristic aid for filtering,
 * not a safety verdict — the safety controller stays authoritative.
 */
const SAFETY_KEYWORDS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: "battery", patterns: [/\bbatter(y|ies)\b/i] },
  { tag: "swelling", patterns: [/\bswelling\b/i, /\bswollen\b/i, /\bbulging\b/i, /\bdeformed\b/i] },
  { tag: "heat", patterns: [/\bheat\b/i, /\bhot\b/i, /\boverheat/i, /\bthermal\b/i] },
  { tag: "high_voltage", patterns: [/\bhigh[- ]voltage\b/i, /\bvoltage\b/i, /\bcapacitor\b/i] },
  { tag: "shock_hazard", patterns: [/\bshock\b/i, /\belectrocution\b/i, /\blive\b.+\b(wire|circuit|conductor)/i] },
  { tag: "smoke", patterns: [/\bsmoke\b/i, /\bhissing\b/i, /\bburning smell\b/i] },
  { tag: "fire", patterns: [/\bfire\b/i, /\bflame/i] },
  { tag: "liquid", patterns: [/\bliquid\b/i, /\bwater damage\b/i, /\bspill/i] },
  { tag: "puncture", patterns: [/\bpuncture\b/i] },
  { tag: "sparks", patterns: [/\bspark(s|ing)?\b/i] },
];

export function detectSafetyTags(content: string): string[] {
  const tags: string[] = [];
  for (const { tag, patterns } of SAFETY_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(content))) {
      tags.push(tag);
    }
  }
  return tags;
}

export interface NormalizeOptions {
  maxChars?: number;
  /** Document-level model numbers applied when a section has none. */
  defaultModelApplicability?: string[];
  startIndex?: number;
}

function splitLongContent(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) {
    return [content];
  }
  const parts: string[] = [];
  let rest = content;
  while (rest.length > maxChars) {
    // Prefer a paragraph break, else a sentence end, else a hard cut.
    const window = rest.slice(0, maxChars);
    const para = window.lastIndexOf("\n\n");
    const sentence = window.lastIndexOf(". ");
    const cut = para > maxChars * 0.3
      ? para + 2
      : sentence > maxChars * 0.3
        ? sentence + 2
        : maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) {
    parts.push(rest);
  }
  return parts.filter((part) => part.length > 0);
}

/**
 * Split sections into chunks that fit the content cap, preserving
 * heading, page, step order (in the heading suffix), and tags.
 */
export function sectionsToChunks(
  sections: NormalizedSection[],
  options: NormalizeOptions = {},
): CreateChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const chunks: CreateChunk[] = [];
  let index = options.startIndex ?? 0;
  for (const section of sections) {
    const content = section.content.trim();
    if (content.length === 0) {
      continue;
    }
    const pieces = splitLongContent(content, maxChars);
    for (const [pieceIndex, piece] of pieces.entries()) {
      const heading = section.heading && pieces.length > 1
        ? `${section.heading} (part ${pieceIndex + 1}/${pieces.length})`
        : section.heading;
      const safetyTags = [
        ...new Set([...section.safetyTags, ...detectSafetyTags(piece)]),
      ].slice(0, 10);
      chunks.push({
        chunk_index: index,
        page_number: section.pageNumber,
        heading,
        content: piece,
        safety_tags: safetyTags,
        component_tags: [...new Set(section.componentTags)].slice(0, 20),
        model_applicability:
          section.modelApplicability.length > 0
            ? [...new Set(section.modelApplicability)].slice(0, 20)
            : [...(options.defaultModelApplicability ?? [])],
      });
      index += 1;
    }
  }
  return chunks;
}
