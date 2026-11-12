import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ButtonInteraction,
} from 'discord.js';
import { countVctComp, getRandomVctComp, getVctMaps, type VctComp } from '../db';
import { UserError } from '../riot/errors';
import { BRAND_COLOR } from '../ui';
import { hasVctData, isRefreshingVct, refreshVctComps, vctYears } from '../vlr/comps';
import type { Command } from './types';

export const COMP_PREFIX = 'comp:';
const MAP_OPTION = 'map';

const NOT_LOADED = 'VCT comp data is still loading from vlr.gg. Try again in a minute.';

function ensureLoaded(): void {
  if (hasVctData()) return;
  if (!isRefreshingVct()) void refreshVctComps().catch((err) => console.error('VCT refresh failed:', err));
  throw new UserError(NOT_LOADED);
}

/** Map name as stored (proper casing), or a UserError if VCT never played it. */
function resolveMap(input: string): string {
  const maps = getVctMaps();
  const found = maps.find((m) => m.map.toLowerCase() === input.trim().toLowerCase());
  if (!found) {
    throw new UserError(
      `No VCT games found on **${input}**. Maps played: ${maps.map((m) => m.map).join(', ')}.`,
    );
  }
  return found.map;
}

function compMessage(comp: VctComp) {
  const stats = countVctComp(comp.map, comp.agents);
  const [first, last] = vctYears();
  const winPct = Math.round((stats.wins / stats.games) * 100);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${comp.map} · VCT comp`)
    .setURL(comp.matchUrl)
    .setDescription(comp.agents.split(', ').map((a) => `**${a}**`).join(' · '))
    .addFields(
      { name: 'Team', value: comp.team, inline: true },
      { name: 'Result', value: `${comp.result === 'win' ? '✅ Won' : '❌ Lost'} vs ${comp.opponent}`, inline: true },
      { name: 'Event', value: comp.eventName, inline: true },
      {
        name: `This comp on ${comp.map}`,
        value:
          stats.games === 1
            ? 'Only played once in VCT.'
            : `Played **${stats.games}** times by **${stats.teams}** team${stats.teams === 1 ? '' : 's'} · ${winPct}% win rate`,
      },
    )
    .setFooter({ text: `VCT ${first}–${last} · data from vlr.gg` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      // Carries the current comp so the reroll can avoid showing it again.
      .setCustomId(`${COMP_PREFIX}reroll:${comp.gameId}:${comp.map}:${comp.team}`.slice(0, 100))
      .setLabel('Reroll')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setLabel('Match on vlr.gg').setStyle(ButtonStyle.Link).setURL(comp.matchUrl),
  );
  return { embeds: [embed], components: [row] };
}

export const comp: Command = {
  data: new SlashCommandBuilder()
    .setName('comp')
    .setDescription('Show a team composition a pro team played in VCT on a map')
    .addStringOption((o) =>
      o.setName(MAP_OPTION).setDescription('Which map').setRequired(true).setAutocomplete(true),
    ),
  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const choices = getVctMaps()
      .filter((m) => m.map.toLowerCase().includes(q))
      .slice(0, 25)
      .map((m) => ({ name: `${m.map} (${m.games} games)`, value: m.map }));
    await interaction.respond(choices);
  },
  async execute(interaction) {
    ensureLoaded();
    const map = resolveMap(interaction.options.getString(MAP_OPTION, true));
    const picked = getRandomVctComp(map);
    if (!picked) throw new UserError(`No VCT comps found on **${map}**.`);
    await interaction.reply(compMessage(picked));
  },
};

/** Reroll button: `comp:reroll:<gameId>:<map>:<team>`. */
export async function handleCompButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, gameId, map, ...teamParts] = interaction.customId.split(':');
  if (action !== 'reroll' || !map) return;
  ensureLoaded();
  const picked = getRandomVctComp(map, { gameId: Number(gameId), team: teamParts.join(':') });
  if (!picked) throw new UserError(`No VCT comps found on **${map}**.`);
  await interaction.update(compMessage(picked));
}
