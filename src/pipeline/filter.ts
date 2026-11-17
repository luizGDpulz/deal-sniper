import type { ParsedPrice } from './price.js';

export type WatchRuleInput = {
  id: number;
  name: string;
  keywords: string[];
  regex?: string | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  sourceIds: number[];
};

export type IgnoreRuleInput = {
  pattern: string;
  isRegex: boolean;
};

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isIgnored(text: string, ignoreRules: IgnoreRuleInput[]): string | null {
  const normalized = normalizeText(text);
  for (const rule of ignoreRules) {
    try {
      if (rule.isRegex) {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(normalized)) {
          return rule.pattern;
        }
      } else if (normalized.includes(normalizeText(rule.pattern))) {
        return rule.pattern;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function matchRules(params: {
  text: string;
  sourceId: number;
  parsedPrice: ParsedPrice | null;
  watchRules: WatchRuleInput[];
  ignoreRules: IgnoreRuleInput[];
}): Array<{ rule: WatchRuleInput; reason: string }> {
  if (isIgnored(params.text, params.ignoreRules) !== null) {
    return [];
  }

  const normalized = normalizeText(params.text);
  const matches: Array<{ rule: WatchRuleInput; reason: string }> = [];

  for (const rule of params.watchRules) {
    if (rule.sourceIds.length > 0 && !rule.sourceIds.includes(params.sourceId)) {
      continue;
    }

    const hasKeywords = rule.keywords.length > 0;
    const hasRegex = typeof rule.regex === 'string' && rule.regex.trim().length > 0;
    if (!hasKeywords && !hasRegex) {
      continue;
    }

    const keywordsOk = hasKeywords
      ? rule.keywords.every((kw) => normalized.includes(normalizeText(kw)))
      : true;

    let regexOk = true;
    if (hasRegex && rule.regex) {
      try {
        regexOk = new RegExp(rule.regex, 'i').test(normalized);
      } catch {
        regexOk = false;
      }
    }

    if (!keywordsOk || !regexOk) {
      continue;
    }

    const hasMax = rule.maxPriceCents !== null && rule.maxPriceCents !== undefined;
    const hasMin = rule.minPriceCents !== null && rule.minPriceCents !== undefined;

    if (hasMax || hasMin) {
      if (!params.parsedPrice) {
        continue;
      }
      if (hasMax && params.parsedPrice.bestPriceCents > rule.maxPriceCents!) {
        continue;
      }
      if (hasMin && params.parsedPrice.bestPriceCents < rule.minPriceCents!) {
        continue;
      }
    }

    matches.push({
      rule,
      reason: hasMax ? 'keywords + budget matched' : 'keywords matched',
    });
  }

  return matches;
}
