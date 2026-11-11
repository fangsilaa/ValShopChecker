# valshoptracker

A private Discord bot that shows each linked user their Valorant **daily shop**, **featured bundle** and **night market**, and pings them when a **wishlisted skin** shows up.

> ⚠️ Riot has no official store API. This uses the same unofficial endpoints the game client uses, and asks users for their Riot `ssid` cookie. That goes against Riot's developer policy. It's fine for you and some friends, but use it at your own risk and don't make it public.

## Commands

| Command | What it does |
|---|---|
| `/login` | Link your Riot account (paste your `ssid` cookie or the redirect URL) |
| `/logout` | Unlink and delete your stored tokens |
| `/shop` | Your 4 daily skins with prices |
| `/bundle` | Current featured bundle(s) |
| `/nightmarket` | Your night market, when it's running |
| `/rank [user]` | Competitive rank, RR, last game's RR change and this act's record (public reply). Pick a user to see a friend's rank (they must have linked with `/login`) |
| `/wishlist [skin]` | Pick a skin to add it (or remove it if it is already on your list). Leave empty to see your list. At 00:02 UTC the bot checks everyone's shop and pings matches |

All replies are only visible to you. Wishlist alerts go to `ALERT_CHANNEL_ID`, or by DM if that isn't set.

## Setup

1. Install **Node.js 22.13+** (uses the built-in `node:sqlite`, so nothing needs compiling) (e.g. `winget install OpenJS.NodeJS.LTS`).
2. Create an app at https://discord.com/developers/applications, then:
   - **Bot** tab → *Reset Token* → copy it into `DISCORD_TOKEN`.
   - **General Information** → copy *Application ID* into `DISCORD_CLIENT_ID`.
   - **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`, permissions *Send Messages* + *Embed Links* → open the URL and add the bot to your server.
3. Copy `.env.example` to `.env` and fill it in. Get `DISCORD_GUILD_ID` from right-click server → *Copy Server ID* (enable Developer Mode in Discord settings). Generate `ENC_KEY` after `npm install` with `npm run gen-key`.
4. Install and run:
   ```sh
   npm install
   npm run dev            # development (tsx)
   # or
   npm run build && npm start
   ```
5. In Discord: `/login`, then `/shop`.

Test the wishlist alert without waiting for reset: add a skin that's currently in your shop with `/wishlist skin:<name>`, then run `npm run check-now`.

## Deploying to a Linux server

`deploy.ps1` builds locally, uploads to an Ubuntu box over SSH, installs Node 22 + a 2 GB swap file if needed, and runs the bot as the `valshop` systemd service:

```powershell
.\deploy.ps1 -Server ubuntu@<server-ip>    # add -Key C:\path\to\key if not ~/.ssh/id_ed25519
```

The first deploy copies your local `.env`; later deploys leave the server copy alone. Logs: `ssh ubuntu@<server-ip> "journalctl -u valshop -f"`.

## How it works

- **Login:** users sign in on Riot's own page, which handles the captcha and 2FA. The bot gets either the token URL (lasts about 1h) or the `ssid` cookie. With the cookie, the bot silently gets new access tokens from `auth.riotgames.com/authorize` until it expires (a few weeks). Then the user is told to `/login` again.
- **Shop:** `POST https://pd.{shard}.a.pvp.net/store/v3/storefront/{puuid}`, with the entitlements token and client version (from valorant-api.com). Results are cached in SQLite until the daily reset.
- **Names and images:** [valorant-api.com](https://valorant-api.com), reloaded every 24h.
- **Storage:** `data/bot.sqlite`. Cookies and tokens are AES-256-GCM encrypted with `ENC_KEY`.

## Troubleshooting

- **"Riot blocked the re-auth request (403)"**: Riot's Cloudflare sometimes rejects non-browser TLS fingerprints. Wait and retry. If it keeps happening, link with the redirect URL as a temporary workaround, and look at how [SkinPeek](https://github.com/giorgi-o/SkinPeek) currently handles auth. Riot changes this flow occasionally.
- **Region is wrong**: auto-detection needs the `id_token`, which only the URL login provides. Cookie login also returns one. If detection fails, `DEFAULT_REGION` is used.
- **Commands don't show up**: make sure the bot was invited with the `applications.commands` scope and that `DISCORD_GUILD_ID` is correct.
