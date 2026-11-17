export type PriceType = 'pix' | 'cash' | 'installment' | 'unknown';

export type ParsedPrice = {
  bestPriceCents: number;
  priceType: PriceType;
  allPricesCents: number[];
  coupon: string | null;
};

type PriceCandidate = {
  cents: number;
  kind: 'pix' | 'cash' | 'installment' | 'unknown';
};

const BRL_REGEX = /(?:R\$\s*|\bpor\s+)(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2}))/gi;
const INSTALLMENT_PREFIX_REGEX = /(\d{1,2})\s*x\s*(?:de\s*)?$/i;
const COUPON_REGEX =
  /\b(?:cupom|código|codigo|use\s+o\s+cupom|aplique)[:\s-]*[`'"]*([A-Za-z0-9_-]{3,24})[`'"]*/gi;

const PIX_TERMS = ['pix', 'à vista', 'a vista', 'avista', 'boleto'];
const IGNORED_COUPON_WORDS = new Set(['DE', 'PARA', 'COM', 'SEM', 'NO', 'NA', 'EM', 'POR', 'DO', 'DA']);

function parseBrlToCents(raw: string): number | null {
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

export function extractCoupon(text: string): string | null {
  const regex = new RegExp(COUPON_REGEX.source, COUPON_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const candidate = match[1].toUpperCase().trim();
    if (candidate.length >= 3 && !IGNORED_COUPON_WORDS.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extracts BRL prices from promo text, prioritizing Pix/cash prices and computing
 * total installment price when posts write e.g. "10x de R$ 250,00".
 */
export function extractPrices(text: string): ParsedPrice | null {
  const candidates: PriceCandidate[] = [];
  const regex = new RegExp(BRL_REGEX.source, BRL_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawNumber = match[1];
    const baseCents = parseBrlToCents(rawNumber);
    if (baseCents === null) continue;

    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 24), start);
    const after = text.slice(end, Math.min(text.length, end + 32)).toLowerCase();
    const beforeLower = before.toLowerCase();

    const instMatch = before.match(INSTALLMENT_PREFIX_REGEX);
    if (instMatch) {
      const count = Number.parseInt(instMatch[1], 10);
      if (count >= 2 && count <= 36) {
        candidates.push({ cents: baseCents * count, kind: 'installment' });
        continue;
      }
    }

    if (PIX_TERMS.some((term) => beforeLower.includes(term) || after.includes(term))) {
      candidates.push({ cents: baseCents, kind: 'pix' });
      continue;
    }

    candidates.push({ cents: baseCents, kind: 'unknown' });
  }

  if (candidates.length === 0) return null;

  const pixCandidates = candidates.filter((c) => c.kind === 'pix');
  const unknownCandidates = candidates.filter((c) => c.kind === 'unknown');
  const installmentCandidates = candidates.filter((c) => c.kind === 'installment');

  let chosen: PriceCandidate;
  if (pixCandidates.length > 0) {
    chosen = pixCandidates.reduce((min, cur) => (cur.cents < min.cents ? cur : min));
  } else if (unknownCandidates.length > 0) {
    chosen = unknownCandidates.reduce((min, cur) => (cur.cents < min.cents ? cur : min));
  } else {
    chosen = installmentCandidates.reduce((min, cur) => (cur.cents < min.cents ? cur : min));
  }

  const allPricesCents = Array.from(new Set(candidates.map((c) => c.cents))).sort((a, b) => a - b);

  return {
    bestPriceCents: chosen.cents,
    priceType: chosen.kind,
    allPricesCents,
    coupon: extractCoupon(text),
  };
}

export function formatBrl(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${sign}R$ ${reais.toLocaleString('pt-BR')},${centavos}`;
}
