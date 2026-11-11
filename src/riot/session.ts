import { getUser, setNeedsLogin, updateTokens } from '../db';
import { getEntitlementsToken, reauthWithCookie } from './auth';
import { NeedsLoginError } from './errors';

export interface Session {
  puuid: string;
  shard: string;
  accessToken: string;
  entitlementsToken: string;
}

/** Returns valid tokens for a user, refreshing via the ssid cookie when needed. */
export async function getSession(discordId: string): Promise<Session> {
  const user = getUser(discordId);
  if (!user) throw new NeedsLoginError();

  if (user.accessToken && user.entitlementsToken && user.tokenExpiresAt > Date.now() + 60_000) {
    return {
      puuid: user.puuid,
      shard: user.shard,
      accessToken: user.accessToken,
      entitlementsToken: user.entitlementsToken,
    };
  }

  if (!user.ssid) {
    setNeedsLogin(discordId, true);
    throw new NeedsLoginError(
      'Your Riot login expired. Run `/login` again. Tip: paste your `ssid` cookie instead of the URL so it lasts for weeks.',
    );
  }

  let tokens;
  try {
    tokens = await reauthWithCookie(user.ssid);
  } catch (err) {
    if (err instanceof NeedsLoginError) setNeedsLogin(discordId, true);
    throw err;
  }
  const entitlementsToken = await getEntitlementsToken(tokens.accessToken);
  updateTokens(discordId, {
    accessToken: tokens.accessToken,
    entitlementsToken,
    expiresAt: tokens.expiresAt,
    ssid: tokens.ssid,
  });

  return { puuid: user.puuid, shard: user.shard, accessToken: tokens.accessToken, entitlementsToken };
}
