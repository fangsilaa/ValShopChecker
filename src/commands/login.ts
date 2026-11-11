import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { clearCachedShop, deleteUser, getUser, saveUser } from '../db';
import { AUTH_URL, linkAccount } from '../riot/auth';
import { BRAND_COLOR } from '../ui';
import type { Command } from './types';

export const LOGIN_BUTTON_ID = 'login:open';
export const LOGIN_MODAL_ID = 'login:submit';
const LOGIN_INPUT_ID = 'login:value';
/** The "Paste cookie / URL" button stops working after this long. */
const LOGIN_BUTTON_TTL_MS = 5 * 60_000;

const expiredRow = () =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(LOGIN_BUTTON_ID)
      .setLabel('Expired, run /login again')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );

export const login: Command = {
  data: new SlashCommandBuilder().setName('login').setDescription('Link your Riot account so the bot can read your shop'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Link your Riot account')
      .setDescription(
        [
          `**1.** Open **[this Riot login link](${AUTH_URL})** and sign in (captcha/2FA happen on Riot's site, the bot never sees your password).`,
          '',
          '**2. Recommended: copy your `ssid` cookie** (keeps you logged in for weeks):',
          'While still on any `auth.riotgames.com` page, press **F12** → **Application** (Chrome/Edge) or **Storage** (Firefox) → **Cookies** → `https://auth.riotgames.com` → copy the **value** of `ssid`.',
          '',
          '**…or quick option:** after signing in you land on a `playvalorant.com` page (it may show an error, that is fine). Copy the **entire URL** from the address bar. This only works for ~1 hour.',
          '',
          '**3.** Click the button below and paste it.',
          '',
          '-# Your cookie is encrypted at rest. Treat it like a password: anyone with it can access your Riot account. This uses unofficial Riot endpoints, so use it at your own risk.',
        ].join('\n'),
      );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(LOGIN_BUTTON_ID).setLabel('Paste cookie / URL').setStyle(ButtonStyle.Primary),
    );
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

    // Grey the button out once it expires. (Interaction tokens last 15 min, so this edit is still allowed.)
    setTimeout(() => {
      interaction.editReply({ components: [expiredRow()] }).catch(() => {
        /* user dismissed the message; nothing to do */
      });
    }, LOGIN_BUTTON_TTL_MS).unref();
  },
};

export async function handleLoginButton(interaction: ButtonInteraction): Promise<void> {
  // Also guard server-side, in case the timer didn't run (e.g. the bot restarted).
  if (Date.now() - interaction.message.createdTimestamp > LOGIN_BUTTON_TTL_MS) {
    await interaction.update({ components: [expiredRow()] });
    await interaction.followUp({ content: 'That login button expired. Run `/login` again.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(LOGIN_MODAL_ID)
    .setTitle('Link Riot account')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LOGIN_INPUT_ID)
          .setLabel('ssid cookie or redirect URL')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleLoginModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const value = interaction.fields.getTextInputValue(LOGIN_INPUT_ID);

  let account;
  try {
    account = await linkAccount(value);
  } catch (err) {
    await interaction.editReply(`Couldn't link your account: ${(err as Error).message}`);
    return;
  }

  saveUser({
    discordId: interaction.user.id,
    puuid: account.puuid,
    riotName: account.riotName,
    region: account.region,
    shard: account.shard,
    ssid: account.tokens.ssid,
    accessToken: account.tokens.accessToken,
    entitlementsToken: account.entitlementsToken,
    tokenExpiresAt: account.tokens.expiresAt,
    needsLogin: false,
  });
  clearCachedShop(interaction.user.id);

  const mode = account.tokens.ssid
    ? 'Using your cookie, so the bot will stay logged in for a few weeks.'
    : '⚠️ Linked with a one-time URL, which expires in about **1 hour**. Use the `ssid` cookie next time to stay logged in.';
  await interaction.editReply(
    `✅ Linked **${account.riotName ?? account.puuid}** (region \`${account.region.toUpperCase()}\`). ${mode}\nTry \`/shop\`.`,
  );
}

export const logout: Command = {
  data: new SlashCommandBuilder().setName('logout').setDescription('Unlink your Riot account and delete stored tokens'),
  async execute(interaction) {
    const had = getUser(interaction.user.id) !== null;
    deleteUser(interaction.user.id);
    await interaction.reply({
      content: had
        ? 'Unlinked. Your Riot tokens were deleted (your wishlist was kept).'
        : "You didn't have a linked account.",
      ephemeral: true,
    });
  },
};
