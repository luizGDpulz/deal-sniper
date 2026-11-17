import { Api, TelegramClient, utils } from 'telegram';
import { eq } from 'drizzle-orm';
import type { AppDb } from '../db/index.js';
import { sources } from '../db/schema.js';

function extractDialogFilterTitle(filter: Api.DialogFilter | Api.DialogFilterChatlist): string {
  const raw = filter.title as unknown;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'text' in raw && typeof (raw as { text: unknown }).text === 'string') {
    return (raw as { text: string }).text;
  }
  return '';
}

async function resolveFolderPeerIds(client: TelegramClient, folderName: string): Promise<Set<string>> {
  const peerIds = new Set<string>();
  const response = await client.invoke(new Api.messages.GetDialogFilters());
  const filters = 'filters' in response && Array.isArray(response.filters) ? response.filters : [];

  for (const filter of filters) {
    if (!(filter instanceof Api.DialogFilter) && !(filter instanceof Api.DialogFilterChatlist)) {
      continue;
    }

    const title = extractDialogFilterTitle(filter);
    if (title.toLowerCase() !== folderName.toLowerCase()) {
      continue;
    }

    const peers = [
      ...('includePeers' in filter ? filter.includePeers : []),
      ...('pinnedPeers' in filter ? filter.pinnedPeers : []),
    ];

    for (const peer of peers) {
      try {
        peerIds.add(utils.getPeerId(peer));
      } catch {
        // Ignore unsupported peer variants
      }
    }
  }

  return peerIds;
}

/**
 * Syncs channels and megagroups from the authenticated Telegram account into SQLite.
 * If folderName is provided and matched, only channels inside that folder are marked active.
 */
export async function syncSourcesFromTelegram(
  client: TelegramClient,
  db: AppDb,
  folderName?: string
): Promise<{ total: number; added: number; updated: number; activeCount: number }> {
  const dialogs = await client.getDialogs({ limit: 250 });
  const folderPeerIds = folderName ? await resolveFolderPeerIds(client, folderName) : null;
  const folderMatched = folderPeerIds !== null && folderPeerIds.size > 0;

  const existing = await db.select().from(sources);
  const existingMap = new Map(existing.map((row) => [row.tgId, row]));

  let total = 0;
  let added = 0;
  let updated = 0;
  let activeCount = 0;

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity || !(entity instanceof Api.Channel)) {
      continue;
    }

    const tgId = utils.getPeerId(entity);
    const title = entity.title || tgId;
    const username = entity.username ?? null;
    const current = existingMap.get(tgId);

    const isActive = folderMatched
      ? folderPeerIds.has(tgId)
      : current
        ? current.isActive
        : true;

    total++;
    if (isActive) activeCount++;

    if (current) {
      await db
        .update(sources)
        .set({
          title,
          username,
          folderName: folderName ?? current.folderName,
          isActive,
          deletedAt: null,
        })
        .where(eq(sources.id, current.id));
      updated++;
    } else {
      await db.insert(sources).values({
        tgId,
        title,
        username,
        folderName: folderName ?? null,
        isActive,
      });
      added++;
    }
  }

  return { total, added, updated, activeCount };
}
