# ThyToxicGamer Toxic Poll Center

Public voting and protected poll creation for the ThyToxicGamer community.

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

Only a temporary API-issued link can unlock the real creator. Streamer.bot will check whether the requesting chatter is the broadcaster or a moderator before privately sending that one-time link.

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

The Cloudflare Worker must also have `MAX_ACTIVE_POLLS=3` so the backend enforces the same limit.



## Temporary creator access

1. Streamer.bot calls POST /api/admin/sessions with the private ADMIN_KEY.
2. The API returns a one-time creator link that expires in 5 minutes.
3. The creator page exchanges it for a 30-minute browser session.
4. The one-time token is immediately removed from the browser address.
5. All create, close, and cancel requests are authorized by the API.

The GitHub Pages files contain no administrator key, Twitch token, or permanent creator credential.

## Streamer.bot event routes

The later Streamer.bot phase will use:

- POST /api/admin/sessions
- GET /api/events/pending
- POST /api/events/{eventId}/ack
- GET /api/polls/active

Opening, reminding, closing, expiring, or cancelling a poll creates a pending event with a ready-to-post Twitch chat message.

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

## Cloudflare Worker and D1

GitHub Pages hosts the interface. The included Cloudflare Worker and D1 schema store shared polls, votes, temporary creator sessions, and Streamer.bot events.

Backend source:

- worker/index.js
- worker/schema.sql
- worker/migration-v2.sql
- wrangler.toml.example

For a new database, run worker/schema.sql. If version 1 was already initialized, run worker/migration-v2.sql exactly once instead. Copy wrangler.toml.example to wrangler.toml and replace the D1 placeholders before deploying with Wrangler.

Configure a strong ADMIN_KEY as a Cloudflare Worker secret. Never place it in config.js, wrangler.toml, chat messages, screenshots, or GitHub.

After the Worker is published, place its HTTPS URL in config.js as apiBaseUrl.

## Privacy and security

Do not commit Twitch tokens, webhook URLs, Cloudflare credentials, administrator keys, passwords, or private Streamer.bot exports.
