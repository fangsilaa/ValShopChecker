import { getCompletedVctEventIds, getVctMaps, pruneVctBefore, saveVctEvent, type VctComp } from '../db';
import { RiotError, riotFetch } from '../riot/errors';

/**
 * Pro team compositions from VCT events, scraped from vlr.gg's per-event "agents" pages
 * (https://www.vlr.gg/event/agents/<id>/<slug>). Each map there has a matrix of teams x agents, and every
 * team row embeds a JSON list of the games it played: result, opponent, match link and a `picks` bitstring
 * aligned with the agent columns of that table.
 */

const BASE = 'https://www.vlr.gg';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; valshoptracker Discord bot)' };
/** Pause between page fetches so we stay polite to vlr.gg. */
const REQUEST_GAP_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VctEvent {
  id: number;
  slug: string;
  name: string;
  year: number;
  status: 'completed' | 'ongoing' | 'upcoming';
}

async function fetchHtml(path: string): Promise<string> {
  const res = await riotFetch(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new RiotError(`vlr.gg ${path} failed`, res.status);
  return res.text();
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** VCT events of one year from https://www.vlr.gg/vct-<year>. */
export async function listVctEvents(year: number): Promise<VctEvent[]> {
  const html = await fetchHtml(`/vct-${year}`);
  const events: VctEvent[] = [];
  const cards = html.split(/<a class="[^"]*\bevent-item\b[^"]*"/).slice(1);
  for (const card of cards) {
    const link = card.match(/href="\/event\/(\d+)\/([^"]+)"/);
    const title = card.match(/class="event-item-title">([\s\S]*?)<\/div>/);
    if (!link || !title) continue;
    const status = card.match(/event-item-desc-item-status mod-(completed|ongoing|upcoming)/)?.[1] ?? 'ongoing';
    events.push({
      id: Number(link[1]),
      slug: link[2],
      name: decodeEntities(title[1]),
      year,
      status: status as VctEvent['status'],
    });
  }
  return events;
}

interface RawGame {
  result: string;
  link: string;
  opp_name: string;
  picks: string;
}

/** Parses an event's agents page into one comp per (game, team). */
export function parseEventAgents(html: string, event: Pick<VctEvent, 'id' | 'name'>): VctComp[] {
  const comps: VctComp[] = [];
  const blocks = html.split(/class="pr-matrix-map\b/).slice(1);
  for (const block of blocks) {
    const map = block.match(/class="map-pseudo-icon">[^<]*<\/span>\s*([^<]+?)\s*<\/th>/)?.[1];
    if (!map) continue;

    // Agent columns come from the header row (before the first team row); order differs as agents get added.
    const [header, ...rows] = block.split(/<tr class="pr-matrix-row/);
    const agents = [...header.matchAll(/<img src="\/img\/vlr\/game\/agents\/[^"]+"[^>]*title="([^"]+)"/g)].map((m) =>
      decodeEntities(m[1]),
    );
    if (agents.length === 0) continue;

    for (const row of rows) {
      const team = row.match(/<span class="text-of"[^>]*>([\s\S]*?)<\/span>/)?.[1];
      const json = row.match(/<script type="application\/json">([\s\S]*?)<\/script>/)?.[1];
      if (!team || !json) continue;
      let games: RawGame[];
      try {
        games = JSON.parse(json) as RawGame[];
      } catch {
        continue;
      }
      for (const g of games) {
        const gameId = Number(g.link?.match(/[?&]game=(\d+)/)?.[1]);
        const picked = [...(g.picks ?? '')].flatMap((bit, i) => (bit === '1' && agents[i] ? [agents[i]] : []));
        if (!gameId || picked.length !== 5) continue;
        comps.push({
          gameId,
          team: decodeEntities(team),
          map: decodeEntities(map),
          agents: picked.sort().join(', '),
          opponent: decodeEntities(g.opp_name ?? 'Unknown'),
          result: g.result === 'win' ? 'win' : 'loss',
          matchUrl: `${BASE}${g.link}`,
          eventId: event.id,
          eventName: event.name,
        });
      }
    }
  }
  return comps;
}

/** The years we keep comps for: this year and last year. */
export function vctYears(now = new Date()): number[] {
  const y = now.getUTCFullYear();
  return [y - 1, y];
}

let refreshing: Promise<void> | null = null;

export const isRefreshingVct = () => refreshing !== null;
export const hasVctData = () => getVctMaps().length > 0;

async function doRefresh(): Promise<void> {
  const years = vctYears();
  pruneVctBefore(years[0]);
  const done = getCompletedVctEventIds();

  const events: VctEvent[] = [];
  for (const year of years) {
    try {
      events.push(...(await listVctEvents(year)));
    } catch (err) {
      console.warn(`Couldn't list VCT ${year} events:`, (err as Error).message);
    }
    await sleep(REQUEST_GAP_MS);
  }

  let scraped = 0;
  let total = 0;
  for (const event of events) {
    if (event.status === 'upcoming' || done.has(event.id)) continue;
    try {
      const comps = parseEventAgents(await fetchHtml(`/event/agents/${event.id}/${event.slug}`), event);
      // An empty result for a finished event likely means the markup changed: don't mark it done, retry next run.
      const completed = event.status === 'completed' && comps.length > 0;
      if (comps.length === 0) console.warn(`No VCT comps parsed for ${event.name} (${event.id})`);
      saveVctEvent({ id: event.id, name: event.name, year: event.year, completed }, comps);
      scraped++;
      total += comps.length;
    } catch (err) {
      console.warn(`Couldn't scrape VCT comps for ${event.name}:`, (err as Error).message);
    }
    await sleep(REQUEST_GAP_MS);
  }
  console.log(`Loaded ${total} VCT comps from ${scraped} vlr.gg events (${done.size} already stored)`);
}

/** Fetches new/ongoing VCT events from vlr.gg into the DB. Only one refresh runs at a time. */
export function refreshVctComps(): Promise<void> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
