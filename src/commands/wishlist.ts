import { SlashCommandBuilder } from 'discord.js';
import { addWishlist, getWishlist, removeWishlist } from '../db';
import { ensureAssets, getSkin, searchSkins } from '../riot/assets';
import type { Command } from './types';

/**
 * One command instead of add/remove/list subcommands:
 *   /wishlist               -> show your wishlist
 *   /wishlist skin:<name>   -> toggle that skin (add if missing, remove if already there)
 */
export const wishlist: Command = {
  data: new SlashCommandBuilder()
    .setName('wishlist')
    .setDescription('Pick a skin to add/remove it, or leave empty to see your wishlist')
    .addStringOption((o) =>
      o
        .setName('skin')
        .setDescription('Skin to add or remove (leave empty to view your wishlist)')
        .setRequired(false)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    await ensureAssets();
    const query = interaction.options.getFocused().trim().toLowerCase();
    const wished = getWishlist(interaction.user.id);
    const wishedSet = new Set(wished);

    // Skins already on the wishlist come first and are labelled as "remove".
    const onList = wished
      .map((uuid) => ({ uuid, name: getSkin(uuid)?.name ?? uuid }))
      .filter((s) => s.name.toLowerCase().includes(query))
      .map((s) => ({ name: `✓ ${s.name} (on wishlist, pick to remove)`, value: s.uuid }));

    const toAdd = searchSkins(query, 25)
      .filter((s) => !wishedSet.has(s.levelUuid))
      .map((s) => ({ name: s.name, value: s.levelUuid }));

    await interaction.respond(
      [...onList, ...toAdd].slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value })),
    );
  },

  async execute(interaction) {
    await ensureAssets();
    const userId = interaction.user.id;
    const raw = interaction.options.getString('skin');

    if (!raw) {
      const items = getWishlist(userId);
      await interaction.reply({
        content: items.length
          ? `**Your wishlist (${items.length}):**\n${items.map((u) => `• ${getSkin(u)?.name ?? u}`).join('\n')}\n\n-# Use \`/wishlist skin:<name>\` to add or remove a skin.`
          : 'Your wishlist is empty. Use `/wishlist skin:<name>` to add one.',
        ephemeral: true,
      });
      return;
    }

    // Value is a skin-level uuid when picked from autocomplete; fall back to a name search if they typed freely.
    const skin = getSkin(raw) ?? searchSkins(raw, 1)[0];
    if (!skin) {
      if (removeWishlist(userId, raw)) {
        await interaction.reply({ content: 'Removed that item from your wishlist.', ephemeral: true });
      } else {
        await interaction.reply({ content: `No skin found matching "${raw}".`, ephemeral: true });
      }
      return;
    }

    if (removeWishlist(userId, skin.levelUuid)) {
      await interaction.reply({ content: `➖ Removed **${skin.name}** from your wishlist.`, ephemeral: true });
    } else {
      addWishlist(userId, skin.levelUuid);
      await interaction.reply({
        content: `➕ Added **${skin.name}** to your wishlist. I'll ping you when it's in your shop.`,
        ephemeral: true,
      });
    }
  },
};
