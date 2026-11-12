import { Client, Events, GatewayIntentBits, REST, Routes, type RepliableInteraction } from 'discord.js';
import cron from 'node-cron';
import { config } from './config';
import { accounts, ACCOUNTS_PREFIX, handleAccountsComponent } from './commands/accounts';
import { bundle } from './commands/bundle';
import { comp, COMP_PREFIX, handleCompButton } from './commands/comp';
import { handleLoginButton, handleLoginModal, login, LOGIN_BUTTON_ID, LOGIN_MODAL_ID } from './commands/login';
import { nightmarket } from './commands/nightmarket';
import { rank } from './commands/rank';
import { shop } from './commands/shop';
import type { Command } from './commands/types';
import { wishlist } from './commands/wishlist';
import { runDailyCheck } from './jobs/dailyCheck';
import { ensureAssets } from './riot/assets';
import { NeedsLoginError, RiotError, UserError } from './riot/errors';
import { refreshVctComps } from './vlr/comps';

const commands: Command[] = [shop, bundle, nightmarket, rank, comp, wishlist, login, accounts];
const byName = new Map(commands.map((c) => [c.data.name, c]));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function replyError(interaction: RepliableInteraction, err: unknown): Promise<void> {
  let message: string;
  if (err instanceof NeedsLoginError || err instanceof UserError) message = err.message;
  else if (err instanceof RiotError) {
    message = err.status
      ? `Riot's servers returned an error (${err.status}). Try again in a bit.`
      : `Couldn't reach Riot (${err.message}). Try again in a bit.`;
  }
  else {
    console.error(err);
    message = 'Something went wrong. Check the bot logs.';
  }
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, embeds: [], components: [] });
    else await interaction.reply({ content: message, ephemeral: true });
  } catch (e) {
    console.error('Failed to send error reply:', e);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  const rest = new REST().setToken(config.discordToken);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: commands.map((cmd) => cmd.data.toJSON()),
  });
  console.log(`Registered ${commands.length} slash commands in guild ${config.guildId}`);

  ensureAssets().catch((err) => console.error('Initial asset load failed:', err));

  if (process.argv.includes('--check-now')) {
    await runDailyCheck(c);
    await c.destroy();
    process.exit(0);
  }

  const refreshVct = () => void refreshVctComps().catch((err) => console.error('VCT comp refresh failed:', err));
  refreshVct();
  cron.schedule('30 6 * * *', refreshVct, { timezone: 'Etc/UTC' });

  // Store resets at 00:00 UTC; check a couple of minutes after.
  cron.schedule('2 0 * * *', () => void runDailyCheck(c).catch((err) => console.error('Daily check crashed:', err)), {
    timezone: 'Etc/UTC',
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await byName.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isAutocomplete()) {
      await byName.get(interaction.commandName)?.autocomplete?.(interaction);
    } else if (interaction.isButton() && interaction.customId === LOGIN_BUTTON_ID) {
      await handleLoginButton(interaction);
    } else if (interaction.isModalSubmit() && interaction.customId === LOGIN_MODAL_ID) {
      await handleLoginModal(interaction);
    } else if (interaction.isButton() && interaction.customId.startsWith(COMP_PREFIX)) {
      await handleCompButton(interaction);
    } else if (
      (interaction.isButton() || interaction.isStringSelectMenu()) &&
      interaction.customId.startsWith(ACCOUNTS_PREFIX)
    ) {
      await handleAccountsComponent(interaction);
    }
  } catch (err) {
    if (interaction.isRepliable()) await replyError(interaction, err);
    else console.error(err);
  }
});

client.login(config.discordToken);
