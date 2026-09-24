# Running on a home server

The same stack as `docs/deploy.md` (live server, web app, Caddy), exposed through a **Cloudflare Tunnel**
instead of open ports:

- No router port forwarding; works behind CGNAT (a shared IP from your provider).
- Your home IP address stays private: visitors only ever reach Cloudflare.
- HTTPS certificates are Cloudflare's; nothing to renew.
- The tunnel is an outbound connection from the server, so nothing on your home network is opened.

`docker-compose.home.yml` runs four containers: `server`, `web`, `caddy` (plain HTTP inside the compose
network, adding the site's security headers and request limits) and `tunnel` (cloudflared).

## 1. The machine

- Linux is simplest (Ubuntu Server 24.04 LTS or similar). Windows 11 works with Docker Desktop on WSL2, and a
  Mac with Docker Desktop or OrbStack.
- 2 GB RAM or more, ~10 GB free disk. Wired Ethernet is better than Wi-Fi for a server.
- It must stay on: turn off sleep and hibernation. On Linux: `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`.
- Install Docker Engine with the compose plugin (<https://docs.docker.com/engine/install/>) and make it start
  at boot: `sudo systemctl enable --now docker`. Containers restart on their own (`restart: unless-stopped`).

## 2. Code, settings and data

```bash
git clone https://github.com/0xjba/Artificial-Bluff.git artificialbluff
cd artificialbluff
cp .env.example .env && chmod 600 .env
```

Fill in `.env`:

```ini
MOCK=1                            # free mock players: start here, switch to 0 for real games
ADMIN_TOKEN=...                   # openssl rand -hex 24
OPENROUTER_API_KEY=...            # only needed for real games
TYPESAFE_API_KEY=...              # only needed for real games
LIVE_BUDGET_USD=1                 # spend cap per live game
CLOUDFLARE_TUNNEL_TOKEN=...       # step 3
```

The study reports are not in git. Copy them from the machine that ran the studies (leave out rehearsals):

```bash
rsync -av --exclude '*-mock' reports/ you@homeserver:~/artificialbluff/reports/
```

Real games also need `lineups/live.json` (`cp lineups/live.example.json lineups/live.json`).

## Try it first (no domain, no account)

```bash
docker compose -f docker-compose.home.yml --profile quick up -d --build server web caddy quick-tunnel
docker compose -f docker-compose.home.yml logs quick-tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

Open the printed address. It changes on every restart and has no uptime guarantee: for trying only. Stop it
with `docker compose -f docker-compose.home.yml --profile quick down`.

## 3. A permanent address

1. Add your domain to Cloudflare (free plan) and change its nameservers at your registrar to the two
   Cloudflare gives you. Wait until Cloudflare shows the domain as active.
2. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Name it
   (e.g. `artificialbluff`), choose **Docker**, and copy the token: the long string after `--token`. Put it
   in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. In the tunnel's **Public Hostname** tab, add: your hostname (e.g. `artificialbluff.com` or
   `poker.yourdomain.com`), service **HTTP**, URL **`caddy:80`**.
4. Start everything:

```bash
docker compose -f docker-compose.home.yml up -d --build
docker compose -f docker-compose.home.yml ps
```

The tunnel shows as **Healthy** in the dashboard within a minute, and the site is live at your hostname.

## 4. Running it

- **Live games**: started through the admin API from the home server itself, as in `docs/deploy.md`
  (`curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:8787/api/admin/games` starts one,
  `.../api/admin/games/stop` ends it after the hand in progress). Port 8787 is bound to localhost only and
  never goes through the tunnel.
- **Updates**: `git pull && docker compose -f docker-compose.home.yml up -d --build`.
- **New study reports**: rsync them into `reports/`; the site reads them as they are, no restart needed.
- **Backups**: the SQLite database is in `data/`; copy that folder.
- **Logs**: `docker compose -f docker-compose.home.yml logs -f web server tunnel`.

## Keeping it smooth

- The spectator feed is a stream (Server-Sent Events) with a heartbeat every 15 seconds, well inside
  Cloudflare's 100-second idle limit, and Caddy passes it through without compressing or buffering it.
- Leave Cloudflare's caching and speed settings at their defaults. Do not enable Rocket Loader, and do not
  add cache rules for `/api/*` or `/research/*` (reports are served with `private` caching so a regenerated
  paper shows at once).
- Home upload speed is the limit on how many spectators can watch at once; the pages themselves are small.
- If the site shows a Cloudflare error page: `docker compose -f docker-compose.home.yml ps` (all four up?),
  then the tunnel's Public Hostname must be `http://caddy:80`, not `localhost`.
