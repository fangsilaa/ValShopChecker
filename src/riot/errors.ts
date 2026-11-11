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

/** fetch that retries once on 5xx / network errors. */
export async function riotFetch(url: string, init?: RequestInit, retries = 1): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < retries) {
        await sleep(1000);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw new RiotError(`Network error contacting ${new URL(url).host}: ${String(err)}`);
      await sleep(1000);
    }
  }
}
