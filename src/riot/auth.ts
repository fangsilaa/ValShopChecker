import { config } from '../config';
import { NeedsLoginError, RiotError, riotFetch } from './errors';

/** Riot's implicit-grant login used by playvalorant.com. After logging in, the browser is redirected to a URL with the tokens in the #fragment. */
export const AUTH_URL =
  'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid';

const USER_AGENT = 'RiotClient/63.0.9.4909983.4789131 rso-auth (Windows;10;;Professional, x64)';

export interface Tokens {
  accessToken: string;
  idToken: string | null;
  expiresAt: number; // epoch ms
  ssid: string | null;
}

/** Extracts tokens from a redirect URL like https://playvalorant.com/opt_in#access_token=...&id_token=...&expires_in=3600 */
export function parseTokenUrl(url: string): Tokens | null {
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return null;
  const params = new URLSearchParams(url.slice(hashIdx + 1));
  const accessToken = params.get('access_token');
  if (!accessToken) return null;
  const expiresIn = Number(params.get('expires_in') ?? 3600);
  return {
    accessToken,
    idToken: params.get('id_token'),
    expiresAt: Date.now() + expiresIn * 1000,
    ssid: null,
  };
}

/** Uses the long-lived `ssid` cookie to silently get a fresh access token (no password / captcha needed). */
export async function reauthWithCookie(ssid: string): Promise<Tokens> {
  const res = await riotFetch(AUTH_URL, {
    headers: { Cookie: `ssid=${ssid}`, 'User-Agent': USER_AGENT },
    redirect: 'manual',
  });
  const location = res.headers.get('location') ?? '';
  const tokens = parseTokenUrl(location);
  if (!tokens) {
    if (res.status === 403) {
      throw new RiotError('Riot blocked the re-auth request (403). See README troubleshooting.', 403);
    }
    throw new NeedsLoginError('Your Riot session has expired. Run `/login` again.');
  }
  // Riot sometimes rotates the cookie; keep the newest one.
  const rotated = res.headers
    .getSetCookie()
    .map((c) => /^ssid=([^;]+)/.exec(c)?.[1])
    .find((v): v is string => !!v);
  return { ...tokens, ssid: rotated ?? ssid };
}

export async function getEntitlementsToken(accessToken: string): Promise<string> {
  const res = await riotFetch('https://entitlements.auth.riotgames.com/api/token/v1', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (res.status === 401 || res.status === 403) throw new NeedsLoginError('Riot rejected your login. Run `/login` again.');
  if (!res.ok) throw new RiotError('Entitlements request failed', res.status);
  const json = (await res.json()) as { entitlements_token: string };
  return json.entitlements_token;
}

export async function getUserInfo(accessToken: string): Promise<{ puuid: string; riotName: string | null }> {
  const res = await riotFetch('https://auth.riotgames.com/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) throw new NeedsLoginError('Riot rejected your login. Run `/login` again.');
  if (!res.ok) throw new RiotError('Userinfo request failed', res.status);
  const json = (await res.json()) as { sub: string; acct?: { game_name?: string; tag_line?: string } };
  const name = json.acct?.game_name ? `${json.acct.game_name}#${json.acct.tag_line ?? ''}` : null;
  return { puuid: json.sub, riotName: name };
}

/** Returns the Valorant region (na, eu, ap, kr, latam, br). Needs the id_token. */
export async function getRegion(accessToken: string, idToken: string): Promise<string> {
  const res = await riotFetch('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) throw new RiotError('Region lookup failed', res.status);
  const json = (await res.json()) as { affinities?: { live?: string } };
  if (!json.affinities?.live) throw new RiotError('Region lookup returned no region');
  return json.affinities.live;
}

const SHARDS: Record<string, string> = { na: 'na', latam: 'na', br: 'na', eu: 'eu', ap: 'ap', kr: 'kr' };
export const VALID_REGIONS = Object.keys(SHARDS);
export function regionToShard(region: string): string {
  return SHARDS[region] ?? region;
}

export interface LinkedAccount {
  tokens: Tokens;
  entitlementsToken: string;
  puuid: string;
  riotName: string | null;
  region: string;
  shard: string;
}

/**
 * Accepts whatever the user pasted: either the full redirect URL (contains access_token, valid ~1h)
 * or their `ssid` cookie (lets the bot refresh tokens itself for weeks).
 */
export async function linkAccount(raw: string): Promise<LinkedAccount> {
  const input = raw.trim();
  let tokens: Tokens;
  if (input.includes('access_token=')) {
    const parsed = parseTokenUrl(input);
    if (!parsed) throw new Error("Couldn't find an access token in that URL. Copy the whole address bar.");
    tokens = parsed;
  } else {
    const ssid = input
      .replace(/^ssid=/i, '')
      .replace(/;.*$/s, '')
      .trim();
    if (!ssid) throw new Error('That was empty. Paste the redirect URL or your ssid cookie.');
    tokens = await reauthWithCookie(ssid);
  }

  const entitlementsToken = await getEntitlementsToken(tokens.accessToken);
  const { puuid, riotName } = await getUserInfo(tokens.accessToken);

  let region = config.defaultRegion;
  if (tokens.idToken) {
    try {
      region = await getRegion(tokens.accessToken, tokens.idToken);
    } catch (err) {
      console.warn('Region auto-detect failed, using DEFAULT_REGION:', (err as Error).message);
    }
  }

  return { tokens, entitlementsToken, puuid, riotName, region, shard: regionToShard(region) };
}
