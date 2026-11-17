import { InlineKeyboard, type Bot } from 'grammy';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { AppDb } from '../db/index.js';
import {
  ignoreRules,
  notifications,
  processedMessages,
  sources,
  watchRules,
} from '../db/schema.js';
import type { IncomingChannelMessage } from '../gramjs/client.js';
import { stripTrackingParams, unshortenUrl } from '../security/unshortener.js';
import { computeContentHash, isDuplicateOffer } from './dedupe.js';
import { matchRules } from './filter.js';
import { extractPrices, formatBrl, type ParsedPrice } from './price.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAlertHtml(params: {
  ruleName: string;
  sourceTitle: string;
  parsedPrice: ParsedPrice | null;
  text: string;
  primaryUrl: string | null;
}): string {
  const priceLine = params.parsedPrice
    ? `💰 <b>${escapeHtml(formatBrl(params.parsedPrice.bestPriceCents))}</b> (${params.parsedPrice.priceType.toUpperCase()})`
    : '💰 <i>Preço não detectado</i>';

  const couponLine = params.parsedPrice?.coupon
    ? `\n🎟️ Cupom: <code>${escapeHtml(params.parsedPrice.coupon)}</code>`
    : '';

  const snippet = params.text.trim().slice(0, 420);
  const ellipsis = params.text.trim().length > 420 ? '...' : '';

  return (
    `🎯 <b>${escapeHtml(params.ruleName)}</b>\n` +
    `${priceLine}${couponLine}\n` +
    `📡 Fonte: <i>${escapeHtml(params.sourceTitle)}</i>\n\n` +
    `<blockquote>${escapeHtml(snippet + ellipsis)}</blockquote>` +
    (params.primaryUrl ? `\n🔗 ${escapeHtml(params.primaryUrl)}` : '')
  );
}

export async function processIncomingMessage(params: {
  msg: IncomingChannelMessage;
  db: AppDb;
  bot: Bot;
  config: AppConfig;
}): Promise<void> {
  const { msg, db, bot, config } = params;

  const [source] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.tgId, msg.tgChatId), eq(sources.isActive, true), isNull(sources.deletedAt)))
    .limit(1);

  if (!source) {
    return;
  }

  const activeRules = await db
    .select()
    .from(watchRules)
    .where(and(eq(watchRules.isActive, true), isNull(watchRules.deletedAt)));

  if (activeRules.length === 0) {
    return;
  }

  const activeIgnores = await db
    .select()
    .from(ignoreRules)
    .where(isNull(ignoreRules.deletedAt));

  const parsedPrice = extractPrices(msg.text);
  const matches = matchRules({
    text: msg.text,
    sourceId: source.id,
    parsedPrice,
    watchRules: activeRules,
    ignoreRules: activeIgnores,
  });

  if (matches.length === 0) {
    return;
  }

  // Only unshorten URLs for messages that passed the cheap keyword/budget filter
  const resolvedUrls: string[] = [];
  for (const rawUrl of msg.urls.slice(0, 3)) {
    if (config.UNSHORTEN_URLS) {
      const res = await unshortenUrl(rawUrl, {
        maxRedirects: config.MAX_REDIRECTS,
        timeoutMs: config.HTTP_TIMEOUT_MS,
      });
      resolvedUrls.push(res.finalUrl);
    } else {
      resolvedUrls.push(stripTrackingParams(rawUrl));
    }
  }

  const primaryUrl = resolvedUrls[0] ?? null;
  const contentHash = computeContentHash(msg.text);

  const duplicated = await isDuplicateOffer(db, {
    sourceId: source.id,
    messageId: msg.messageId,
    contentHash,
    primaryUrl,
    ttlHours: config.DEDUPE_TTL_HOURS,
  });

  if (duplicated) {
    return;
  }

  const [insertedMsg] = await db
    .insert(processedMessages)
    .values({
      sourceId: source.id,
      messageId: msg.messageId,
      contentHash,
      primaryUrl,
      urls: resolvedUrls,
      priceCents: parsedPrice?.bestPriceCents ?? null,
      priceType: parsedPrice?.priceType ?? 'unknown',
    })
    .returning({ id: processedMessages.id });

  for (const { rule } of matches) {
    const html = formatAlertHtml({
      ruleName: rule.name,
      sourceTitle: source.title,
      parsedPrice,
      text: msg.text,
      primaryUrl,
    });

    const keyboard = primaryUrl
      ? new InlineKeyboard().url('🛒 Abrir oferta', primaryUrl)
      : undefined;

    try {
      const sent = await bot.api.sendMessage(rule.chatId, html, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: false },
        ...(rule.topicId ? { message_thread_id: rule.topicId } : {}),
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });

      await db.insert(notifications).values({
        ruleId: rule.id,
        processedMsgId: insertedMsg.id,
        chatId: rule.chatId,
        topicId: rule.topicId ?? null,
        botMessageId: sent.message_id,
        status: 'sent',
      });
    } catch (err) {
      await db.insert(notifications).values({
        ruleId: rule.id,
        processedMsgId: insertedMsg.id,
        chatId: rule.chatId,
        topicId: rule.topicId ?? null,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}
