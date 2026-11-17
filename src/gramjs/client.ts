import { Api, TelegramClient, sessions, utils } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';

export interface IncomingChannelMessage {
  tgChatId: string;
  chatTitle: string;
  messageId: number;
  text: string;
  date: Date;
  urls: string[];
}

export interface GramJsListener {
  client: TelegramClient;
  disconnect: () => Promise<void>;
}

const URL_REGEX = /https?:\/\/[^\s<>()]+/gi;

function extractUrls(text: string, entities?: Api.TypeMessageEntity[]): string[] {
  const urls = new Set<string>();

  if (entities) {
    for (const entity of entities) {
      if (entity instanceof Api.MessageEntityTextUrl && entity.url) {
        urls.add(entity.url);
      } else if (entity instanceof Api.MessageEntityUrl) {
        const raw = text.slice(entity.offset, entity.offset + entity.length);
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
          urls.add(raw);
        }
      }
    }
  }

  for (const match of text.match(URL_REGEX) ?? []) {
    urls.add(match.replace(/[.,;!?]+$/, ''));
  }

  return Array.from(urls);
}

/**
 * Starts a strictly READ-ONLY MTProto listener via GramJS.
 * Never calls sendMessage, joinChannel, or any write API.
 */
export async function createGramJsListener(params: {
  apiId: number;
  apiHash: string;
  sessionString: string;
  onMessage: (msg: IncomingChannelMessage) => Promise<void>;
}): Promise<GramJsListener> {
  const client = new TelegramClient(
    new sessions.StringSession(params.sessionString),
    params.apiId,
    params.apiHash,
    {
      connectionRetries: 5,
      autoReconnect: true,
    }
  );

  await client.connect();

  const authorized = await client.checkAuthorization();
  if (!authorized) {
    await client.disconnect();
    throw new Error(
      'Telegram MTProto session is not authorized. Run `pnpm run auth` to generate TELEGRAM_SESSION.'
    );
  }

  client.addEventHandler(
    async (event: NewMessageEvent) => {
      if (!event.isChannel && !event.isGroup) {
        return;
      }

      const message = event.message;
      const text = message.message || '';
      if (!text.trim()) {
        return;
      }

      const chat = (await message.getChat()) as Api.TypeChat | undefined;
      const tgChatId = message.chatId
        ? message.chatId.toString()
        : chat
          ? utils.getPeerId(chat)
          : null;

      if (!tgChatId) {
        return;
      }

      const chatTitle = chat && 'title' in chat && typeof chat.title === 'string' ? chat.title : tgChatId;
      const urls = extractUrls(text, message.entities);

      await params.onMessage({
        tgChatId,
        chatTitle,
        messageId: message.id,
        text,
        date: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000),
        urls,
      });
    },
    new NewMessage({})
  );

  return {
    client,
    disconnect: async () => {
      await client.disconnect();
    },
  };
}
