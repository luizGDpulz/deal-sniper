import { Bot } from 'grammy';
import type { TelegramClient } from 'telegram';
import { registerCommands } from './commands/index.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';
import { createGramJsListener, type GramJsListener } from './gramjs/client.js';
import { syncSourcesFromTelegram } from './gramjs/sync.js';
import { pruneExpiredProcessedMessages } from './pipeline/dedupe.js';
import { processIncomingMessage } from './pipeline/ingest.js';
import { createAuthMiddleware } from './security/auth.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const { db, sqlite } = createDatabase(config.DATABASE_PATH);

  const bot = new Bot(config.BOT_TOKEN);
  bot.use(createAuthMiddleware(config.ALLOWED_USER_IDS, config.ALLOWED_CHAT_ID));

  let listener: GramJsListener | null = null;
  const getGramClient = (): TelegramClient | null => listener?.client ?? null;

  registerCommands({ bot, db, config, getGramClient });

  bot.catch((err) => {
    console.error('[bot] Error handling update:', err.error);
  });

  if (config.TELEGRAM_SESSION) {
    listener = await createGramJsListener({
      apiId: config.TELEGRAM_API_ID,
      apiHash: config.TELEGRAM_API_HASH,
      sessionString: config.TELEGRAM_SESSION,
      onMessage: async (msg) => {
        try {
          await processIncomingMessage({ msg, db, bot, config });
        } catch (err) {
          console.error('[pipeline] Failed processing message:', err);
        }
      },
    });

    const initialSync = await syncSourcesFromTelegram(
      listener.client,
      db,
      config.TELEGRAM_FOLDER_NAME
    );
    console.info(
      `[sync] Initial channel sync complete: total=${initialSync.total} active=${initialSync.activeCount}`
    );
  } else {
    console.warn(
      '[gramjs] TELEGRAM_SESSION is empty — MTProto listener disabled. Run `pnpm run auth` to connect.'
    );
  }

  const syncInterval = setInterval(
    async () => {
      if (!listener) return;
      try {
        await syncSourcesFromTelegram(listener.client, db, config.TELEGRAM_FOLDER_NAME);
        await pruneExpiredProcessedMessages(db);
      } catch (err) {
        console.error('[scheduler] Sync/cleanup failed:', err);
      }
    },
    config.SYNC_INTERVAL_MINUTES * 60 * 1000
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[main] Received ${signal}, shutting down cleanly...`);
    const forceTimer = setTimeout(() => process.exit(1), 8000);
    forceTimer.unref();

    clearInterval(syncInterval);
    await bot.stop();
    if (listener) {
      await listener.disconnect();
    }
    sqlite.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => console.error('[main] Unhandled rejection:', err));

  console.info('[main] Starting deal-sniper (outbound-only, zero exposed ports)...');
  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => {
      console.info(`[bot] Online as @${info.username}`);
    },
  });
}

bootstrap().catch((err) => {
  console.error('[main] Fatal startup error:', err);
  process.exit(1);
});
