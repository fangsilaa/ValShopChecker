import { EmbedBuilder } from 'discord.js';
import { getSkin, getTier } from './riot/assets';

export const VP_EMOJI = 'VP';
export const BRAND_COLOR = 0xff4655;

export const vp = (n: number) => `**${n.toLocaleString('en-US')}** ${VP_EMOJI}`;

/** Discord relative timestamp, e.g. "in 5 hours". */
export const relTime = (epochMs: number) => `<t:${Math.floor(epochMs / 1000)}:R>`;

export function skinEmbed(levelUuid: string, description: string): EmbedBuilder {
  const skin = getSkin(levelUuid);
  const tier = skin?.tierUuid ? getTier(skin.tierUuid) : undefined;
  const embed = new EmbedBuilder()
    .setTitle(skin?.name ?? `Unknown item (${levelUuid})`)
    .setDescription(description)
    .setColor(tier?.color ?? 0x2b2d31);
  if (skin?.icon) embed.setThumbnail(skin.icon);
  if (tier) embed.setAuthor({ name: tier.name, iconURL: tier.icon ?? undefined });
  return embed;
}
