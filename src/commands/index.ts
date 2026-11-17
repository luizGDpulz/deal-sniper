import type { Bot, Context } from 'grammy';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import type { TelegramClient } from 'telegram';
import type { AppConfig } from '../config.js';
import type { AppDb } from '../db/index.js';
import {
  ignoreRules,
  notifications,
  processedMessages,
  sources,
  watchRules,
} from '../db/schema.js';
import { syncSourcesFromTelegram } from '../gramjs/sync.js';
import { formatBrl } from '../pipeline/price.js';

function replyInContext(ctx: Context, text: string) {
  const threadId = ctx.message?.message_thread_id;
  return ctx.reply(text, {
    parse_mode: 'HTML',
    ...(threadId ? { message_thread_id: threadId } : {}),
  });
}

function parseBudgetToCents(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/R\$/gi, '').replace(/\s+/g, '').trim();
  if (!cleaned) return null;

  // Accept "3500", "3.500", "3500,90", "3.500,90"
  let normalized = cleaned;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '');
  }

  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function registerCommands(params: {
  bot: Bot;
  db: AppDb;
  config: AppConfig;
  getGramClient: () => TelegramClient | null;
}): void {
  const { bot, db, config, getGramClient } = params;

  const helpText =
    `🎯 <b>Deal Sniper</b> — Comandos\n\n` +
    `• <code>/watch Nome | kw1, kw2 | 3500</code> — Cria alerta (teto em R$ opcional)\n` +
    `• <code>/list</code> — Lista alertas ativos\n` +
    `• <code>/unwatch &lt;id&gt;</code> — Remove um alerta (soft delete)\n` +
    `• <code>/ignore &lt;palavra&gt;</code> — Bloqueia termo (ex: capa, usado)\n` +
    `• <code>/unignore &lt;id&gt;</code> — Remove bloqueio\n` +
    `• <code>/sources</code> — Lista canais monitorados\n` +
    `• <code>/toggle &lt;id&gt;</code> — Liga/desliga um canal\n` +
    `• <code>/sync [pasta]</code> — Sincroniza canais do Telegram\n` +
    `• <code>/status</code> — Saúde, contadores e postura de segurança`;

  bot.command('start', (ctx) => replyInContext(ctx, helpText));
  bot.command('help', (ctx) => replyInContext(ctx, helpText));

  bot.command('watch', async (ctx) => {
    const rawArgs = (ctx.match as string | undefined)?.trim() || '';
    const parts = rawArgs.split('|').map((s) => s.trim());

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      await replyInContext(
        ctx,
        '❌ Uso: <code>/watch Nome | palavra1, palavra2 | 3500</code>'
      );
      return;
    }

    const name = parts[0];
    const keywords = parts[1]
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (keywords.length === 0) {
      await replyInContext(ctx, '❌ Informe pelo menos uma palavra-chave.');
      return;
    }

    const maxPriceCents = parts[2] ? parseBudgetToCents(parts[2]) : null;
    if (parts[2] && maxPriceCents === null) {
      await replyInContext(ctx, '❌ Valor de teto inválido. Ex: <code>3500</code> ou <code>3.500,90</code>');
      return;
    }

    const userId = ctx.from?.id.toString() ?? 'unknown';
    const chatId = ctx.chat?.id.toString() ?? userId;
    const topicId = ctx.message?.message_thread_id ?? null;

    const [created] = await db
      .insert(watchRules)
      .values({
        userId,
        chatId,
        topicId,
        name,
        keywords,
        maxPriceCents,
        sourceIds: [],
      })
      .returning({ id: watchRules.id });

    const budgetText = maxPriceCents ? formatBrl(maxPriceCents) : 'Sem teto';
    await replyInContext(
      ctx,
      `✅ Regra <b>#${created.id}</b> criada!\n` +
        `📌 <b>${escapeHtml(name)}</b>\n` +
        `🔎 Keywords: <code>${escapeHtml(keywords.join(', '))}</code>\n` +
        `💰 Teto: <b>${escapeHtml(budgetText)}</b>`
    );
  });

  bot.command('list', async (ctx) => {
    const rules = await db
      .select()
      .from(watchRules)
      .where(and(eq(watchRules.isActive, true), isNull(watchRules.deletedAt)))
      .orderBy(desc(watchRules.id));

    if (rules.length === 0) {
      await replyInContext(ctx, '📭 Nenhuma regra ativa. Use <code>/watch</code> para criar.');
      return;
    }

    const body = rules
      .map(
        (r) =>
          `<b>#${r.id}</b> ${escapeHtml(r.name)}\n` +
          `   🔎 <code>${escapeHtml(r.keywords.join(', '))}</code> | 💰 ${
            r.maxPriceCents ? escapeHtml(formatBrl(r.maxPriceCents)) : 'Sem teto'
          }`
      )
      .join('\n\n');

    await replyInContext(ctx, `📋 <b>Alertas ativos (${rules.length})</b>\n\n${body}`);
  });

  bot.command('unwatch', async (ctx) => {
    const id = Number.parseInt(((ctx.match as string | undefined) || '').trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      await replyInContext(ctx, '❌ Uso: <code>/unwatch &lt;id&gt;</code>');
      return;
    }

    const [existing] = await db
      .select({ id: watchRules.id })
      .from(watchRules)
      .where(and(eq(watchRules.id, id), isNull(watchRules.deletedAt)))
      .limit(1);

    if (!existing) {
      await replyInContext(ctx, `❌ Regra #${id} não encontrada.`);
      return;
    }

    await db
      .update(watchRules)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(watchRules.id, id));

    await replyInContext(ctx, `🗑️ Regra <b>#${id}</b> removida.`);
  });

  bot.command('ignore', async (ctx) => {
    const pattern = ((ctx.match as string | undefined) || '').trim();
    if (!pattern) {
      await replyInContext(ctx, '❌ Uso: <code>/ignore &lt;palavra&gt;</code>');
      return;
    }

    const [created] = await db
      .insert(ignoreRules)
      .values({
        userId: ctx.from?.id.toString() ?? null,
        pattern,
        isRegex: false,
      })
      .returning({ id: ignoreRules.id });

    await replyInContext(
      ctx,
      `🚫 Termo <code>${escapeHtml(pattern)}</code> adicionado à blacklist (<b>#${created.id}</b>).`
    );
  });

  bot.command('unignore', async (ctx) => {
    const id = Number.parseInt(((ctx.match as string | undefined) || '').trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      await replyInContext(ctx, '❌ Uso: <code>/unignore &lt;id&gt;</code>');
      return;
    }

    await db
      .update(ignoreRules)
      .set({ deletedAt: new Date() })
      .where(eq(ignoreRules.id, id));

    await replyInContext(ctx, `✅ Bloqueio <b>#${id}</b> removido.`);
  });

  bot.command('sources', async (ctx) => {
    const list = await db
      .select()
      .from(sources)
      .where(isNull(sources.deletedAt))
      .orderBy(desc(sources.isActive), sources.title);

    if (list.length === 0) {
      await replyInContext(ctx, '📭 Nenhum canal sincronizado ainda. Rode <code>/sync</code>.');
      return;
    }

    const lines = list
      .slice(0, 40)
      .map((s) => `${s.isActive ? '🟢' : '⏸️'} <b>#${s.id}</b> ${escapeHtml(s.title)}`)
      .join('\n');

    await replyInContext(ctx, `📡 <b>Canais mapeados (${list.length})</b>\n\n${lines}`);
  });

  bot.command('toggle', async (ctx) => {
    const id = Number.parseInt(((ctx.match as string | undefined) || '').trim(), 10);
    if (!Number.isFinite(id) || id <= 0) {
      await replyInContext(ctx, '❌ Uso: <code>/toggle &lt;id&gt;</code>');
      return;
    }

    const [src] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, id), isNull(sources.deletedAt)))
      .limit(1);

    if (!src) {
      await replyInContext(ctx, `❌ Canal #${id} não encontrado.`);
      return;
    }

    const nextState = !src.isActive;
    await db.update(sources).set({ isActive: nextState }).where(eq(sources.id, id));

    await replyInContext(
      ctx,
      `${nextState ? '🟢' : '⏸️'} Canal <b>${escapeHtml(src.title)}</b> ${nextState ? 'ativado' : 'pausado'}.`
    );
  });

  bot.command('sync', async (ctx) => {
    const client = getGramClient();
    if (!client) {
      await replyInContext(
        ctx,
        '⚠️ Listener MTProto offline (<code>TELEGRAM_SESSION</code> não configurada).'
      );
      return;
    }

    const customFolder = ((ctx.match as string | undefined) || '').trim() || config.TELEGRAM_FOLDER_NAME;
    const result = await syncSourcesFromTelegram(client, db, customFolder);

    await replyInContext(
      ctx,
      `🔄 <b>Sync concluído</b>${customFolder ? ` (pasta: <code>${escapeHtml(customFolder)}</code>)` : ''}\n` +
        `• Total encontrados: <b>${result.total}</b>\n` +
        `• Novos: <b>${result.added}</b> | Atualizados: <b>${result.updated}</b>\n` +
        `• Ativos: <b>${result.activeCount}</b>`
    );
  });

  bot.command('status', async (ctx) => {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const [rules, srcs, processed, sent] = await Promise.all([
      db
        .select({ id: watchRules.id })
        .from(watchRules)
        .where(and(eq(watchRules.isActive, true), isNull(watchRules.deletedAt))),
      db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.isActive, true), isNull(sources.deletedAt))),
      db
        .select({ id: processedMessages.id })
        .from(processedMessages)
        .where(gte(processedMessages.createdAt, since24h)),
      db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.status, 'sent'), gte(notifications.createdAt, since24h))),
    ]);

    const uptimeMin = Math.floor(process.uptime() / 60);
    const gramOnline = getGramClient() !== null;

    await replyInContext(
      ctx,
      `📊 <b>Deal Sniper — Status</b>\n\n` +
        `⏱️ Uptime: <b>${uptimeMin} min</b>\n` +
        `📡 Listener MTProto: <b>${gramOnline ? '🟢 Online' : '🔴 Offline'}</b>\n` +
        `📌 Regras ativas: <b>${rules.length}</b>\n` +
        `📺 Canais ativos: <b>${srcs.length}</b>\n` +
        `⚙️ Ofertas matched (24h): <b>${processed.length}</b>\n` +
        `🔔 Alertas enviados (24h): <b>${sent.length}</b>\n` +
        `🛡️ Postura: <code>outbound-only · zero-ports · allowlist</code>`
    );
  });
}
