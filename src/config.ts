import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

const encKey = Buffer.from(required('ENC_KEY'), 'hex');
if (encKey.length !== 32) {
  throw new Error('ENC_KEY must be 64 hex characters (32 bytes). Generate one with: npm run gen-key');
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  encKey,
  alertChannelId: process.env.ALERT_CHANNEL_ID || null,
  defaultRegion: process.env.DEFAULT_REGION || 'na',
  dbPath: process.env.DB_PATH || 'data/bot.sqlite',
};
