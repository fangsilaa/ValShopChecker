import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import { accountLabel, deleteAccount, getAccount, getAccounts, MAX_ACCOUNTS, setDefaultAccount } from '../db';
import { BRAND_COLOR } from '../ui';
import { sendLoginPrompt } from './login';
import type { Command } from './types';

/** /accounts: list linked Riot accounts, change the default, remove one, or add another. Replaces /logout. */

const ID = {
  add: 'accounts:add',
  setDefault: 'accounts:default',
  remove: 'accounts:remove',
  confirmRemove: 'accounts:confirm:', // + puuid
  cancel: 'accounts:cancel',
};
export const ACCOUNTS_PREFIX = 'accounts:';

interface AccountsView {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
}

function accountsView(discordId: string, note?: string): AccountsView {
  const accounts = getAccounts(discordId);
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Your Riot accounts');

  if (accounts.length === 0) {
    embed.setDescription('No linked accounts. Click **Add account** to link one.');
  } else {
    embed.setDescription(
      accounts
        .map(
          (a) =>
            `${a.isDefault ? '★' : '•'} **${accountLabel(a)}** · ${a.region.toUpperCase()}` +
            `${a.isDefault ? ' (default)' : ''}${a.needsLogin ? ' · ⚠️ login expired, run `/login` with it' : ''}`,
        )
        .join('\n'),
    );
    embed.setFooter({
      text: `${accounts.length}/${MAX_ACCOUNTS} accounts · Commands use your default unless you pick one with account:`,
    });
  }

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
  const others = accounts.filter((a) => !a.isDefault);
  if (others.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ID.setDefault)
          .setPlaceholder('★ Make another account the default…')
          .addOptions(others.map((a) => ({ label: accountLabel(a).slice(0, 100), value: a.puuid, description: a.region.toUpperCase() }))),
      ),
    );
  }
  if (accounts.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ID.remove)
          .setPlaceholder('🗑️ Remove an account…')
          .addOptions(accounts.map((a) => ({ label: accountLabel(a).slice(0, 100), value: a.puuid, description: a.region.toUpperCase() }))),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ID.add)
        .setLabel(accounts.length >= MAX_ACCOUNTS ? `Max ${MAX_ACCOUNTS} accounts` : 'Add account')
        .setStyle(ButtonStyle.Success)
        .setDisabled(accounts.length >= MAX_ACCOUNTS),
    ),
  );

  return { content: note ?? '', embeds: [embed], components: rows };
}

export const accounts: Command = {
  data: new SlashCommandBuilder()
    .setName('accounts')
    .setDescription('See your linked Riot accounts, change your default, add or remove one'),
  async execute(interaction) {
    await interaction.reply({ ...accountsView(interaction.user.id), ephemeral: true });
  },
};

/** Handles every button/select whose customId starts with "accounts:". */
export async function handleAccountsComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const discordId = interaction.user.id;
  const id = interaction.customId;

  if (id === ID.add) {
    await sendLoginPrompt(interaction as ButtonInteraction);
    return;
  }

  if (id === ID.cancel) {
    await interaction.update(accountsView(discordId));
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const puuid = interaction.values[0];
    const acct = getAccount({ discordId, puuid });
    if (!acct) {
      await interaction.update(accountsView(discordId, 'That account is no longer linked.'));
      return;
    }

    if (id === ID.setDefault) {
      setDefaultAccount(acct);
      await interaction.update(accountsView(discordId, `★ **${accountLabel(acct)}** is now your default account.`));
      return;
    }

    if (id === ID.remove) {
      // Ask for confirmation before deleting tokens.
      await interaction.update({
        content: `Remove **${accountLabel(acct)}**? Its stored login is deleted. Your wishlist is kept.`,
        embeds: [],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(ID.confirmRemove + puuid).setLabel('Remove').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(ID.cancel).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
      return;
    }
  }

  if (id.startsWith(ID.confirmRemove)) {
    const puuid = id.slice(ID.confirmRemove.length);
    const acct = getAccount({ discordId, puuid });
    const removed = acct ? deleteAccount(acct) : false;
    await interaction.update(
      accountsView(discordId, removed && acct ? `🗑️ Removed **${accountLabel(acct)}**.` : 'That account was already removed.'),
    );
  }
}
