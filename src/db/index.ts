import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.js';

export type AppDb = SqliteRemoteDatabase<typeof schema>;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  username TEXT,
  folder_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS sources_active_idx ON sources (is_active, deleted_at);

CREATE TABLE IF NOT EXISTS watch_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  topic_id INTEGER,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,
  regex TEXT,
  min_price_cents INTEGER,
  max_price_cents INTEGER,
  source_ids TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS watch_rules_active_idx ON watch_rules (is_active, deleted_at);

CREATE TABLE IF NOT EXISTS ignore_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  pattern TEXT NOT NULL,
  is_regex INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS ignore_rules_deleted_idx ON ignore_rules (deleted_at);

CREATE TABLE IF NOT EXISTS processed_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  primary_url TEXT,
  urls TEXT NOT NULL,
  price_cents INTEGER,
  price_type TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS processed_msg_uniq ON processed_messages (source_id, message_id);
CREATE INDEX IF NOT EXISTS processed_hash_idx ON processed_messages (content_hash, created_at);
CREATE INDEX IF NOT EXISTS processed_url_idx ON processed_messages (primary_url, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
  processed_msg_id INTEGER NOT NULL REFERENCES processed_messages(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  topic_id INTEGER,
  bot_message_id INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS notif_rule_msg_uniq ON notifications (rule_id, processed_msg_id);
`;

export function createDatabase(dbPath: string): { db: AppDb; sqlite: DatabaseSync } {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const sqlite = new DatabaseSync(dbPath, {
    timeout: 5000,
    enableForeignKeyConstraints: true,
    returnArrays: true,
  });

  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(INIT_SQL);

  const db = drizzle(
    async (sqlStr, params, method) => {
      const stmt = sqlite.prepare(sqlStr);
      const bound = params as SQLInputValue[];

      if (method === 'run') {
        stmt.run(...bound);
        return { rows: [] };
      }

      if (method === 'get') {
        const row = stmt.get(...bound) as unknown as unknown[] | undefined;
        return { rows: row as unknown[] };
      }

      const rows = stmt.all(...bound) as unknown as unknown[][];
      return { rows };
    },
    { schema }
  );

  return { db, sqlite };
}
