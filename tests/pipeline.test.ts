import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/index.js';
import { sources, processedMessages } from '../src/db/schema.js';
import { computeContentHash, isDuplicateOffer } from '../src/pipeline/dedupe.js';
import { matchRules } from '../src/pipeline/filter.js';
import { extractPrices, formatBrl } from '../src/pipeline/price.js';

describe('extractPrices & formatBrl', () => {
  it('prioritizes Pix price over installment breakdown and extracts coupon', () => {
    const text =
      '🔥 Monitor LG UltraGear OLED 27" por R$ 3.299,90 no Pix (ou 10x de R$ 369,90) usando o cupom OLED10!';
    const parsed = extractPrices(text);

    expect(parsed).not.toBeNull();
    expect(parsed!.bestPriceCents).toBe(329990);
    expect(parsed!.priceType).toBe('pix');
    expect(parsed!.coupon).toBe('OLED10');
    expect(formatBrl(parsed!.bestPriceCents)).toBe('R$ 3.299,90');
  });

  it('computes total price when only installments are present', () => {
    const text = 'SSD NVMe 2TB por 10x de R$ 79,90 sem juros';
    const parsed = extractPrices(text);

    expect(parsed).not.toBeNull();
    expect(parsed!.bestPriceCents).toBe(79900);
    expect(parsed!.priceType).toBe('installment');
  });
});

describe('matchRules', () => {
  const rules = [
    {
      id: 1,
      name: 'Monitor OLED',
      keywords: ['monitor', 'oled'],
      maxPriceCents: 350000,
      sourceIds: [],
    },
  ];
  const ignores = [{ pattern: 'suporte', isRegex: false }];

  it('matches keywords within budget and respects ignore blacklist', () => {
    const ok = matchRules({
      text: 'Monitor Gamer OLED 27 por R$ 3.299,90 no Pix',
      sourceId: 10,
      parsedPrice: extractPrices('por R$ 3.299,90 no Pix'),
      watchRules: rules,
      ignoreRules: ignores,
    });
    expect(ok).toHaveLength(1);

    const overBudget = matchRules({
      text: 'Monitor Gamer OLED 27 por R$ 4.199,00 no Pix',
      sourceId: 10,
      parsedPrice: extractPrices('por R$ 4.199,00 no Pix'),
      watchRules: rules,
      ignoreRules: ignores,
    });
    expect(overBudget).toHaveLength(0);

    const ignored = matchRules({
      text: 'Suporte articulado para Monitor OLED por R$ 299,00',
      sourceId: 10,
      parsedPrice: extractPrices('por R$ 299,00'),
      watchRules: rules,
      ignoreRules: ignores,
    });
    expect(ignored).toHaveLength(0);
  });
});

describe('dedupe with node:sqlite + Drizzle', () => {
  it('detects duplicate URLs across different channels within TTL', async () => {
    const { db, sqlite } = createDatabase(':memory:');
    try {
      const [src1] = await db
        .insert(sources)
        .values({ tgId: '-1001', title: 'Promo 1' })
        .returning({ id: sources.id });
      const [src2] = await db
        .insert(sources)
        .values({ tgId: '-1002', title: 'Promo 2' })
        .returning({ id: sources.id });

      const hash1 = computeContentHash('Monitor OLED R$ 3.299,90 https://amzn.to/abc');
      await db.insert(processedMessages).values({
        sourceId: src1.id,
        messageId: 42,
        contentHash: hash1,
        primaryUrl: 'https://www.amazon.com.br/dp/B09V3KXJPB',
        urls: ['https://www.amazon.com.br/dp/B09V3KXJPB'],
        priceCents: 329990,
        priceType: 'pix',
      });

      const dupByUrl = await isDuplicateOffer(db, {
        sourceId: src2.id,
        messageId: 99,
        contentHash: 'different-hash',
        primaryUrl: 'https://www.amazon.com.br/dp/B09V3KXJPB',
        ttlHours: 12,
      });
      expect(dupByUrl).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
