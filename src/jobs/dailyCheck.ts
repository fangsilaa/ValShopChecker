import type { Client, EmbedBuilder, MessageCreateOptions } from 'discord.js';
import { config } from '../config';
import { getUser, getWishlist, usersWithWishlist } from '../db';
import { ensureAssets } from '../riot/assets';
import { NeedsLoginError } from '../riot/errors';
import { getShop } from '../riot/store';
import { skinEmbed, vp } from '../ui';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function notify(client: Client, discordId: string, msg: MessageCreateOptions): Promise<void> {
  if (config.alertChannelId) {
    const channel = await client.channels.fetch(config.alertChannelId);
    if (channel?.isSendable()) {
      await channel.send({ ...msg, allowedMentions: { users: [discordId] } });
      return;
    }
    console.warn('ALERT_CHANNEL_ID is not a sendable channel, falling back to DM');
  }
  const user = await client.users.fetch(discordId);
  await user.send(msg);
}

/** Fetches every linked user's fresh shop and pings them for wishlist matches. Run just after the 00:00 UTC reset. */
export async function runDailyCheck(client: Client): Promise<void> {
  await ensureAssets();
  const ids = usersWithWishlist();
  console.log(`Daily check: ${ids.length} user(s) with wishlists`);

  for (const id of ids) {
    const alreadyNeededLogin = getUser(id)?.needsLogin ?? false;
    if (alreadyNeededLogin) continue; // already told them; skip until they /login again

    try {
      const wanted = new Set(getWishlist(id));
      const shop = await getShop(id, { force: true });

      const embeds: EmbedBuilder[] = [];
      for (const item of shop.daily) {
        if (wanted.has(item.uuid)) embeds.push(skinEmbed(item.uuid, `In your **daily shop** for ${vp(item.cost)}`));
      }
      for (const item of shop.nightMarket ?? []) {
        if (wanted.has(item.uuid)) {
          embeds.push(
            skinEmbed(item.uuid, `In your **night market** for ${vp(item.discountedCost)} (-${item.discountPercent}%)`),
          );
        }
      }

      if (embeds.length) {
        await notify(client, id, {
          content: `<@${id}> 🎯 a skin from your wishlist is in your shop!`,
          embeds: embeds.slice(0, 10),
        });
      }
    } catch (err) {
      if (err instanceof NeedsLoginError) {
        await notify(client, id, {
          content: `<@${id}> I couldn't check your shop for wishlist skins: your Riot login expired. Run \`/login\` again to keep getting alerts.`,
        }).catch((e) => console.error(`Failed to notify ${id}:`, e));
      } else {
        console.error(`Daily check failed for ${id}:`, err);
      }
    }

    await sleep(1500); // be gentle with Riot's API
  }
  console.log('Daily check done');
}
