/** Deterministic matching of part recommendations to supplier listings. */

export const MAX_OFFERS = 8;

/** Noise words that carry no matching signal in part names. */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "the",
  "with",
  "replacement",
  "replacements",
  "compatible",
  "original",
  "genuine",
  "new",
  "unit",
  "part",
  "parts",
]);

export function normalizeTerm(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

/** Part numbers match after case/punctuation folding ("AB-123" = "ab123"). */
export function normalizePartNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface MatchableProduct {
  name: string;
  part_number: string | null;
}

export interface ProductScore {
  kind: "part_number" | "keywords";
  matchedTerms: string[];
  score: number;
}

/**
 * Exact (folded) part-number equality always wins. Otherwise the
 * fraction of recommendation terms present in the product name must
 * reach 0.5 with at least one term matched. Ties keep feed order.
 */
export function scoreProduct(
  partName: string,
  partNumber: string | null,
  product: MatchableProduct,
): ProductScore | null {
  if (partNumber && product.part_number) {
    const want = normalizePartNumber(partNumber);
    if (want.length > 0 && want === normalizePartNumber(product.part_number)) {
      return { kind: "part_number", matchedTerms: [product.part_number], score: 1 };
    }
  }
  const terms = normalizeTerm(partName);
  if (terms.length === 0) {
    return null;
  }
  const haystack = new Set(normalizeTerm(product.name));
  const matched = terms.filter((term) => haystack.has(term));
  if (matched.length === 0) {
    return null;
  }
  const score = matched.length / terms.length;
  if (score < 0.5) {
    return null;
  }
  return { kind: "keywords", matchedTerms: [...new Set(matched)], score };
}

/** Fill a supplier's {q} search template, or fall back to its website. */
export function outboundSearchUrl(
  template: string | null,
  websiteUrl: string,
  query: string,
): string {
  if (!template) {
    return websiteUrl;
  }
  return template.replace("{q}", encodeURIComponent(query));
}
