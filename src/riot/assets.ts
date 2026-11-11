import { RiotError, riotFetch } from './errors';

/** Skin names / icons / tiers from the community API https://valorant-api.com (no auth needed). */

export interface SkinInfo {
  levelUuid: string; // what the store returns
  name: string;
  icon: string | null;
  tierUuid: string | null;
}
export interface TierInfo {
  name: string;
  color: number;
  icon: string | null;
}
export interface BundleInfo {
  name: string;
  icon: string | null;
}

export interface RankTierInfo {
  name: string; // e.g. "Gold 2"
  color: number;
  icon: string | null;
}
export interface ActInfo {
  uuid: string;
  name: string; // e.g. "Episode 9 · Act III"
  start: number;
  end: number;
}

let skins = new Map<string, SkinInfo>();
let tiers = new Map<string, TierInfo>();
let bundles = new Map<string, BundleInfo>();
let rankTiers = new Map<number, RankTierInfo>();
let acts: ActInfo[] = [];
let maps = new Map<string, string>(); // map path ("/Game/Maps/Ascent/Ascent") -> display name
let loadedAt = 0;
let loading: Promise<void> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const res = await riotFetch(`https://valorant-api.com/v1/${path}`);
  if (!res.ok) throw new RiotError(`valorant-api.com /${path} failed`, res.status);
  return ((await res.json()) as { data: T }).data;
}

async function refreshAssets(): Promise<void> {
  const [rawSkins, rawTiers, rawBundles, rawRankTables, rawSeasons, rawMaps] = await Promise.all([
    getJson<
      {
        displayName: string;
        displayIcon: string | null;
        contentTierUuid: string | null;
        levels: { uuid: string; displayIcon: string | null }[];
        chromas: { fullRender: string | null }[];
      }[]
    >('weapons/skins'),
    getJson<{ uuid: string; devName: string; highlightColor: string; displayIcon: string | null }[]>('contenttiers'),
    getJson<{ uuid: string; displayName: string; displayIcon: string | null }[]>('bundles'),
    getJson<{ tiers: { tier: number; tierName: string; color: string | null; largeIcon: string | null }[] }[]>(
      'competitivetiers',
    ),
    getJson<
      { uuid: string; displayName: string; type: string | null; startTime: string; endTime: string; parentUuid: string | null }[]
    >('seasons'),
    getJson<{ displayName: string; mapUrl: string | null }[]>('maps'),
  ]);

  // Rank tiers: the last table is the current ranking system.
  const nextRankTiers = new Map<number, RankTierInfo>();
  for (const t of rawRankTables.at(-1)?.tiers ?? []) {
    nextRankTiers.set(t.tier, {
      name: titleCase(t.tierName),
      color: t.color ? parseInt(t.color.slice(0, 6), 16) : 0x2b2d31,
      icon: t.largeIcon,
    });
  }

  // Acts, named "Episode X · Act Y" using their parent episode.
  const seasonById = new Map(rawSeasons.map((s) => [s.uuid.toLowerCase(), s]));
  const nextActs: ActInfo[] = rawSeasons
    .filter((s) => s.type === 'EAresSeasonType::Act')
    .map((s) => {
      const parent = s.parentUuid ? seasonById.get(s.parentUuid.toLowerCase()) : undefined;
      return {
        uuid: s.uuid.toLowerCase(),
        name: [parent?.displayName, s.displayName].filter(Boolean).map((n) => titleCase(n!)).join(' · '),
        start: Date.parse(s.startTime),
        end: Date.parse(s.endTime),
      };
    });

  const nextMaps = new Map<string, string>();
  for (const m of rawMaps) if (m.mapUrl) nextMaps.set(m.mapUrl.toLowerCase(), m.displayName);

  const nextSkins = new Map<string, SkinInfo>();
  for (const s of rawSkins) {
    const level = s.levels[0];
    if (!level) continue;
    nextSkins.set(level.uuid.toLowerCase(), {
      levelUuid: level.uuid.toLowerCase(),
      name: s.displayName,
      icon: level.displayIcon ?? s.displayIcon ?? s.chromas[0]?.fullRender ?? null,
      tierUuid: s.contentTierUuid?.toLowerCase() ?? null,
    });
  }

  const nextTiers = new Map<string, TierInfo>();
  for (const t of rawTiers) {
    nextTiers.set(t.uuid.toLowerCase(), {
      name: t.devName,
      color: parseInt(t.highlightColor.slice(0, 6), 16),
      icon: t.displayIcon,
    });
  }

  const nextBundles = new Map<string, BundleInfo>();
  for (const b of rawBundles) nextBundles.set(b.uuid.toLowerCase(), { name: b.displayName, icon: b.displayIcon });

  skins = nextSkins;
  tiers = nextTiers;
  bundles = nextBundles;
  rankTiers = nextRankTiers;
  acts = nextActs;
  maps = nextMaps;
  loadedAt = Date.now();
  console.log(`Loaded ${skins.size} skins, ${tiers.size} tiers, ${bundles.size} bundles from valorant-api.com`);
}

/** Loads/refreshes the catalog if it is older than 24h. Safe to call often. */
export async function ensureAssets(): Promise<void> {
  if (Date.now() - loadedAt < 24 * 60 * 60_000) return;
  loading ??= refreshAssets().finally(() => {
    loading = null;
  });
  try {
    await loading;
  } catch (err) {
    // If we already have an older catalog, keep using it.
    if (skins.size === 0) throw err;
    console.warn('Asset refresh failed, using stale catalog:', (err as Error).message);
  }
}

export const getSkin = (levelUuid: string) => skins.get(levelUuid.toLowerCase());
export const getTier = (uuid: string) => tiers.get(uuid.toLowerCase());
export const getBundle = (uuid: string) => bundles.get(uuid.toLowerCase());
export const getRankTier = (tier: number) => rankTiers.get(tier);
export const getAct = (uuid: string) => acts.find((a) => a.uuid === uuid.toLowerCase());
export const getCurrentAct = () => acts.find((a) => a.start <= Date.now() && Date.now() < a.end);
export const getMapName = (mapPath: string) => maps.get(mapPath.toLowerCase());

/** "GOLD 2" -> "Gold 2", "ACT III" -> "Act III" (keeps roman numerals). */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (/^[ivx]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** For wishlist autocomplete. Only buyable skins (those with a tier). */
export function searchSkins(query: string, limit = 25): SkinInfo[] {
  const q = query.trim().toLowerCase();
  const out: SkinInfo[] = [];
  for (const s of skins.values()) {
    if (!s.tierUuid) continue;
    if (!q || s.name.toLowerCase().includes(q)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
