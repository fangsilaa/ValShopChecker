import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { decrypt, encrypt } from './crypto';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');

/** Max Riot accounts one Discord user can link. */
export const MAX_ACCOUNTS = 5;

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  discord_id        TEXT NOT NULL,
  puuid             TEXT NOT NULL,
  riot_name         TEXT,
  region            TEXT NOT NULL,
  shard             TEXT NOT NULL,
  ssid_enc          TEXT,
  access_token_enc  TEXT,
  entitlements_enc  TEXT,
  token_expires_at  INTEGER NOT NULL DEFAULT 0,
  needs_login       INTEGER NOT NULL DEFAULT 0,
  is_default        INTEGER NOT NULL DEFAULT 0,
  linked_at         INTEGER NOT NULL,
  PRIMARY KEY (discord_id, puuid)
);
CREATE TABLE IF NOT EXISTS wishlist (
  discord_id      TEXT NOT NULL,
  skin_level_uuid TEXT NOT NULL,
  PRIMARY KEY (discord_id, skin_level_uuid)
);
CREATE TABLE IF NOT EXISTS account_shop_cache (
  puuid      TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

// ---- one-time migration from the single-account schema (users + shop_cache) ----
{
  const hasOldUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (hasOldUsers) {
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT OR IGNORE INTO accounts (discord_id, puuid, riot_name, region, shard, ssid_enc, access_token_enc,
           entitlements_enc, token_expires_at, needs_login, is_default, linked_at)
         SELECT discord_id, puuid, riot_name, region, shard, ssid_enc, access_token_enc,
           entitlements_enc, token_expires_at, needs_login, 1, ?
         FROM users`,
      ).run(Date.now());
      db.exec('DROP TABLE users');
      db.exec('DROP TABLE IF EXISTS shop_cache');
      db.exec('COMMIT');
      console.log('Migrated linked users to the multi-account schema');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Identifies one linked Riot account. */
export interface AccountRef {
  discordId: string;
  puuid: string;
}

export interface Account extends AccountRef {
  riotName: string | null;
  region: string;
  shard: string;
  ssid: string | null;
  accessToken: string | null;
  entitlementsToken: string | null;
  tokenExpiresAt: number; // epoch ms
  needsLogin: boolean;
  isDefault: boolean;
}

interface AccountRow {
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
  is_default: number;
  linked_at: number;
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

function toAccount(row: AccountRow): Account {
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
    isDefault: row.is_default === 1,
  };
}

/** Display name for an account: Riot ID if known, otherwise a short puuid. */
export const accountLabel = (a: Pick<Account, 'riotName' | 'puuid'>) => a.riotName ?? `Account ${a.puuid.slice(0, 8)}`;

// ---- accounts ----

/** All accounts of a Discord user, default first, then in the order they were linked. */
export function getAccounts(discordId: string): Account[] {
  const rows = db
    .prepare('SELECT * FROM accounts WHERE discord_id = ? ORDER BY is_default DESC, linked_at ASC')
    .all(discordId) as unknown as AccountRow[];
  return rows.map(toAccount);
}

export function getAccount(ref: AccountRef): Account | null {
  const row = db
    .prepare('SELECT * FROM accounts WHERE discord_id = ? AND puuid = ?')
    .get(ref.discordId, ref.puuid) as unknown as AccountRow | undefined;
  return row ? toAccount(row) : null;
}

export function getDefaultAccount(discordId: string): Account | null {
  return getAccounts(discordId)[0] ?? null;
}

/**
 * Inserts or refreshes a linked account. The first account a user links becomes their default;
 * re-linking an existing account keeps its default flag. Returns whether it was newly added.
 */
export function saveAccount(a: Omit<Account, 'isDefault'>): { isNew: boolean; isDefault: boolean } {
  const existing = getAccount(a);
  const hasDefault = getAccounts(a.discordId).some((x) => x.isDefault);
  const isDefault = existing?.isDefault ?? !hasDefault;
  db.prepare(
    `INSERT INTO accounts (discord_id, puuid, riot_name, region, shard, ssid_enc, access_token_enc, entitlements_enc,
       token_expires_at, needs_login, is_default, linked_at)
     VALUES (@discordId, @puuid, @riotName, @region, @shard, @ssid, @accessToken, @entitlementsToken,
       @tokenExpiresAt, @needsLogin, @isDefault, @linkedAt)
     ON CONFLICT(discord_id, puuid) DO UPDATE SET
       riot_name = excluded.riot_name, region = excluded.region, shard = excluded.shard,
       ssid_enc = excluded.ssid_enc, access_token_enc = excluded.access_token_enc, entitlements_enc = excluded.entitlements_enc,
       token_expires_at = excluded.token_expires_at, needs_login = excluded.needs_login`,
  ).run({
    discordId: a.discordId,
    puuid: a.puuid,
    riotName: a.riotName,
    region: a.region,
    shard: a.shard,
    ssid: enc(a.ssid),
    accessToken: enc(a.accessToken),
    entitlementsToken: enc(a.entitlementsToken),
    tokenExpiresAt: a.tokenExpiresAt,
    needsLogin: a.needsLogin ? 1 : 0,
    isDefault: isDefault ? 1 : 0,
    linkedAt: Date.now(),
  });
  return { isNew: !existing, isDefault };
}

export function updateTokens(
  ref: AccountRef,
  t: { accessToken: string; entitlementsToken: string; expiresAt: number; ssid: string | null },
): void {
  db.prepare(
    `UPDATE accounts SET access_token_enc = ?, entitlements_enc = ?, token_expires_at = ?, ssid_enc = ?, needs_login = 0
     WHERE discord_id = ? AND puuid = ?`,
  ).run(enc(t.accessToken), enc(t.entitlementsToken), t.expiresAt, enc(t.ssid), ref.discordId, ref.puuid);
}

/** Forces the next request to re-authenticate. */
export function expireTokens(ref: AccountRef): void {
  db.prepare('UPDATE accounts SET token_expires_at = 0 WHERE discord_id = ? AND puuid = ?').run(ref.discordId, ref.puuid);
}

export function setNeedsLogin(ref: AccountRef, value: boolean): void {
  db.prepare('UPDATE accounts SET needs_login = ? WHERE discord_id = ? AND puuid = ?').run(
    value ? 1 : 0,
    ref.discordId,
    ref.puuid,
  );
}

export function setDefaultAccount(ref: AccountRef): void {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE accounts SET is_default = 0 WHERE discord_id = ?').run(ref.discordId);
    db.prepare('UPDATE accounts SET is_default = 1 WHERE discord_id = ? AND puuid = ?').run(ref.discordId, ref.puuid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Unlinks one account (deleting its tokens). If it was the default, the oldest remaining account becomes default. */
export function deleteAccount(ref: AccountRef): boolean {
  const res = db.prepare('DELETE FROM accounts WHERE discord_id = ? AND puuid = ?').run(ref.discordId, ref.puuid);
  clearCachedShop(ref.puuid);
  const remaining = getAccounts(ref.discordId);
  if (remaining.length && !remaining.some((a) => a.isDefault)) setDefaultAccount(remaining[0]);
  return res.changes > 0;
}

// ---- wishlist (per Discord user, shared by all their accounts) ----

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

/** Discord users that have at least one wishlist entry and at least one linked account. */
export function usersWithWishlist(): string[] {
  const rows = db
    .prepare('SELECT DISTINCT w.discord_id FROM wishlist w JOIN accounts a ON a.discord_id = w.discord_id')
    .all() as unknown as { discord_id: string }[];
  return rows.map((r) => r.discord_id);
}

// ---- shop cache (per Riot account) ----

export function getCachedShop<T>(puuid: string): T | null {
  const row = db
    .prepare('SELECT data FROM account_shop_cache WHERE puuid = ? AND expires_at > ?')
    .get(puuid, Date.now()) as unknown as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function setCachedShop(puuid: string, data: unknown, expiresAt: number): void {
  db.prepare(
    `INSERT INTO account_shop_cache (puuid, data, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(puuid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
  ).run(puuid, JSON.stringify(data), expiresAt);
}

export function clearCachedShop(puuid: string): void {
  db.prepare('DELETE FROM account_shop_cache WHERE puuid = ?').run(puuid);
}
