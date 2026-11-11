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

let skins = new Map<string, SkinInfo>();
let tiers = new Map<string, TierInfo>();
let bundles = new Map<string, BundleInfo>();
let loadedAt = 0;
let loading: Promise<void> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const res = await riotFetch(`https://valorant-api.com/v1/${path}`);
  if (!res.ok) throw new RiotError(`valorant-api.com /${path} failed`, res.status);
  return ((await res.json()) as { data: T }).data;
}

async function refreshAssets(): Promise<void> {
  const [rawSkins, rawTiers, rawBundles] = await Promise.all([
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
  ]);

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
