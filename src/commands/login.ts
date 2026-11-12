import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { accountLabel, clearCachedShop, getAccounts, MAX_ACCOUNTS, saveAccount } from '../db';
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

/** Sends the login instructions + button as an ephemeral reply. Used by /login and the /accounts "Add account" button. */
export async function sendLoginPrompt(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  const linked = getAccounts(interaction.user.id).length;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(linked ? 'Link another Riot account' : 'Link your Riot account')
    .setDescription(
      [
        `**1.** Open **[this Riot login link](${AUTH_URL})** and sign in, ticking **Stay signed in** (captcha/2FA happen on Riot's site, the bot never sees your password).`,
        linked
          ? '> **Adding an alt?** Open the link in a **private/incognito window**, otherwise Riot just reuses the account you are already signed into.'
          : '',
        '',
        '**2. Recommended: copy your `ssid` cookie** (keeps you logged in for weeks):',
        'While still on any `auth.riotgames.com` page, press **F12** → **Application** (Chrome/Edge) or **Storage** (Firefox) → **Cookies** → `https://auth.riotgames.com` → copy the **value** of `ssid`.',
        '',
        '**…or quick option:** after signing in you land on a `playvalorant.com` page (it may show an error, that is fine). Copy the **entire URL** from the address bar. This only works for ~1 hour.',
        '',
        '**3.** Click the button below and paste it.',
        '',
        '-# Your cookie is encrypted at rest. Treat it like a password: anyone with it can access your Riot account. This uses unofficial Riot endpoints, so use it at your own risk.',
      ]
        .filter((line, i, all) => line !== '' || all[i - 1] !== '') // drop the blank left by the optional alt line
        .join('\n'),
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
}

export const login: Command = {
  data: new SlashCommandBuilder()
    .setName('login')
    .setDescription('Link a Riot account (run again to add an alt or refresh an expired login)'),
  execute: sendLoginPrompt,
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
  const discordId = interaction.user.id;
  const value = interaction.fields.getTextInputValue(LOGIN_INPUT_ID);

  let linked;
  try {
    linked = await linkAccount(value);
  } catch (err) {
    await interaction.editReply(`Couldn't link your account: ${(err as Error).message}`);
    return;
  }

  const existing = getAccounts(discordId);
  if (!existing.some((a) => a.puuid === linked.puuid) && existing.length >= MAX_ACCOUNTS) {
    await interaction.editReply(
      `You already have ${MAX_ACCOUNTS} linked accounts. Remove one with \`/accounts\` before adding another.`,
    );
    return;
  }

  const { isNew, isDefault } = saveAccount({
    discordId,
    puuid: linked.puuid,
    riotName: linked.riotName,
    region: linked.region,
    shard: linked.shard,
    ssid: linked.tokens.ssid,
    accessToken: linked.tokens.accessToken,
    entitlementsToken: linked.entitlementsToken,
    tokenExpiresAt: linked.tokens.expiresAt,
    needsLogin: false,
  });
  clearCachedShop(linked.puuid);

  const name = `**${accountLabel(linked)}** (\`${linked.region.toUpperCase()}\`)`;
  const what = !isNew
    ? `🔄 Refreshed the login for ${name}.`
    : isDefault
      ? `✅ Linked ${name}. It's your default account. Try \`/shop\`.`
      : `✅ Added ${name} as an extra account. Pick it with the \`account:\` option on \`/shop\`, \`/rank\` etc., or make it your default in \`/accounts\`.`;
  const mode = linked.tokens.ssid
    ? 'Using your cookie, so the bot will stay logged in for a few weeks.'
    : '⚠️ Linked with a one-time URL, which expires in about **1 hour**. Use the `ssid` cookie next time to stay logged in.';
  await interaction.editReply(`${what}\n${mode}`);
}
