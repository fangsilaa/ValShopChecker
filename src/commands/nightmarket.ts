import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { accountLabel } from '../db';
import { ensureAssets } from '../riot/assets';
import { getShop } from '../riot/store';
import { BRAND_COLOR, relTime, skinEmbed, vp } from '../ui';
import { ACCOUNT_OPTION, accountOption, autocompleteAccounts, resolveAccount } from './accountOption';
import type { Command } from './types';

export const nightmarket: Command = {
  data: new SlashCommandBuilder()
    .setName('nightmarket')
    .setDescription('Show your night market (when it is running)')
    .addStringOption(accountOption),
  autocomplete: autocompleteAccounts,
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const account = resolveAccount(interaction.user.id, interaction.options.getString(ACCOUNT_OPTION));
    await ensureAssets();
    const s = await getShop(account);

    if (!s.nightMarket || !s.nightMarketExpiresAt) {
      await interaction.editReply("🌙 The night market isn't running right now.");
      return;
    }

    const header = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`🌙 Night market · ${accountLabel(account)}`)
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
