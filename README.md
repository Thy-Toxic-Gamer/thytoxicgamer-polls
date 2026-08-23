# ThyToxicGamer Toxic Poll Center

Public voting and protected poll creation for the ThyToxicGamer community.

## Public voting page

Website:

https://thy-toxic-gamer.github.io/thytoxicgamer-polls/

The public page supports:

- Up to two active polls at once
- A poll switcher when more than one poll is live
- Two to six choices for standard polls
- A dedicated Game Library poll with up to 100 game tiles
- One vote per browser for each poll
- Live, after-voting, or after-closing percentages
- Timers, final winners, ties, cancelled polls, no-vote results, errors, and mobile layouts

Public demo:

https://thy-toxic-gamer.github.io/thytoxicgamer-polls/?demo=1

The demo includes a standard poll and a Game Library poll so the multi-poll switcher can be tested.

## Protected Poll Creator

Creator page:

admin.html

Only a temporary API-issued link can unlock the real creator. Streamer.bot will check whether the requesting chatter is the broadcaster or a moderator before privately sending that one-time link.

Creator demo:

https://thy-toxic-gamer.github.io/thytoxicgamer-polls/admin.html?demo=1

The creator includes nine poll styles:

1. This or That
2. Yes or No
3. Yes / No / Maybe
4. Multiple Choice
5. Rating Scale
6. Agreement Scale
7. Priority Vote
8. Reaction Vote
9. Game Library

Standard polls can run from 30 seconds through 10 minutes. Game Library polls always run for 2 hours and 30 minutes.

## Game Library poll

The Game Library section includes all 92 games supplied for the project. The broadcaster or moderator can search the catalog, select all games, clear the selection, or pick a smaller group.

The tiles use original ThyToxicGamer-style abstract artwork and game initials with the title below. This keeps the directory visually consistent without copying game cover art. If licensed game artwork is provided later, the data model can be extended to use those approved images.

While a Game Library poll is open, the backend creates a reminder event every 30 minutes. Streamer.bot will post the voting link from each reminder event and acknowledge the event only after the Twitch message succeeds.

## Two simultaneous polls

The default maximum is two active polls. The limit can be changed from one through four with the MAX_ACTIVE_POLLS Worker setting.

When the maximum is reached, opening another poll is blocked until an active poll closes or is cancelled.

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
- games.js
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
- wrangler.toml

For a new database, run worker/schema.sql. If version 1 was already initialized, run worker/migration-v2.sql exactly once instead.

Configure a strong ADMIN_KEY as a Cloudflare Worker secret. Never place it in config.js, wrangler.toml, chat messages, screenshots, or GitHub.

After the Worker is published, place its HTTPS URL in config.js as apiBaseUrl.

## Privacy and security

Do not commit Twitch tokens, webhook URLs, Cloudflare credentials, administrator keys, passwords, or private Streamer.bot exports.
