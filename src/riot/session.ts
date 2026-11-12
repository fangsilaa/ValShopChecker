import { accountLabel, getAccount, setNeedsLogin, updateTokens, type AccountRef } from '../db';
import { getEntitlementsToken, reauthWithCookie } from './auth';
import { NeedsLoginError } from './errors';

export interface Session {
  puuid: string;
  shard: string;
  accessToken: string;
  entitlementsToken: string;
}

/** Returns valid tokens for one linked account, refreshing via its ssid cookie when needed. */
export async function getSession(ref: AccountRef): Promise<Session> {
  const acct = getAccount(ref);
  if (!acct) throw new NeedsLoginError();

  if (acct.accessToken && acct.entitlementsToken && acct.tokenExpiresAt > Date.now() + 60_000) {
    return {
      puuid: acct.puuid,
      shard: acct.shard,
      accessToken: acct.accessToken,
      entitlementsToken: acct.entitlementsToken,
    };
  }

  const name = accountLabel(acct);
  if (!acct.ssid) {
    setNeedsLogin(ref, true);
    throw new NeedsLoginError(
      `The Riot login for **${name}** expired. Run \`/login\` again with that account. Tip: paste your \`ssid\` cookie instead of the URL so it lasts for weeks.`,
    );
  }

  let tokens;
  try {
    tokens = await reauthWithCookie(acct.ssid);
  } catch (err) {
    if (err instanceof NeedsLoginError) {
      setNeedsLogin(ref, true);
      throw new NeedsLoginError(`The Riot session for **${name}** has expired. Run \`/login\` again with that account.`);
    }
    throw err;
  }
  const entitlementsToken = await getEntitlementsToken(tokens.accessToken);
  updateTokens(ref, {
    accessToken: tokens.accessToken,
    entitlementsToken,
    expiresAt: tokens.expiresAt,
    ssid: tokens.ssid,
  });

  return { puuid: acct.puuid, shard: acct.shard, accessToken: tokens.accessToken, entitlementsToken };
}
