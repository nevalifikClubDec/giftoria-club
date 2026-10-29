# Giftoria-style Telegram Mini App (demo)

Original demo game inspired by collectible/case-opening interfaces. It is not affiliated with Giftoria.
Includes a Telegram Mini App frontend, Express API, SQLite persistence, test coins, profile, cases, and server-side admin authorization by Telegram ID.

## Requirements
- Node.js 20+
- Telegram bot token from @BotFather
- Public HTTPS URL for deployment
- Your numeric Telegram user ID

## Setup
1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS` (comma-separated numeric IDs), and `APP_ORIGIN`.
3. Run:
   ```bash
   npm install
   npm start
   ```
4. Set the bot's Mini App URL in BotFather to your deployed HTTPS URL.
5. For local browser preview, set `DEV_AUTH=true`; this only enables a clearly marked local demo identity and should NEVER be enabled in production.

## Security notes
- In production, Telegram `initData` is verified on the server using `BOT_TOKEN`; the client does not decide whether someone is an admin.
- Admin actions require a verified Telegram identity and an ID listed in `ADMIN_TELEGRAM_IDS`.
- Do not commit `.env`. Use HTTPS and a persistent disk for SQLite, or replace SQLite with a managed database for multi-instance deployments.
- Coins are fictional demo points and have no cash value. Case outcomes are demo-only.
