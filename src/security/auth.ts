import type { Context, NextFunction } from 'grammy';

/**
 * Creates a grammY middleware that authorizes commands strictly by user ID and optional chat ID.
 * Unauthorized requests are silently dropped so external attackers cannot probe the bot.
 */
export function createAuthMiddleware(
  allowedUserIds: string[],
  allowedChatId?: string
): (ctx: Context, next: NextFunction) => Promise<void> {
  const allowedSet = new Set(allowedUserIds);

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id?.toString();
    const chatId = ctx.chat?.id?.toString();

    const isUserAllowed = userId !== undefined && allowedSet.has(userId);
    const isChatAllowed =
      allowedChatId === undefined || (chatId !== undefined && chatId === allowedChatId);

    if (!isUserAllowed || !isChatAllowed) {
      if (ctx.chat?.type === 'private') {
        console.warn(`[auth] Blocked unauthorized private access attempt (user=${userId ?? 'unknown'})`);
      }
      return;
    }

    await next();
  };
}
