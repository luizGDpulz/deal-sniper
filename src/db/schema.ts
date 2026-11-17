import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Monitored Telegram channels/supergroups ingested passively via GramJS.
 */
export const sources = sqliteTable(
  'sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tgId: text('tg_id').notNull().unique(),
    title: text('title').notNull(),
    username: text('username'),
    folderName: text('folder_name'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (t) => [index('sources_active_idx').on(t.isActive, t.deletedAt)]
);

/**
 * User-defined product watch rules with keyword/regex filters and BRL budget ceilings.
 */
export const watchRules = sqliteTable(
  'watch_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    chatId: text('chat_id').notNull(),
    topicId: integer('topic_id'),
    name: text('name').notNull(),
    keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull(),
    regex: text('regex'),
    minPriceCents: integer('min_price_cents'),
    maxPriceCents: integer('max_price_cents'),
    sourceIds: text('source_ids', { mode: 'json' }).$type<number[]>().notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (t) => [index('watch_rules_active_idx').on(t.isActive, t.deletedAt)]
);

/**
 * Negative filter rules (e.g. accessories, used items, spam terms).
 */
export const ignoreRules = sqliteTable(
  'ignore_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id'),
    pattern: text('pattern').notNull(),
    isRegex: integer('is_regex', { mode: 'boolean' }).default(false).notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (t) => [index('ignore_rules_deleted_idx').on(t.deletedAt)]
);

/**
 * Processed incoming messages used for content/URL deduplication within TTL windows.
 */
export const processedMessages = sqliteTable(
  'processed_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    messageId: integer('message_id').notNull(),
    contentHash: text('content_hash').notNull(),
    primaryUrl: text('primary_url'),
    urls: text('urls', { mode: 'json' }).$type<string[]>().notNull(),
    priceCents: integer('price_cents'),
    priceType: text('price_type', { enum: ['pix', 'cash', 'installment', 'unknown'] })
      .default('unknown')
      .notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (t) => [
    uniqueIndex('processed_msg_uniq').on(t.sourceId, t.messageId),
    index('processed_hash_idx').on(t.contentHash, t.createdAt),
    index('processed_url_idx').on(t.primaryUrl, t.createdAt),
  ]
);

/**
 * Sent notifications audit log ensuring idempotent delivery per rule/message.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ruleId: integer('rule_id')
      .notNull()
      .references(() => watchRules.id, { onDelete: 'cascade' }),
    processedMsgId: integer('processed_msg_id')
      .notNull()
      .references(() => processedMessages.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    topicId: integer('topic_id'),
    botMessageId: integer('bot_message_id'),
    status: text('status', { enum: ['sent', 'failed', 'suppressed'] }).notNull(),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (t) => [uniqueIndex('notif_rule_msg_uniq').on(t.ruleId, t.processedMsgId)]
);
