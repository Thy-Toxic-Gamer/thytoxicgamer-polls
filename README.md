# ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆ 𝐓☣︎𝐱𝐢c Poll Center

Public voting and protected poll creation for  ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆ community.

## Current public release

**Ver. 1.0 — Unified Central Command release — September 1, 2026**

## Public voting page

Website:

https://thy-toxic-gamer.github.io/thytoxicgamer-polls/

The public page supports:

- Up to three active polls at once
- A poll switcher when more than one poll is live
- Two to ten answers per poll
- One vote per browser for each poll
- Live, after-voting, or after-closing percentages
- Timers, final winners, ties, cancelled polls, no-vote results, errors, and mobile layouts

Public demo:

https://thy-toxic-gamer.github.io/thytoxicgamer-polls/?demo=1

The demo includes three standard polls so the multi-poll switcher can be tested at the full supported limit.

## Protected Poll Creator

Creator page:

admin.html

The real creator uses the existing Supabase Twitch login. The Owner receives persistent access until signing out, while moderators must be explicitly added to `poll_staff`.

Creator demo:

https://thy-toxic-gamer.github.io/thytoxicgamer-polls/admin.html?demo=1

The creator now uses one simple poll format:

- Type any poll question
- Start with two answers
- Add answers as needed, up to ten total
- Remove answers while keeping at least two
- Choose a voting time from 30 seconds up to 30 minutes
- Choose when percentages become visible: live, after voting, or after closing

## Three simultaneous polls

Up to three polls can be active at the same time. When three polls are already live, the creator blocks another poll until one closes or is cancelled.

The Supabase database operation also enforces the same three-poll maximum.



## Owner and moderator access

1. Poll Creator signs in through the Supabase Twitch provider.
2. The Edge Function verifies the Twitch access token with Supabase Auth.
3. The authenticated user must have an active `poll_staff` record.
4. Owner and moderator roles can create, edit, close, and cancel active polls.
5. Sessions persist securely until the user signs out or Supabase invalidates them.

The GitHub Pages files contain only the public Supabase publishable key. They contain no service-role key, Twitch token, webhook, password, or permanent private credential.

## Direct Twitch announcements

Poll Center does not require Streamer.bot for poll announcements. The Supabase Edge Function sends voting links directly through Twitch's Send Chat Message API as `ThyToxicBot`.

- Twitch OAuth tokens are encrypted with Supabase Vault.
- Access tokens refresh automatically using the stored rotating refresh token.
- Each `poll_opened` event records pending, sent, or failed delivery state.
- Poll Creator shows delivery health and includes a Resend to Twitch control.
- A failed Twitch message never destroys or rolls back the live poll.
- The protected Completed Poll Archive supports search, status filters, final results, and pagination.
- Completed and cancelled polls are automatically deleted 30 days after their status changes.

Required Edge Function secrets:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_BOT_LOGIN=thytoxicbot`
- `TWITCH_BROADCASTER_LOGIN=thytoxicgamer`

The Twitch application must allow this OAuth redirect URL:

`https://hdwhhyrlmktiynyujozk.supabase.co/functions/v1/poll-center-api/api/twitch/callback`

## GitHub Pages files

Upload these flat files to the repository root:

- index.html
- styles.css
- app.js
- admin.html
- admin.css
- admin.js
- config.js
- toxic-poll-banner.webp
- toxic-poll-background.webp
- toxic-poll-banner.png

Publish GitHub Pages from the main branch and repository root.

## Supabase backend

GitHub Pages hosts the interface. Supabase Auth verifies Twitch users, Postgres stores shared polls and votes, and the `poll-center-api` Edge Function handles public and staff operations.

Backend source:

- `supabase/migrations/202609010001_poll_center.sql`
- `supabase/migrations/202609010002_poll_operations.sql`
- `supabase/migrations/202609010003_service_role_grants.sql`
- `supabase/migrations/202609010004_twitch_chat_delivery.sql`
- `supabase/migrations/202609010005_poll_archive_retention.sql`
- `supabase/functions/poll-center-api/index.ts`
- `supabase/functions/poll-archive-api/index.ts`

The migrations use isolated `poll_*` objects inside the shared Polls | Appeals Center project. Row Level Security denies direct browser writes. The Edge Function uses server-only Supabase credentials and validates every staff action.

## Privacy and security

Do not commit Twitch tokens, client secrets, webhook URLs, Supabase secret/service-role keys, or passwords.
