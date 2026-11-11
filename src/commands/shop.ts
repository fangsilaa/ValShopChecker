import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getUser } from '../db';
import { ensureAssets } from '../riot/assets';
import { getShop } from '../riot/store';
import { BRAND_COLOR, relTime, skinEmbed, vp } from '../ui';
import type { Command } from './types';

export const shop: Command = {
  data: new SlashCommandBuilder().setName('shop').setDescription('Show your Valorant daily shop'),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await ensureAssets();
    const s = await getShop(interaction.user.id);
    const user = getUser(interaction.user.id);

    const header = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Daily shop${user?.riotName ? ` · ${user.riotName}` : ''}`)
      .setDescription(`Resets ${relTime(s.dailyExpiresAt)}`);

    await interaction.editReply({
      embeds: [header, ...s.daily.map((item) => skinEmbed(item.uuid, vp(item.cost)))],
    });
  },
};
