import crypto from 'node:crypto';
import { and, eq, gte, lt, or } from 'drizzle-orm';
import type { AppDb } from '../db/index.js';
import { processedMessages } from '../db/schema.js';
import { normalizeText } from './filter.js';

export function computeContentHash(text: string): string {
  const normalized = normalizeText(text).replace(/https?:\/\/\S+/g, '').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Checks whether an incoming offer (by source+messageId, content hash, or primary URL)
 * was already processed within the deduplication TTL window.
 */
export async function isDuplicateOffer(
  db: AppDb,
  params: {
    sourceId: number;
    messageId: number;
    contentHash: string;
    primaryUrl: string | null;
    ttlHours: number;
  }
): Promise<boolean> {
  const cutoff = new Date(Date.now() - params.ttlHours * 3600 * 1000);

  const conditions = [
    and(
      eq(processedMessages.sourceId, params.sourceId),
      eq(processedMessages.messageId, params.messageId)
    ),
    and(
      eq(processedMessages.contentHash, params.contentHash),
      gte(processedMessages.createdAt, cutoff)
    ),
  ];

  if (params.primaryUrl) {
    conditions.push(
      and(
        eq(processedMessages.primaryUrl, params.primaryUrl),
        gte(processedMessages.createdAt, cutoff)
      )
    );
  }

  const existing = await db
    .select({ id: processedMessages.id })
    .from(processedMessages)
    .where(or(...conditions))
    .limit(1);

  return existing.length > 0;
}

export async function pruneExpiredProcessedMessages(db: AppDb, retentionDays = 14): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  await db.delete(processedMessages).where(lt(processedMessages.createdAt, cutoff));
}
