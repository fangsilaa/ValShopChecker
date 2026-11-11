import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { ensureAssets } from '../riot/assets';
import { getShop } from '../riot/store';
import { BRAND_COLOR, relTime, skinEmbed, vp } from '../ui';
import type { Command } from './types';

export const nightmarket: Command = {
  data: new SlashCommandBuilder().setName('nightmarket').setDescription('Show your night market (when it is running)'),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await ensureAssets();
    const s = await getShop(interaction.user.id);

    if (!s.nightMarket || !s.nightMarketExpiresAt) {
      await interaction.editReply("🌙 The night market isn't running right now.");
      return;
    }

    const header = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('🌙 Night market')
      .setDescription(`Ends ${relTime(s.nightMarketExpiresAt)}`);

    const embeds = s.nightMarket.map((item) =>
      skinEmbed(
        item.uuid,
        `~~${item.baseCost.toLocaleString('en-US')}~~ ${vp(item.discountedCost)} (-${item.discountPercent}%)`,
      ),
    );

    await interaction.editReply({ embeds: [header, ...embeds].slice(0, 10) });
  },
};
