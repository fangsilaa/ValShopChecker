import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { ensureAssets, getBundle } from '../riot/assets';
import { getShop } from '../riot/store';
import { BRAND_COLOR, relTime, vp } from '../ui';
import type { Command } from './types';

export const bundle: Command = {
  data: new SlashCommandBuilder().setName('bundle').setDescription('Show the current featured bundle(s)'),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await ensureAssets();
    const s = await getShop(interaction.user.id);

    if (s.bundles.length === 0) {
      await interaction.editReply('No featured bundle right now.');
      return;
    }

    const embeds = s.bundles.slice(0, 10).map((b) => {
      const info = getBundle(b.uuid);
      const price =
        b.discountedCost < b.baseCost ? `~~${b.baseCost.toLocaleString('en-US')}~~ ${vp(b.discountedCost)}` : vp(b.baseCost);
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(info?.name ?? 'Featured bundle')
        .setDescription(`${price}\nLeaves the store ${relTime(b.expiresAt)}`);
      if (info?.icon) embed.setImage(info.icon);
      return embed;
    });

    await interaction.editReply({ embeds });
  },
};
