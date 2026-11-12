import type { Client, EmbedBuilder, MessageCreateOptions } from 'discord.js';
import { config } from '../config';
import { accountLabel, getAccounts, getWishlist, usersWithWishlist } from '../db';
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

/**
 * Fetches the fresh shop of every linked account and pings users for wishlist matches.
 * The wishlist is per Discord user and checked against all of their accounts. Run just after the 00:00 UTC reset.
 */
export async function runDailyCheck(client: Client): Promise<void> {
  await ensureAssets();
  const ids = usersWithWishlist();
  console.log(`Daily check: ${ids.length} user(s) with wishlists`);

  for (const discordId of ids) {
    const wanted = new Set(getWishlist(discordId));
    const accounts = getAccounts(discordId);
    const multi = accounts.length > 1;
    const embeds: EmbedBuilder[] = [];

    for (const account of accounts) {
      if (account.needsLogin) continue; // already told them; skip until they /login again
      const where = multi ? ` on **${accountLabel(account)}**` : '';

      try {
        const shop = await getShop(account, { force: true });
        for (const item of shop.daily) {
          if (wanted.has(item.uuid)) embeds.push(skinEmbed(item.uuid, `In your **daily shop**${where} for ${vp(item.cost)}`));
        }
        for (const item of shop.nightMarket ?? []) {
          if (wanted.has(item.uuid)) {
            embeds.push(
              skinEmbed(
                item.uuid,
                `In your **night market**${where} for ${vp(item.discountedCost)} (-${item.discountPercent}%)`,
              ),
            );
          }
        }
      } catch (err) {
        if (err instanceof NeedsLoginError) {
          await notify(client, discordId, {
            content: `<@${discordId}> I couldn't check **${accountLabel(account)}** for wishlist skins: its Riot login expired. Run \`/login\` with that account to keep getting alerts.`,
          }).catch((e) => console.error(`Failed to notify ${discordId}:`, e));
        } else {
          console.error(`Daily check failed for ${discordId} / ${account.puuid}:`, err);
        }
      }

      await sleep(1500); // be gentle with Riot's API
    }

    if (embeds.length) {
      await notify(client, discordId, {
        content: `<@${discordId}> 🎯 a skin from your wishlist is in your shop!`,
        embeds: embeds.slice(0, 10),
      }).catch((e) => console.error(`Failed to notify ${discordId}:`, e));
    }
  }
  console.log('Daily check done');
}
