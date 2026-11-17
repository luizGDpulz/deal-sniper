import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TelegramClient, sessions } from 'telegram';

async function main(): Promise<void> {
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || '0', 10);
  const apiHash = (process.env.TELEGRAM_API_HASH || '').trim();

  if (!apiId || !apiHash) {
    console.error('Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env or environment.');
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  const client = new TelegramClient(new sessions.StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    console.log('\n🎯 Deal Sniper — Telegram Session Generator (MTProto Read-Only)\n');
    await client.start({
      phoneNumber: async () => (await rl.question('Phone number (e.g. +5511999999999): ')).trim(),
      password: async () => (await rl.question('2FA password (leave blank if none): ')).trim(),
      phoneCode: async () => (await rl.question('Login code received on Telegram/SMS: ')).trim(),
      onError: (err) => console.error('Auth error:', err.message),
    });

    const sessionString = client.session.save() as unknown as string;
    console.log('\n✅ Authentication succeeded!\n');
    console.log('Copy the value below into your .env as TELEGRAM_SESSION=<value>:\n');
    console.log(sessionString);
    console.log('\n⚠️ Keep TELEGRAM_SESSION secret. Never commit it to Git.\n');
  } finally {
    rl.close();
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error('Failed to generate Telegram session:', err);
  process.exit(1);
});
