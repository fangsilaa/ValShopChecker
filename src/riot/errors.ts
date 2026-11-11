/** The user has to (re-)link their Riot account with /login. Message is shown to the user. */
export class NeedsLoginError extends Error {
  constructor(message = 'You need to link your Riot account first. Run `/login`.') {
    super(message);
    this.name = 'NeedsLoginError';
  }
}

/** Riot (or valorant-api.com) returned an unexpected error. */
export class RiotError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'RiotError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a single request may take before it is aborted. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** fetch with a per-request timeout that retries once on 5xx / network errors / timeouts. */
export async function riotFetch(url: string, init?: RequestInit, retries = 1): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.status >= 500 && attempt < retries) {
        await sleep(1000);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000);
        continue;
      }
      const host = new URL(url).host;
      if ((err as Error).name === 'TimeoutError') {
        throw new RiotError(`${host} took longer than ${REQUEST_TIMEOUT_MS / 1000}s to respond`);
      }
      throw new RiotError(`Network error contacting ${host}: ${String(err)}`);
    }
  }
}
