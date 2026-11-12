import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { ensureAssets, getBundle } from '../riot/assets';
import { getShop } from '../riot/store';
import { BRAND_COLOR, relTime, vp } from '../ui';
import { ACCOUNT_OPTION, accountOption, autocompleteAccounts, resolveAccount } from './accountOption';
import type { Command } from './types';

export const bundle: Command = {
  data: new SlashCommandBuilder()
    .setName('bundle')
    .setDescription('Show the current featured bundle(s)')
    .addStringOption(accountOption),
  autocomplete: autocompleteAccounts,
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const account = resolveAccount(interaction.user.id, interaction.options.getString(ACCOUNT_OPTION));
    await ensureAssets();
    const s = await getShop(account);

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
