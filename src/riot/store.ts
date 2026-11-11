import { expireTokens, getCachedShop, setCachedShop } from '../db';
import { NeedsLoginError, RiotError, riotFetch } from './errors';
import { getSession } from './session';

const VP = '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741';

const CLIENT_PLATFORM = Buffer.from(
  JSON.stringify({
    platformType: 'PC',
    platformOS: 'Windows',
    platformOSVersion: '10.0.19042.1.256.64bit',
    platformChipset: 'Unknown',
  }),
).toString('base64');

// ---- public shapes ----

export interface ShopItem {
  uuid: string; // skin level uuid
  cost: number;
}
export interface NightMarketItem {
  uuid: string;
  baseCost: number;
  discountedCost: number;
  discountPercent: number;
}
export interface BundleOffer {
  uuid: string; // bundle asset uuid (valorant-api.com)
  baseCost: number;
  discountedCost: number;
  expiresAt: number;
}
export interface Shop {
  fetchedAt: number;
  daily: ShopItem[];
  dailyExpiresAt: number;
  bundles: BundleOffer[];
  nightMarket: NightMarketItem[] | null;
  nightMarketExpiresAt: number | null;
}

// ---- raw Riot response (only the fields we use) ----

interface RawOffer {
  OfferID: string;
  Cost: Record<string, number>;
  Rewards?: { ItemTypeID: string; ItemID: string }[];
}
interface RawBundle {
  DataAssetID: string;
  Items: { BasePrice: number; DiscountedPrice: number; CurrencyID: string }[];
  DurationRemainingInSeconds: number;
  TotalBaseCost?: Record<string, number> | null;
  TotalDiscountedCost?: Record<string, number> | null;
}
interface RawStorefront {
  FeaturedBundle?: { Bundle?: RawBundle; Bundles?: RawBundle[] };
  SkinsPanelLayout: {
    SingleItemOffers: string[];
    SingleItemStoreOffers?: RawOffer[];
    SingleItemOffersRemainingDurationInSeconds: number;
  };
  BonusStore?: {
    BonusStoreOffers: { Offer: RawOffer; DiscountPercent: number; DiscountCosts: Record<string, number> }[];
    BonusStoreRemainingDurationInSeconds: number;
  };
}

// ---- client version ----

let versionCache: { value: string; at: number } | null = null;
async function getClientVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < 60 * 60_000) return versionCache.value;
  const res = await riotFetch('https://valorant-api.com/v1/version');
  if (!res.ok) throw new RiotError('Could not get Valorant client version from valorant-api.com', res.status);
  const json = (await res.json()) as { data: { riotClientVersion: string } };
  versionCache = { value: json.data.riotClientVersion, at: Date.now() };
  return versionCache.value;
}

// ---- storefront ----

async function fetchStorefront(discordId: string): Promise<RawStorefront> {
  const clientVersion = await getClientVersion();
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(discordId);
    const res = await riotFetch(`https://pd.${s.shard}.a.pvp.net/store/v3/storefront/${s.puuid}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${s.accessToken}`,
        'X-Riot-Entitlements-JWT': s.entitlementsToken,
        'X-Riot-ClientVersion': clientVersion,
        'X-Riot-ClientPlatform': CLIENT_PLATFORM,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    // Expired/invalid token comes back as 400 BAD_CLAIMS or 401: refresh once and retry.
    if (res.status === 400 || res.status === 401) {
      expireTokens(discordId);
      if (attempt === 0) continue;
      throw new NeedsLoginError('Riot rejected your login. Run `/login` again.');
    }
    if (!res.ok) throw new RiotError('Storefront request failed', res.status);
    return (await res.json()) as RawStorefront;
  }
  throw new RiotError('Storefront request failed after retry');
}

function parseStorefront(raw: RawStorefront): Shop {
  const now = Date.now();
  const panel = raw.SkinsPanelLayout;

  const daily: ShopItem[] = panel.SingleItemStoreOffers
    ? panel.SingleItemStoreOffers.map((o) => ({
        uuid: (o.Rewards?.[0]?.ItemID ?? o.OfferID).toLowerCase(),
        cost: o.Cost[VP] ?? 0,
      }))
    : panel.SingleItemOffers.map((uuid) => ({ uuid: uuid.toLowerCase(), cost: 0 }));

  const rawBundles = raw.FeaturedBundle?.Bundles ?? (raw.FeaturedBundle?.Bundle ? [raw.FeaturedBundle.Bundle] : []);
  const bundles: BundleOffer[] = rawBundles.map((b) => {
    const vpItems = b.Items.filter((i) => i.CurrencyID === VP);
    return {
      uuid: b.DataAssetID.toLowerCase(),
      baseCost: b.TotalBaseCost?.[VP] ?? vpItems.reduce((sum, i) => sum + i.BasePrice, 0),
      discountedCost: b.TotalDiscountedCost?.[VP] ?? vpItems.reduce((sum, i) => sum + i.DiscountedPrice, 0),
      expiresAt: now + b.DurationRemainingInSeconds * 1000,
    };
  });

  const bonus = raw.BonusStore;
  const nightMarket: NightMarketItem[] | null = bonus
    ? bonus.BonusStoreOffers.map((o) => ({
        uuid: (o.Offer.Rewards?.[0]?.ItemID ?? o.Offer.OfferID).toLowerCase(),
        baseCost: o.Offer.Cost[VP] ?? 0,
        discountedCost: o.DiscountCosts[VP] ?? 0,
        discountPercent: o.DiscountPercent,
      }))
    : null;

  return {
    fetchedAt: now,
    daily,
    dailyExpiresAt: now + panel.SingleItemOffersRemainingDurationInSeconds * 1000,
    bundles,
    nightMarket,
    nightMarketExpiresAt: bonus ? now + bonus.BonusStoreRemainingDurationInSeconds * 1000 : null,
  };
}

/** Gets a user's shop, cached until the daily reset. */
export async function getShop(discordId: string, opts: { force?: boolean } = {}): Promise<Shop> {
  if (!opts.force) {
    const cached = getCachedShop<Shop>(discordId);
    if (cached) return cached;
  }
  const shop = parseStorefront(await fetchStorefront(discordId));
  setCachedShop(discordId, shop, shop.dailyExpiresAt);
  return shop;
}
