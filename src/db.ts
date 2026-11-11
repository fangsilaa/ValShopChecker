import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { decrypt, encrypt } from './crypto';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  discord_id        TEXT PRIMARY KEY,
  puuid             TEXT NOT NULL,
  riot_name         TEXT,
  region            TEXT NOT NULL,
  shard             TEXT NOT NULL,
  ssid_enc          TEXT,
  access_token_enc  TEXT,
  entitlements_enc  TEXT,
  token_expires_at  INTEGER NOT NULL DEFAULT 0,
  needs_login       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wishlist (
  discord_id      TEXT NOT NULL,
  skin_level_uuid TEXT NOT NULL,
  PRIMARY KEY (discord_id, skin_level_uuid)
);
CREATE TABLE IF NOT EXISTS shop_cache (
  discord_id TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

export interface UserRecord {
  discordId: string;
  puuid: string;
  riotName: string | null;
  region: string;
  shard: string;
  ssid: string | null;
  accessToken: string | null;
  entitlementsToken: string | null;
  tokenExpiresAt: number; // epoch ms
  needsLogin: boolean;
}

interface UserRow {
  discord_id: string;
  puuid: string;
  riot_name: string | null;
  region: string;
  shard: string;
  ssid_enc: string | null;
  access_token_enc: string | null;
  entitlements_enc: string | null;
  token_expires_at: number;
  needs_login: number;
}

const enc = (v: string | null) => (v ? encrypt(v) : null);
/** Returns null if missing or undecryptable (e.g. ENC_KEY changed) so the user is just asked to /login again. */
function dec(v: string | null): string | null {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

// ---- users ----

export function getUser(discordId: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId) as unknown as UserRow | undefined;
  if (!row) return null;
  return {
    discordId: row.discord_id,
    puuid: row.puuid,
    riotName: row.riot_name,
    region: row.region,
    shard: row.shard,
    ssid: dec(row.ssid_enc),
    accessToken: dec(row.access_token_enc),
    entitlementsToken: dec(row.entitlements_enc),
    tokenExpiresAt: row.token_expires_at,
    needsLogin: row.needs_login === 1,
  };
}

export function saveUser(u: UserRecord): void {
  db.prepare(
    `INSERT INTO users (discord_id, puuid, riot_name, region, shard, ssid_enc, access_token_enc, entitlements_enc, token_expires_at, needs_login)
     VALUES (@discordId, @puuid, @riotName, @region, @shard, @ssid, @accessToken, @entitlementsToken, @tokenExpiresAt, @needsLogin)
     ON CONFLICT(discord_id) DO UPDATE SET
       puuid = excluded.puuid, riot_name = excluded.riot_name, region = excluded.region, shard = excluded.shard,
       ssid_enc = excluded.ssid_enc, access_token_enc = excluded.access_token_enc, entitlements_enc = excluded.entitlements_enc,
       token_expires_at = excluded.token_expires_at, needs_login = excluded.needs_login`,
  ).run({
    ...u,
    ssid: enc(u.ssid),
    accessToken: enc(u.accessToken),
    entitlementsToken: enc(u.entitlementsToken),
    needsLogin: u.needsLogin ? 1 : 0,
  });
}

export function updateTokens(
  discordId: string,
  t: { accessToken: string; entitlementsToken: string; expiresAt: number; ssid: string | null },
): void {
  db.prepare(
    `UPDATE users SET access_token_enc = ?, entitlements_enc = ?, token_expires_at = ?, ssid_enc = ?, needs_login = 0
     WHERE discord_id = ?`,
  ).run(enc(t.accessToken), enc(t.entitlementsToken), t.expiresAt, enc(t.ssid), discordId);
}

/** Forces the next request to re-authenticate. */
export function expireTokens(discordId: string): void {
  db.prepare('UPDATE users SET token_expires_at = 0 WHERE discord_id = ?').run(discordId);
}

export function setNeedsLogin(discordId: string, value: boolean): void {
  db.prepare('UPDATE users SET needs_login = ? WHERE discord_id = ?').run(value ? 1 : 0, discordId);
}

/** Unlinks the Riot account. The wishlist is kept so re-linking restores it. */
export function deleteUser(discordId: string): void {
  db.prepare('DELETE FROM users WHERE discord_id = ?').run(discordId);
  clearCachedShop(discordId);
}

// ---- wishlist ----

export function getWishlist(discordId: string): string[] {
  const rows = db.prepare('SELECT skin_level_uuid FROM wishlist WHERE discord_id = ?').all(discordId) as unknown as {
    skin_level_uuid: string;
  }[];
  return rows.map((r) => r.skin_level_uuid);
}

/** Returns false if it was already on the wishlist. */
export function addWishlist(discordId: string, skinLevelUuid: string): boolean {
  const res = db
    .prepare('INSERT OR IGNORE INTO wishlist (discord_id, skin_level_uuid) VALUES (?, ?)')
    .run(discordId, skinLevelUuid.toLowerCase());
  return res.changes > 0;
}

export function removeWishlist(discordId: string, skinLevelUuid: string): boolean {
  const res = db
    .prepare('DELETE FROM wishlist WHERE discord_id = ? AND skin_level_uuid = ?')
    .run(discordId, skinLevelUuid.toLowerCase());
  return res.changes > 0;
}

/** Linked users that have at least one wishlist entry. */
export function usersWithWishlist(): string[] {
  const rows = db
    .prepare('SELECT DISTINCT w.discord_id FROM wishlist w JOIN users u ON u.discord_id = w.discord_id')
    .all() as unknown as { discord_id: string }[];
  return rows.map((r) => r.discord_id);
}

// ---- shop cache ----

export function getCachedShop<T>(discordId: string): T | null {
  const row = db
    .prepare('SELECT data FROM shop_cache WHERE discord_id = ? AND expires_at > ?')
    .get(discordId, Date.now()) as unknown as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function setCachedShop(discordId: string, data: unknown, expiresAt: number): void {
  db.prepare(
    `INSERT INTO shop_cache (discord_id, data, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
  ).run(discordId, JSON.stringify(data), expiresAt);
}

export function clearCachedShop(discordId: string): void {
  db.prepare('DELETE FROM shop_cache WHERE discord_id = ?').run(discordId);
}
