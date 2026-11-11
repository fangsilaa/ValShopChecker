import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getUser } from '../db';
import { ensureAssets, getAct, getMapName, getRankTier } from '../riot/assets';
import { NeedsLoginError } from '../riot/errors';
import { getRank } from '../riot/mmr';
import { BRAND_COLOR, relTime } from '../ui';
import type { Command } from './types';

const tierName = (tier: number) => getRankTier(tier)?.name ?? (tier === 0 ? 'Unranked' : `Tier ${tier}`);

export const rank: Command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show a competitive rank and RR (yours by default)')
    .addUserOption((o) =>
      o.setName('user').setDescription('Whose rank to show (they must have used /login). Default: you').setRequired(false),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = target.id === interaction.user.id;

    if (target.bot) {
      await interaction.reply({ content: "Bots don't have a Valorant rank. 🤖", ephemeral: true });
      return;
    }

    // Public reply so you can show it off; errors (e.g. not linked) still come back here.
    await interaction.deferReply();
    await ensureAssets();

    let r;
    try {
      r = await getRank(target.id);
    } catch (err) {
      if (err instanceof NeedsLoginError && !isSelf) {
        const linked = getUser(target.id) !== null;
        await interaction.editReply(
          linked
            ? `**${target.displayName}**'s Riot login has expired. They need to run \`/login\` again.`
            : `**${target.displayName}** hasn't linked a Riot account with \`/login\`, so I can't see their rank.`,
        );
        return;
      }
      throw err;
    }

    const user = getUser(target.id);
    const tierInfo = getRankTier(r.tier);
    const act = r.actId ? getAct(r.actId) : undefined;

    const embed = new EmbedBuilder()
      .setColor(r.tier > 0 ? (tierInfo?.color ?? BRAND_COLOR) : 0x2b2d31)
      .setAuthor({ name: user?.riotName ?? target.displayName, iconURL: target.displayAvatarURL() })
      .setFooter({ text: act?.name ?? 'Current act' });

    if (r.tier > 0) {
      embed.setTitle(tierName(r.tier));
      embed.setDescription(
        `**${r.rr}** RR${r.leaderboardRank > 0 ? ` · Leaderboard **#${r.leaderboardRank.toLocaleString('en-US')}**` : ''}`,
      );
      if (tierInfo?.icon) embed.setThumbnail(tierInfo.icon);
    } else {
      embed.setTitle('Unranked this act');
      embed.setDescription(r.games > 0 ? 'Placement matches not finished yet.' : 'No ranked games this act yet.');
    }

    if (r.games > 0) {
      const losses = r.games - r.wins;
      const pct = Math.round((r.wins / r.games) * 100);
      embed.addFields({ name: 'This act', value: `${r.wins}W / ${losses}L (${pct}%)`, inline: true });
    }
    if (r.peakTier > 0 && r.peakTier !== r.tier) {
      embed.addFields({ name: 'Peak this act', value: tierName(r.peakTier), inline: true });
    }

    if (r.lastGame) {
      const g = r.lastGame;
      const sign = g.rrChange > 0 ? '+' : '';
      const arrow = g.rrChange > 0 ? '🟢' : g.rrChange < 0 ? '🔴' : '⚪';
      const map = getMapName(g.mapPath) ?? 'Unknown map';
      const otherAct = g.actId !== r.actId ? ` (${getAct(g.actId)?.name ?? 'previous act'})` : '';
      embed.addFields({
        name: 'Last ranked game',
        value: `${arrow} **${sign}${g.rrChange} RR** on ${map} · ${relTime(g.at)}${otherAct}`,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
