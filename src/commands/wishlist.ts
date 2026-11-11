import { SlashCommandBuilder } from 'discord.js';
import { addWishlist, getWishlist, removeWishlist } from '../db';
import { ensureAssets, getSkin, searchSkins } from '../riot/assets';
import type { Command } from './types';

export const wishlist: Command = {
  data: new SlashCommandBuilder()
    .setName('wishlist')
    .setDescription('Get pinged when a skin you want shows up in your shop')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Add a skin to your wishlist')
        .addStringOption((o) => o.setName('skin').setDescription('Skin name').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Remove a skin from your wishlist')
        .addStringOption((o) => o.setName('skin').setDescription('Skin name').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('Show your wishlist')),

  async autocomplete(interaction) {
    await ensureAssets();
    const query = interaction.options.getFocused().toLowerCase();
    const sub = interaction.options.getSubcommand();

    let choices: { name: string; value: string }[];
    if (sub === 'remove') {
      choices = getWishlist(interaction.user.id)
        .map((uuid) => ({ name: getSkin(uuid)?.name ?? uuid, value: uuid }))
        .filter((c) => c.name.toLowerCase().includes(query));
    } else {
      choices = searchSkins(query).map((s) => ({ name: s.name, value: s.levelUuid }));
    }
    await interaction.respond(choices.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value })));
  },

  async execute(interaction) {
    await ensureAssets();
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'list') {
      const items = getWishlist(userId);
      await interaction.reply({
        content: items.length
          ? `**Your wishlist (${items.length}):**\n${items.map((u) => `• ${getSkin(u)?.name ?? u}`).join('\n')}`
          : 'Your wishlist is empty. Add skins with `/wishlist add`.',
        ephemeral: true,
      });
      return;
    }

    // Value is a skin-level uuid when picked from autocomplete; fall back to a name search if they typed freely.
    const raw = interaction.options.getString('skin', true);
    const skin = getSkin(raw) ?? searchSkins(raw, 1)[0];

    if (sub === 'add') {
      if (!skin) {
        await interaction.reply({ content: `No skin found matching "${raw}".`, ephemeral: true });
        return;
      }
      const added = addWishlist(userId, skin.levelUuid);
      await interaction.reply({
        content: added
          ? `Added **${skin.name}** to your wishlist. I'll ping you when it's in your shop.`
          : `**${skin.name}** is already on your wishlist.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const uuid = skin?.levelUuid ?? raw;
      const removed = removeWishlist(userId, uuid);
      await interaction.reply({
        content: removed
          ? `Removed **${skin?.name ?? raw}** from your wishlist.`
          : `That skin isn't on your wishlist.`,
        ephemeral: true,
      });
    }
  },
};
