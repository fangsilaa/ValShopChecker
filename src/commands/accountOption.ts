import type { AutocompleteInteraction, SlashCommandStringOption } from 'discord.js';
import { accountLabel, getAccounts, type Account } from '../db';
import { NeedsLoginError, UserError } from '../riot/errors';

/** Shared optional `account:` option for commands that act on one linked Riot account. */
export const ACCOUNT_OPTION = 'account';

export const accountOption = (o: SlashCommandStringOption) =>
  o
    .setName(ACCOUNT_OPTION)
    .setDescription('Which linked Riot account (default: your default account)')
    .setRequired(false)
    .setAutocomplete(true);

/**
 * Suggests linked accounts. If the command also has a `user:` option that is filled in,
 * suggests that user's accounts instead (used by /rank).
 */
export async function autocompleteAccounts(interaction: AutocompleteInteraction): Promise<void> {
  const ownerId = (interaction.options.get('user')?.value as string | undefined) ?? interaction.user.id;
  const query = interaction.options.getFocused().toLowerCase();
  const choices = getAccounts(ownerId)
    .filter((a) => accountLabel(a).toLowerCase().includes(query))
    .slice(0, 25)
    .map((a) => ({
      name: `${a.isDefault ? '★ ' : ''}${accountLabel(a)}${a.isDefault ? ' (default)' : ''}${a.needsLogin ? ' ⚠️ login expired' : ''}`.slice(0, 100),
      value: a.puuid,
    }));
  await interaction.respond(choices);
}

/**
 * Turns the `account:` option into an account. Accepts the puuid (picked from autocomplete)
 * or a typed Riot ID / partial name. Empty -> the user's default account.
 */
export function resolveAccount(discordId: string, value: string | null, isSelf = true): Account {
  const accounts = getAccounts(discordId);
  if (accounts.length === 0) {
    throw isSelf ? new NeedsLoginError() : new UserError("They haven't linked a Riot account with `/login`.");
  }
  if (!value) return accounts[0];

  const v = value.trim().toLowerCase();
  const match =
    accounts.find((a) => a.puuid === v) ??
    accounts.find((a) => accountLabel(a).toLowerCase() === v) ??
    accounts.find((a) => accountLabel(a).toLowerCase().includes(v));
  if (!match) {
    const names = accounts.map(accountLabel).join(', ');
    throw new UserError(`No linked account matches "${value}". ${isSelf ? 'Your' : 'Their'} accounts: ${names}`);
  }
  return match;
}
