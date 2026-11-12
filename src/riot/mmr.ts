import { getCurrentAct } from './assets';
import type { AccountRef } from '../db';
import { pdRequest } from './pd';

interface RawSeasonalInfo {
  SeasonID: string;
  NumberOfWins: number;
  NumberOfWinsWithPlacements: number;
  NumberOfGames: number;
  CompetitiveTier: number;
  RankedRating: number;
  LeaderboardRank: number;
  WinsByTier: Record<string, number> | null;
}

interface RawMmr {
  QueueSkills?: {
    competitive?: { SeasonalInfoBySeasonID?: Record<string, RawSeasonalInfo> | null };
  };
  LatestCompetitiveUpdate?: {
    MatchID: string;
    MapID: string;
    SeasonID: string;
    MatchStartTime: number;
    TierAfterUpdate: number;
    RankedRatingAfterUpdate: number;
    RankedRatingEarned: number;
  } | null;
}

export interface RankInfo {
  actId: string | null;
  /** 0 = unranked / placements not finished this act */
  tier: number;
  rr: number;
  leaderboardRank: number;
  wins: number;
  games: number;
  /** Highest tier reached this act (based on tiers you won games at). */
  peakTier: number;
  lastGame: { rrChange: number; tierAfter: number; mapPath: string; at: number; actId: string } | null;
}

export async function getRank(account: AccountRef): Promise<RankInfo> {
  const raw = await pdRequest<RawMmr>(account, (s) => `/mmr/v1/players/${s.puuid}`, { what: 'Rank request' });

  const latest = raw.LatestCompetitiveUpdate?.MatchID ? raw.LatestCompetitiveUpdate : null;
  // Prefer the act that is live right now; fall back to the act of the latest ranked game.
  const actId = getCurrentAct()?.uuid ?? latest?.SeasonID?.toLowerCase() ?? null;

  const seasons = raw.QueueSkills?.competitive?.SeasonalInfoBySeasonID ?? {};
  const season = Object.values(seasons).find((s) => s.SeasonID.toLowerCase() === actId);

  const tier = season?.CompetitiveTier ?? 0;
  const winTiers = Object.keys(season?.WinsByTier ?? {}).map(Number);

  return {
    actId,
    tier,
    rr: season?.RankedRating ?? 0,
    leaderboardRank: season?.LeaderboardRank ?? 0,
    wins: season?.NumberOfWinsWithPlacements ?? 0,
    games: season?.NumberOfGames ?? 0,
    peakTier: Math.max(tier, ...winTiers),
    lastGame: latest
      ? {
          rrChange: latest.RankedRatingEarned,
          tierAfter: latest.TierAfterUpdate,
          mapPath: latest.MapID,
          at: latest.MatchStartTime,
          actId: latest.SeasonID.toLowerCase(),
        }
      : null,
  };
}
