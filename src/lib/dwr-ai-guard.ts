/**
 * Client-side gate for daily work report "What you did" lines.
 * SQL `dwr_description_looks_ai` in `20261003130000_dwr_anti_ai_guard.sql` must use the same
 * phrases, weights, and thresholds. Draft saves stay lenient; only submit hard-fails.
 */

export const DWR_PASTE_BLOCKED_MESSAGE =
  "Paste is not allowed. Type what you did in your own words.";

export const DWR_AI_DESCRIPTION_MESSAGE =
  "Description looks AI-generated or pasted. Rewrite each line in your own words.";

/** beforeinput types that insert clipboard or dragged text. */
const BLOCKED_INSERT_TYPES = new Set(["insertFromPaste", "insertFromDrop"]);

const PASTE_NOTICE_GAP_MS = 400;

const AI_PHRASES = [
  "as an ai",
  "i hope this helps",
  "it is important to note",
  "it's important to note",
  "it is worth noting",
  "it's worth noting",
  "plays a crucial role",
  "a wide range of",
  "in conclusion",
  "in summary",
  "in today's",
  "cutting-edge",
  "ever-evolving",
  "furthermore",
  "moreover",
  "additionally",
  "leveraging",
  "delve",
  "comprehensive",
  "facilitate",
  "underscore",
  "multifaceted",
  "holistic",
  "pivotal",
  "paramount",
  "seamless",
  "tapestry",
  "foster",
  "robust",
] as const;

const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);

let lastPasteNoticeAt = 0;

export function isBlockedDescriptionInputType(inputType: string): boolean {
  return BLOCKED_INSERT_TYPES.has(inputType);
}

/** True when the caller should show the paste toast. Collapses paste + beforeinput into one notice. */
export function claimPasteBlockNotice(now = Date.now()): boolean {
  if (now - lastPasteNoticeAt < PASTE_NOTICE_GAP_MS) return false;
  lastPasteNoticeAt = now;
  return true;
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s*\n+\s*/g, ". ")
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 0);
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function phraseHits(lower: string): number {
  let hits = 0;
  for (const phrase of AI_PHRASES) {
    if (phrase === "as an ai") {
      if (/(?:^|[^a-z])as an ai(?:[^a-z]|$)/.test(lower)) hits += 1;
      continue;
    }
    if (lower.includes(phrase)) hits += 1;
  }
  return hits;
}

/**
 * Hard-fail a single item description. Short work notes pass; a pasted essay fails.
 * Score (fail at 5, or at 3 template phrases):
 * - each template phrase, capped at 4, is +2
 * - markdown ** is +3
 * - 3+ numbered lines is +3
 * - 3+ bullet lines is +2
 * - over 400 characters in 1–3 long sentences is +4
 * - a single sentence over 400 characters is +2 more
 * - 4+ long, uniform sentences (low burstiness) is +5
 * - a high function-word ratio on longer text is +2
 */
export function descriptionLooksAi(text: string): boolean {
  const value = text.trim();
  if (value.length === 0) return false;

  const lower = value.toLowerCase();
  const hits = phraseHits(lower);
  const numbered = countMatches(value, /(?:^|\n)\s*\d+\.\s+\S/g);
  const bullets = countMatches(value, /(?:^|\n)\s*[-*•]\s+\S/g);
  const hasMarkdown = value.includes("**");
  const sentences = sentencesOf(value);

  if (
    value.length <= 360 &&
    sentences.length <= 3 &&
    hits <= 1 &&
    numbered < 3 &&
    bullets < 3 &&
    !hasMarkdown
  ) {
    return false;
  }

  let score = Math.min(hits, 4) * 2;
  if (hasMarkdown) score += 3;
  if (numbered >= 3) score += 3;
  if (bullets >= 3) score += 2;

  const allLong = sentences.length > 0 && sentences.every((sentence) => sentence.length > 80);
  if (value.length > 400 && sentences.length >= 1 && sentences.length <= 3 && allLong) {
    score += 4;
  }
  if (value.length > 400 && sentences.length === 1) {
    score += 2;
  }

  if (sentences.length >= 4) {
    const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
    const mean = total / sentences.length;
    const variance =
      sentences.reduce((sum, sentence) => sum + (sentence.length - mean) ** 2, 0) /
      sentences.length;
    const cv = Math.sqrt(Math.max(variance, 0)) / mean;
    if (mean >= 80 && cv < 0.28) score += 5;
  }

  const words = wordsOf(value);
  if (words.length >= 55) {
    const functionCount = words.filter((word) => FUNCTION_WORDS.has(word)).length;
    if (functionCount / words.length > 0.5) score += 2;
  }

  return hits >= 3 || score >= 5;
}

export function descriptionsLookAi(descriptions: readonly string[]): boolean {
  return descriptions.some((description) => descriptionLooksAi(description));
}
