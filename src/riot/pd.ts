import { expireTokens, type AccountRef } from '../db';
import { NeedsLoginError, RiotError, riotFetch } from './errors';
import { getSession, type Session } from './session';

/** Shared helper for authenticated calls to Riot's player-data API (pd.{shard}.a.pvp.net). */

const CLIENT_PLATFORM = Buffer.from(
  JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  }),
).toString('base64');

let versionCache: { value: string; at: number } | null = null;
async function getClientVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < 60 * 60_000) return versionCache.value;
  const res = await riotFetch('https://valorant-api.com/v1/version');
  if (!res.ok) throw new RiotError('Could not get Valorant client version from valorant-api.com', res.status);
  const json = (await res.json()) as { data: { riotClientVersion: string } };
  versionCache = { value: json.data.riotClientVersion, at: Date.now() };
  return versionCache.value;
}

/**
 * Calls `https://pd.{shard}.a.pvp.net{path}` as the given linked Riot account.
 * On an expired/invalid token (400 BAD_CLAIMS or 401) it refreshes once via the ssid cookie and retries.
 */
export async function pdRequest<T>(
  account: AccountRef,
  path: (s: Session) => string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; what?: string } = {},
): Promise<T> {
  const clientVersion = await getClientVersion();
  const what = opts.what ?? 'Riot request';

  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(account);
    const res = await riotFetch(`https://pd.${s.shard}.a.pvp.net${path(s)}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${s.accessToken}`,
        'X-Riot-Entitlements-JWT': s.entitlementsToken,
        'X-Riot-ClientVersion': clientVersion,
        'X-Riot-ClientPlatform': CLIENT_PLATFORM,
        'Content-Type': 'application/json',
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (res.status === 400 || res.status === 401) {
      expireTokens(account);
      if (attempt === 0) continue;
      throw new NeedsLoginError('Riot rejected your login. Run `/login` again.');
    }
    if (!res.ok) throw new RiotError(`${what} failed`, res.status);
    return (await res.json()) as T;
  }
  throw new RiotError(`${what} failed after retry`);
}
