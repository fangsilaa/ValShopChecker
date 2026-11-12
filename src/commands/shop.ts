import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { accountLabel } from '../db';
import { ensureAssets } from '../riot/assets';
import { getShop } from '../riot/store';
import { BRAND_COLOR, relTime, skinEmbed, vp } from '../ui';
import { ACCOUNT_OPTION, accountOption, autocompleteAccounts, resolveAccount } from './accountOption';
import type { Command } from './types';

export const shop: Command = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Show your Valorant daily shop')
    .addStringOption(accountOption),
  autocomplete: autocompleteAccounts,
  async execute(interaction) {
    await interaction.deferReply(); // public reply
    const account = resolveAccount(interaction.user.id, interaction.options.getString(ACCOUNT_OPTION));
    await ensureAssets();
    const s = await getShop(account);

    const header = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Daily shop · ${accountLabel(account)}`)
      .setDescription(`Resets ${relTime(s.dailyExpiresAt)}`);

    await interaction.editReply({
      embeds: [header, ...s.daily.map((item) => skinEmbed(item.uuid, vp(item.cost)))],
    });
  },
};
