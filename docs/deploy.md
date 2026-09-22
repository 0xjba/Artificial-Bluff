# Deploying to a VPS

One `docker compose up` runs three containers:

| Service | What it runs | Reachable from |
| --- | --- | --- |
| `server` | live server (`apps/server`): table, replays, spectator feed, admin API | the VPS only (`127.0.0.1:8787`) |
| `web` | Next.js site (`apps/web`), which proxies the public read API to `server` | `caddy` only |
| `caddy` | HTTPS (automatic Let's Encrypt certificates) in front of `web` | the internet (ports 80, 443) |

The SQLite database lives in `./data`, study reports in `./reports` (read-only for the site), and line-ups in
`./lineups`. All three are folders next to `docker-compose.yml`, so backups and inspection are plain file work.

## 1. The VPS

- Any Linux VPS with 1 vCPU and 1 GB RAM or more (2 GB makes the first image build faster), x86-64 or ARM64.
- Install Docker Engine with the compose plugin: <https://docs.docker.com/engine/install/>.
- Point a DNS name at the VPS: an `A` record (and `AAAA` for IPv6) such as `poker.example.com`.
- Open ports 80 and 443 in the firewall (both are needed: Let's Encrypt checks port 80). Keep 8787 closed.

## 2. Get the code

```bash
git clone https://github.com/0xjba/Artificial-Bluff.git artificialbluff
cd artificialbluff
```

## 3. Settings and keys

Create `.env` next to `docker-compose.yml`. It is git-ignored and never copied into the image.

```bash
cp .env.example .env
chmod 600 .env
```

Fill in:

```ini
DOMAIN=poker.example.com          # the DNS name from step 1
OPENROUTER_API_KEY=...            # real players (LLM seats)
TYPESAFE_API_KEY=...              # the Jev seat
ADMIN_TOKEN=...                   # 16+ random characters: openssl rand -hex 24
LIVE_BUDGET_USD=1                 # spend cap per live game
# MOCK=1                          # free mock players (try the whole stack first without spending)
```

The other settings in `.env.example` (pace, timeouts, cooldown between replays) work as they are. `HOST`,
`PORT`, `DB_PATH` and `LINEUP` are set by `docker-compose.yml` and don't need to be in `.env`.

## 4. The line-up

Real games need `lineups/live.json` (git-ignored):

```bash
cp lineups/live.example.json lineups/live.json
```

Edit the models in it if you like. With `MOCK=1` the file is optional.

## 5. Start

```bash
docker compose up -d --build
docker compose logs -f server      # Ctrl-C leaves it running
```

The first build takes a few minutes. Then open `https://poker.example.com`: with no game running, the site
shows replays of past games (none yet on a fresh install) or the waiting card.

## 6. Start and stop live games

Live games cost money, so they only start when you ask. SSH into the VPS, then:

```bash
source .env
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:8787/api/admin/games
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:8787/api/admin/games/stop   # ends after the hand in progress
```

Each game ends by itself when it has a winner or reaches its `LIVE_BUDGET_USD` cap. To run games on a schedule, add
the start command to the VPS's crontab (`crontab -e`). For example, a game at 18:00 every day:

```cron
0 18 * * * cd /home/you/artificialbluff && . ./.env && curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:8787/api/admin/games
```

A start while a game is already running is refused (HTTP 409). Spend per day is (games per day) × `LIVE_BUDGET_USD`
at most.

## 7. Study reports on /research

Studies run from a workstation (`pnpm study ...`, see `CLAUDE.md` and `docs/STATUS.md`), not on the VPS. To publish a
report, copy its folder into `reports/` on the VPS:

```bash
rsync -a reports/<study-id>/ you@vps:artificialbluff/reports/<study-id>/
```

The research page reads the folder on each request, so no restart is needed.

## Run your own table (/play)

Visitors can run tables with their own keys at `/play`. The game runs in their browser, so it costs the server nothing.
Jev seats are the one exception: TypeSafe doesn't accept browser calls yet, so the `web` container relays Jev calls to
`https://api.typesafe.ai` with the visitor's key. The key is never stored or logged. Calls are limited to 120 per minute
per client and 3,000 per minute in total, and Caddy caps their bodies at 64 KB. No settings are needed, as long as outbound HTTPS from the VPS is allowed.

## Updating

```bash
git pull
docker compose up -d --build
```

The server stops after the hand in progress (it gets up to 3 minutes), so a running live game ends there and is
marked interrupted. Update between games if you can.

## Backups

`data/live.db` holds every event of every game. A consistent copy while the server runs:

```bash
docker compose exec -w /app/packages/core server node -e "require('better-sqlite3')('/app/data/live.db').backup('/app/data/backup.db').then(() => console.log('ok'))"
```

Then copy `data/backup.db` off the machine. The `caddy_data` volume holds the certificates. Losing it only means
Caddy requests new ones.

## Troubleshooting

- **Certificate errors / site unreachable**: check the DNS record points at the VPS, and ports 80 and 443 are open.
  Then read `docker compose logs caddy`.
- **"another live server is using data/live.db"**: two stacks share the `data` folder. Stop the other one. The
  compose command clears a lock left by a killed container of this stack.
- **No live updates on the page**: the spectator feed is Server-Sent Events. A CDN or proxy in front of Caddy
  must not buffer `text/event-stream` responses (e.g. Cloudflare: use DNS only, or disable buffering).
- **Health check**: `curl http://127.0.0.1:8787/api/health` on the VPS.
