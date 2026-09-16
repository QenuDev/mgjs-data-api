# Magic Garden API

> **Unofficial API** for [Magic Garden](https://magicgarden.gg) that fetches game data **dynamically** and **future-proof**.

## Concept

This API automatically extracts game data from **two sources**:

### **Minified bundle** → Static game data
Automatic extraction from the game's minified JavaScript file (`main-*.js`):
- Plants, seeds, crops
- Pets and eggs
- Items and decorations
- Mutations
- Special abilities
- Weathers

### **Official platform API** → Live data
Polling of the game's own `/platform/v1` endpoints for dynamic data:
- Current shops (inventory, exact restock date, countdown)
- Current weather

## Advantages

- **Future-proof**: Automatically adapts to game updates
- **No maintenance**: No need to manually update data
- **Live data**: Shops and weather from the game's official API, restock dates included
- **Sprites included**: URLs and direct sprite downloads
- **Smart cache**: Optimal performance

## Fork, upstream and licence

This repository is a fork of [Magic-garden-API](https://github.com/Ariedam64/Magic-garden-API), by
[@Ariedam64](https://github.com/Ariedam64), published as
[QenuDev/mgjs-data-api](https://github.com/QenuDev/mgjs-data-api).

Upstream is ISC-licensed (`package.json` and the licence section of its README), and this fork keeps
that licence: [`NOTICE`](NOTICE) records the origin, the copyright and what the fork changes. The
bundle extraction is upstream's work; what this fork adds is a contract a client can check before it
trusts a URL — the contract version in the OpenAPI document, `GET /schema.json` serving the same
facts flat, and `GET /data/version` for the version the served data was built from.

## Hosted API

Upstream runs its own deployment at `https://mg-api.ariedam.fr`, and the examples in this README use
it because the API is the same one. This fork is a separate instance: the host a client calls is the
one that instance's operator configured, and `GET /schema.json` on that host reports the contract
version, the capabilities and the game version the data was built from, so a client can check what
it is talking to rather than assume it.

## Quick Start

### Requirements

- Node.js >= 18

### Installation

```bash
npm install
```

### Launch

```bash
# Development mode (with watch)
npm run dev

# Production mode
npm start
```

The server starts on `http://localhost:3000`

### Running it as a service

The repository carries what you need to run this on a host rather than on your laptop, and until now
nothing here pointed at it:

```bash
cp .env.example .env      # every setting, with what it does
docker compose up -d      # the API on :3002, plus the sprite exporter
```

- **`docker-compose.yml`** runs two services: the API and the sprite exporter. `NODE_ENV=production`
  is required rather than cosmetic — the image is built without devDependencies, and without it the
  logger's pretty transport fails to resolve before `app.listen`. `PORT` is pinned to 3002 because the
  code's default is 3000 while the reverse-proxy config proxies to 3002.
- **`.env.example`** documents every setting, including `SPRITES_PROFILE=data` for a host that serves
  data only and must not spend disk or CPU exporting an atlas.
- **Add `--build`** (`docker compose up -d --build`) when you want the tree in front of you rather than a
  published image. The compose file names `mg-api:2.0.0`, so a plain `up` uses that image if it is already on
  the machine — which is the right default on a host pulling releases and a silent surprise on a host that has
  just changed the code. Measured on this machine: `mg-api:2.0.0` and a fresh build of the same tree are both
  357 MB and both answer, so nothing tells them apart from the outside.
- **`nginx.conf`** is not started by the compose file. It is the reverse-proxy configuration to install
  in front if you want one — TLS, caching and a published sprite directory served straight off disk,
  which is faster than going through Node. The API works without it.
- **`SPRITES_BASE_URL` and `API_PUBLIC_URL`** are both empty by default, deliberately: the API then
  builds every URL it hands out from the request that asked for it, so the answer names the host the
  client actually reached, on any port or proxy name. Set them only when the public URL genuinely
  differs from the one the process sees.

Measured on this tree rather than assumed: the image builds at **357 MB**, boots on the data-only
profile, answers `/health`, `/schema.json` and `/data/version`, and refuses image routes with a named
`SPRITES_PROFILE` error rather than a 404.

## Main Endpoints

### Game data (bundle)

| Endpoint | Description |
|----------|-------------|
| `GET /data` | All game data (plants, pets, items, decor, eggs, mutations, abilities) |
| `GET /data/plants` | Complete plants (seed/plant/crop + sprites) |
| `GET /data/pets` | Companion pets with sprites |
| `GET /data/items` | Items and equipment with sprites |
| `GET /data/decors` | Decorations with sprites |
| `GET /data/mutations` | Plant mutations with sprites |
| `GET /data/eggs` | Animal eggs with sprites |
| `GET /data/abilities` | Special abilities (with tooltip descriptions) |
| `GET /data/weathers` | Weather definitions with sprites |
| `GET /data/weather-groups` | Weather scheduling engine: duration, time slots and weighted drop table per group (Hydro, Lunar) |
| `GET /data/enums` | Canonical game enums (rarity, currency, eligibleShops, itemType, weather, mutationTierOrder) |

#### Ability descriptions

`/data/abilities` exposes the in-game tooltip text as `description`, in English.
Placeholders `<0/>`, `<1/>`, ... stand for icons; `descriptionTokens` says what
each one is, in order:

```json
"MoonKisser": {
  "name": "Amberbinder",
  "color": "#FAA623",
  "description": "Chance to replace <0/> with <1/> mutation on surrounding crops during Amber Moon",
  "descriptionTokens": [
    { "type": "mutation", "id": "Ambershine" },
    { "type": "mutation", "id": "Ambercharged" }
  ]
}
```

A token `type` is `mutation`, `item`, `crop`, `currency`, `rarity` or `unknown`,
and its `id` points at the matching `/data/*` entry (or enum value). Replace each
placeholder with the token's icon, or with its `id` for plain text. The numbers
(probability, cooldown) are not in the sentence - read them from
`baseProbability` / `baseParameters`.

### CSV / TSV Export

Every data and live endpoint is also available in **CSV** (`.csv`) and **TSV** (`.tsv`) format by appending the extension to the URL. For example: `/data/plants.csv`, `/data/pets.tsv`, `/live/shops.csv`. Ideal for Excel, Google Sheets (`=IMPORTDATA(...)`), or any spreadsheet tool.

### Assets

| Endpoint | Description |
|----------|-------------|
| `GET /assets/sprite-data` | Sprite metadata (with search) |
| `GET /assets/cosmetics` | Cosmetic data |
| `GET /assets/audios` | Audio data |
| `GET /assets/sprites` | List available sprite categories |
| `GET /assets/sprites/:category/:name` | Download individual sprite PNG |
| `GET /assets/sprites/composed?key=…&mutations=…` | Pre-composed PNG with mutations applied |
| `GET /assets/animations` | Catalog of animated loops (pets + decor) |
| `GET /assets/animations/:category/:name_:clip.webp` | Download one looping animation |
| `GET /assets/rive` | The game's Rive (vector) files and what they contain |

**Available sprite categories**: `seeds`, `plants`, `tallPlants`, `mutations`, `pets`, `decor`, `items`, `objects`, `ui`, `animations`, `weather`, `tiles`, `winter`

Note: `/assets/sprite-data`, `/assets/cosmetics`, and `/assets/audios` return URLs pointing to the game's versioned asset base. `/assets/sprites` serves PNGs from this API (controlled by `SPRITES_BASE_URL`).

Pets are the only creatures the game renders as vectors (`rive/pets.riv`) rather than sprites, so on top of the still PNG the API serves them **animated**: one looping WebP per species and per state (`idle`, `walk`, `eat`, `sleep`). Each pet also carries a `rive` block - the vector source itself, for clients that can render it live: 3 MB covers every species and all their timelines. And because that file ships ahead of the game data, `/data/pets` lists species the game has not released yet, flagged `released: false`.

The eight animated decorations (windmill, fountain, cauldron, …) get the same treatment from `rive/decor.riv`, attached to `/data/decors` - including `WeatherStation` and `BoobooBooth`, which exist only in the Rive file. The loops are pre-rendered when the game ships a new pet file and served as plain files - drop the URL in an `<img>` tag and it plays, no runtime needed. They are also attached to each species in `/data/pets` under `animations`. See `doc-rive.md` §7.

The composed endpoint accepts a full atlas key (e.g. `sprite/tallplant/Cactus`) and an optional comma-separated list of mutations. It returns a single PNG with all layers merged (color filters, icons, overlays), composed into the **tight union** of the crop's art and the layers drawn over it, plus an `X-MG-Sprite-Box` header (or `?format=layout` in a JSON body) stating the crop art's own rectangle inside that picture. The only layer still clipped is the tall-plant overlay, which the game itself masks to the crop body's own texture. See `doc-sprite.md` for the full spec.

### Live data (Real-time via SSE)

| Endpoint | Description |
|----------|-------------|
| `GET /live` | All live data snapshot (weather + shops) |
| `GET /live/weather` | Current weather snapshot |
| `GET /live/shops` | Current shops snapshot |
| `GET /live/health` | Poller freshness + SSE connection stats |
| `GET /live/stream` | Weather + shops updates via Server-Sent Events |
| `GET /live/weather/stream` | Weather updates via Server-Sent Events |
| `GET /live/shops/stream` | Shop updates via Server-Sent Events |

### Stats (Aggregated history)

Backed by a local SQLite history of every shop restock and weather transition observed since the recorder was first enabled. Useful for drop-rate dashboards, weather distributions, and intra-bucket timelines.

| Endpoint | Description |
|----------|-------------|
| `GET /stats/items` | Per-item rarity stats for a shop (appearances, drop rate, stock distribution, last seen) |
| `GET /stats/items/timeseries` | Drop rate / appearances / avg stock per time bucket for one or more items |
| `GET /stats/weather` | Weather distribution over a window (total duration, share, occurrences, avg duration) |
| `GET /stats/weather/timeseries` | Weather durations per time bucket (stacked-area-friendly) |
| `GET /stats/weather/events` | Raw weather event timeline clamped to the window |
| `GET /stats/shops/restocks` | Raw shop restock timeline with embedded items (supports `ids` filter) |

**Common query parameters:**
- `shop` (required for `/stats/items*` and `/stats/shops/restocks`): any shop id listed by `/data/enums` -> `eligibleShops` (`seed`, `tool`, `egg`, `decor`, `rain`, `dawn`, `amber`, `snow`, `thunder`, ...)
- `from` / `to`: epoch ms or ISO 8601 (default: last 30 days)
- `bucket` (timeseries only): `hour`, `day`, `week` (UTC-aligned, hard cap 10 000 buckets per response)
- `ids` (optional, comma-separated): restrict `/stats/items/timeseries` and `/stats/shops/restocks` to specific item ids
- `limit` / `order`: paging on raw event endpoints

### Health & Information

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server and connection status |
| `GET /health/ready` | Readiness probe (checks if bundle is cached) |
| `GET /health/live` | Liveness probe |
| `GET /docs` | Swagger UI documentation |
| `GET /docs/openapi.json` | OpenAPI specification (JSON) |

## Usage Examples

### Get all game data

```bash
curl http://localhost:3000/data | jq
```

**Response structure:**
```json
{
  "plants": { ... },
  "pets": { ... },
  "items": { ... },
  "decor": { ... },
  "eggs": { ... },
  "mutations": { ... },
  "abilities": { ... },
  "weathers": { ... },
  "weatherGroups": { ... },
  "enums": { ... }
}
```

### Get plant data

```bash
curl http://localhost:3000/data/plants | jq '.Carrot'
```

**Response:**
```json
{
  "seed": {
    "name": "Carrot Seed",
    "coinPrice": 10,
    "sprite": "http://localhost:3000/assets/sprites/seeds/Carrot.png"
  },
  "plant": {
    "name": "Carrot Plant",
    "harvestType": "Single",
    "sprite": "http://localhost:3000/assets/sprites/plants/BabyCarrot.png"
  },
  "crop": {
    "name": "Carrot",
    "baseSellPrice": 20,
    "sprite": "http://localhost:3000/assets/sprites/plants/Carrot.png"
  }
}
```

### Search for a sprite

```bash
curl "http://localhost:3000/assets/sprite-data?search=Carrot&cat=seeds"
```

### List sprite categories

```bash
curl http://localhost:3000/assets/sprites
```

### Download a sprite

```bash
curl http://localhost:3000/assets/sprites/seeds/Carrot.png -o carrot.png
```

### Get live shop data

```bash
curl http://localhost:3000/live/shops | jq
```

### Stream live updates (SSE)

```bash
curl -N http://localhost:3000/live/stream
```

SSE events are named `weather` and `shops`. Use `addEventListener` to subscribe.

### Live health (SSE stats)

```bash
curl http://localhost:3000/live/health | jq
```

```javascript
const liveStream = new EventSource('http://localhost:3000/live/stream');
liveStream.addEventListener('weather', (event) => {
  const data = JSON.parse(event.data);
  console.log('Weather:', data.weather);
});

liveStream.addEventListener('shops', (event) => {
  const shops = JSON.parse(event.data);
  console.log('Seed shop:', shops.seed);
});
```

You can also subscribe to specific streams with `/live/weather/stream` or `/live/shops/stream`.

### Get canonical enums

```bash
curl http://localhost:3000/data/enums | jq
```

**Response:**
```json
{
  "rarity": ["Common", "Uncommon", "Rare", "Legendary", "Mythical", "Divine", "Celestial"],
  "currency": ["coins", "credits", "magicDust"],
  "eligibleShops": ["seed", "egg", "tool", "decor", "dawn"],
  "itemType": ["Seed", "Produce", "Plant", "Tool", "Pet", "Egg", "Decor"],
  "weather": ["Rain", "Frost", "Thunderstorm", "Dawn", "AmberMoon"],
  "mutationTierOrder": ["Wet", "Chilled", "Frozen", "Thunderstruck", "Dawnlit", "Ambershine", "Dawncharged", "Ambercharged"]
}
```

### Query aggregated stats

```bash
# Top rare seeds over the last 30 days (sorted rarest first by default)
curl "http://localhost:3000/stats/items?shop=seed" | jq

# Daily drop rate of Carrot vs Strawberry over a custom window
curl "http://localhost:3000/stats/items/timeseries?shop=seed&ids=Carrot,Strawberry&bucket=day&from=2026-04-01&to=2026-05-01" | jq

# Weather distribution over the last week
curl "http://localhost:3000/stats/weather?from=2026-05-12&to=2026-05-19" | jq

# Find every restock containing a specific Celestial seed
curl "http://localhost:3000/stats/shops/restocks?shop=seed&ids=Starweaver&limit=20" | jq
```

### Export data as CSV / TSV

Append `.csv` or `.tsv` to any data or live endpoint (e.g. `/data/plants.csv`, `/live/shops.tsv`).

```bash
curl https://mg-api.ariedam.fr/data/pets.csv -o pets.csv
```

In Google Sheets: `=IMPORTDATA("https://mg-api.ariedam.fr/data/pets.csv")`

## Technical Architecture

```
┌─────────────────────────────────────────────┐
│           Magic Garden Game                 │
│  ┌──────────────┐      ┌───────────────┐   │
│  │ Bundle JS    │      │  Platform API │   │
│  │ (minified)   │      │ /platform/v1  │   │
│  └──────┬───────┘      └───────┬───────┘   │
└─────────┼──────────────────────┼───────────┘
          │                      │
          ▼                      ▼
┌─────────────────────────────────────────────┐
│              MG API Server                  │
│                                             │
│  ┌─────────────┐      ┌─────────────────┐  │
│  │   Bundle    │      │  Live Poller    │  │
│  │ Extraction  │      │                 │  │
│  │             │      │ • Shops+weather │  │
│  │ • Resolver  │      │ • Restock-aware │  │
│  │ • Extractor │      │ • Normalizing   │  │
│  │ • Sandbox   │      │ • Event stream  │  │
│  └──────┬──────┘      └────────┬────────┘  │
│         │                      │           │
│         ▼                      ▼           │
│  ┌─────────────────────────────────────┐   │
│  │         Cache & Services            │   │
│  │  • Game data (5min TTL)             │   │
│  │  • Sprite resolution                │   │
│  │  • Live data normalizing            │   │
│  └──────────────┬──────────────────────┘   │
│                 │                          │
│                 ▼                          │
│  ┌─────────────────────────────────────┐   │
│  │         REST API + SSE              │   │
│  │  • /data/*     (bundle data)        │   │
│  │  • /assets/*   (sprites, cosmetics) │   │
│  │  • /live       (real-time via SSE)  │   │
│  │  • /stats/*    (history aggregates) │   │
│  │  • /health     (monitoring)         │   │
│  │  • /docs       (OpenAPI/Swagger)    │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Key Components

- **Bundle Resolver**: Detects and downloads the game's JS bundle
- **Extractors**: Parse data from the minified bundle (regex + VM sandbox)
- **Live Poller**: Polls the game's official `/platform/v1/{shops,weather}` endpoints, and wakes up right on each `nextRestockAt` the game announces
- **Normalizers**: Map the official payloads onto our public shape
- **Version Watcher**: Polls `/platform/v1/version` and resyncs sprites on a game update
- **SSE Streams**: Real-time data streaming via Server-Sent Events
- **Sprite Sync**: Automatic sprite synchronization
- **Cache**: Smart caching with automatic invalidation
- **API Routes**: RESTful endpoints for static data + SSE for live data

## Configuration

Environment variables (create a `.env` file):

```env
# Server
HOST=0.0.0.0
PORT=3000
NODE_ENV=development

# Cache (in milliseconds)
CACHE_BUNDLE_TTL=300000
CACHE_MANIFEST_TTL=600000

# Live polling of the game's official API
PLATFORM_POLL_INTERVAL=15000
PLATFORM_FAST_POLL_INTERVAL=5000
PLATFORM_MAX_BACKOFF=60000
PLATFORM_TIMEOUT=8000

# Bundle fetch (page -> index.js -> chunks -> data), on the /data/* path
BUNDLE_TIMEOUT=20000

# Game update detection (sprite resync)
VERSION_WATCH_ENABLED=true
VERSION_WATCH_INTERVAL=60000
VERSION_WATCH_RESTART=true

# Service profile (see "Deployment profiles" below)
SPRITES_PROFILE=full

# CORS
CORS_ENABLED=true
CORS_ORIGIN=*

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Game origin
GAME_ORIGIN=https://magicgarden.gg
GAME_PAGE_URL=https://magicgarden.gg/r/test

# Logging
LOG_LEVEL=info
LOG_PRETTY=false                   # pino-pretty is a devDependency; opt in, never assumed

# Sprites
SPRITES_EXPORT_DIR=./sprites_dump
SPRITES_BASE_URL=http://localhost:3000

# The opt-in crop bake
BAKE=0                             # 1 renders every crop type over its reachable mutation sets
BAKE_DIR=                          # default: <SPRITES_EXPORT_DIR>/baked

# Pet animations (looping WebP/GIF rendered from the game's Rive file)
PET_ANIMATIONS_ENABLED=true
PET_ANIMATIONS_FORMATS=webp        # add ",gif" to also generate GIFs (doubles disk usage)
PET_ANIMATIONS_HEIGHT=256          # rendered subject height, in pixels
PET_ANIMATIONS_QUALITY=20          # WebP near-lossless level (lower = smaller)
PET_ANIMATIONS_CLIPS=idle,walk,eat,sleep
```

Animations are rendered at 30 fps, near-lossless, in a background child process when the game's pet file changes (~100 MB and ~50 minutes for the full set). `PET_ANIMATIONS_QUALITY` is a near-lossless level, not a lossy quality - lossy is a poor fit for this flat vector art, see `doc-rive.md` §7. Run it by hand with `npm run export:animations -- --force`.

### The crop bake (`BAKE=1`)

Off by default. With the flag off, a request for a crop wearing mutations composites the PNGs the sprite export already wrote, in memory, and nothing is written to disk: the only growth is the capped scene cache. With `BAKE=1` the version watcher also renders every *crop type* wearing each of its reachable mutation sets to a file and publishes a manifest of what exists — the product of (mutation category size + 1) over the game's categories, which the mutation table's own `group` field defines. It is a pre-warming option for a host that serves the same sets at high volume, not a prerequisite for a cheap request: a host with the flag off and a host with it on answer the same URLs, and only the first request differs.

It bakes crops, never whole plants. A crop wearing mutations is a bounded set; a plant picture is the pot, the platform, the body, its crops and the celestial layers, so its space is that set to the power of the plant's crop-slot count — which is why a plant is not on disk.

The layout is `<BAKE_DIR>/<layout>/<game-version>/crops/<species>/<set>.png` with the published manifest at `<BAKE_DIR>/manifest.json`, swapped in with a `rename` only once the last picture is on disk, so a half-baked version is never advertised and the previous one keeps serving until the swap. The `<layout>` segment names the shape of the pictures (`v2` today — the union box; `v1` was the clamped one); a change to how a picture is composed bumps it, so a tree baked under the old shape is neither served nor resumed. A run killed partway through resumes: every picture already written and decodable is reused, and its box is restated from the atlas metadata (`composedBox()`), which needs no pixels. A set the bake did not produce is composed on demand and persisted under the same scheme, so a gap is one slow request rather than a 404.

The manifest names each picture's file, its byte count and the box that picture is in: the crop art's own rectangle inside the union canvas (`src/assets/sprites/cropBox.js` records the convention and the bundle evidence for it). A request served from the bake therefore reads one file and one box, with no composition at all; an entry without a box — impossible in this layout, since a manifest from another one is refused — falls back to the composer's own box for that pair.

Set `CORS_ENABLED=false` or `RATE_LIMIT_ENABLED=false` to disable those features. SSE streams use a separate limiter (defaults to `RATE_LIMIT_MAX / 10` per window).

## Deployment profiles

The server runs in one of two explicit profiles, chosen with `SPRITES_PROFILE`:

| Profile | Starts the sprite and animation export | Answers sprite and animation routes |
|---|---|---|
| `full` (default) | yes, via the version watcher | yes, from `SPRITES_EXPORT_DIR` |
| `data` | no | `503 SPRITES_PROFILE` |

### `SPRITES_PROFILE=data` — a data-only instance

A second instance that only republishes `/data/*`, `/live/*` and `/stats/*` does not need the sprite stack at all. That stack is not cheap: the first boot of a `full` instance runs a full export — the game bundle, every atlas binary, the `.riv` files, then PNG/WebP rendering through `sharp`, `@napi-rs/canvas` and Rive — under a watchdog that calls `process.exit(1)` if a sync overruns 15 minutes (`src/services/spriteSync.js:215`). A bake costs the same. A host that serves data and nothing else should pay for neither, and a small container should not need a renderer it never calls.

```env
SPRITES_PROFILE=data
VERSION_WATCH_ENABLED=false
PET_ANIMATIONS_ENABLED=false
```

Both switches are required, and the server refuses to start if either is missing: `SPRITES_PROFILE=data` with `VERSION_WATCH_ENABLED=true` throws at startup rather than booting into a state where a version record advances with no pixels to match it.

`VERSION_WATCH_ENABLED=false` is what skips the export: `startVersionWatcher()` is the only caller of `checkSpritesOnStartup()`, so the atlas export, the Rive pet and decor rendering and the animation sync never run. It also means this instance never writes `data/version.json`, the record of the version whose data *and sprites* were built — correct, since it builds no sprites, and the reason the version pin that record drives is not applied on a host nothing updates.

### What a client sees on a sprite route

`GET /assets/sprites`, `/assets/sprites/:category/:name.png`, `/assets/sprites/composed`, `/assets/animations` and `/assets/rive` answer:

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "error": {
    "code": "SPRITES_PROFILE",
    "message": "This instance does not export sprites (SPRITES_PROFILE=data): it serves /data, /live and /stats only. Ask an instance running SPRITES_PROFILE=full for sprite and animation files.",
    "details": { "profile": "data", "path": "/assets/sprites/plants/Carrot.png" }
  }
}
```

503 rather than 404, because the images exist — just not on this host — and a client that gets a 404 would conclude the sprite is gone and cache that conclusion. The body names the profile so a client can tell "this instance does not do images" apart from "this instance is broken right now".

`/assets/sprite-data`, `/assets/cosmetics` and `/assets/audios` stay served: they are JSON derived from the bundle, not files from a render.

Note that a `data` instance behind the same nginx as its `full` sibling answers 503 only for requests that reach Node. A published `/assets/sprites` directory is served straight off disk by nginx, so proxy rules — not this profile — decide which instance a browser gets an image from.

### Compose

The compose file that runs a data-only service must set, in its `environment:` block:

```yaml
environment:
  SPRITES_PROFILE: data
  VERSION_WATCH_ENABLED: "false"
  PET_ANIMATIONS_ENABLED: "false"
```

Without `SPRITES_PROFILE=data` such a container still answers `/assets/*` with `200` and serves whatever the mounted `sprites_dump` contains — including a previous game version's art — which is what the explicit profile exists to prevent.

## Testing

The suite is offline by default - `npm test` does not touch the network.

```bash
npm test           # everything that can be checked offline
npm run test:live  # the same suite plus the checks that need the real game
```

Game *metadata* - the manifest and the atlas JSON - is asserted against a frozen
copy of what the game served at version 1192, under `tests/fixtures/game/`. See
[`tests/fixtures/README.md`](tests/fixtures/README.md) for provenance and how to
re-capture it. Pinning it is the point: an assertion tied to whatever the game
serves today goes red the week a new version ships, for a reason that has
nothing to do with this code.

Two things cannot be frozen into the repository: the game's *binaries*. A KTX2
atlas image is 1-5 MB and `rive/pets.riv` is 2.4 MB. The tests that need them
are skipped, and each skip says what it is missing and how to run it:

```
ok 5 - pets Rive asset (live .riv) # SKIP needs the live rive/pets.riv (~2.4 MB) to
load artboards and render pet loops - run `MG_LIVE_ASSETS=1 npm run test:live` with
network access
```

`npm run test:live` sets `MG_LIVE_ASSETS=1`, which turns those skips back into
tests. It needs network access; a single file works too:

```bash
MG_LIVE_ASSETS=1 npm run test:live                      # whole suite
MG_LIVE_ASSETS=1 node --test tests/rive-pets.test.js    # one file
```

Two caveats when reading the output. `node --test` counts skips attached to a
single test but not those gating a whole suite, so read the `# SKIP` lines in
the log rather than the `skipped` tally. And a skip is not a pass: if a check
can no longer measure what it was written to measure, it is skipped with the
reason rather than left to pass vacuously.

Some live tests only look for drift - a file the frozen copy pinned that the
game has since moved. They are gated the same way, and they exist so a stale
fixture cannot stay green forever.

## Limitations & Warnings

- **Unofficial API** - Not affiliated with the game developers
- **Personal use only** - Do not use commercially
- **Respect ToS** - Follow the game's terms of service
- **Dynamic data** - The API adapts automatically but may break during major changes

## Statistics

- Counts vary by game version and bundle updates
- Use `/data` and `/assets/sprite-data` to inspect current totals

## License

ISC, as upstream. [`NOTICE`](NOTICE) records the origin of this fork and the copyright:
[Magic-garden-API](https://github.com/Ariedam64/Magic-garden-API), by
[@Ariedam64](https://github.com/Ariedam64).

---

**Upstream project:** [Magic-garden-API](https://github.com/Ariedam64/Magic-garden-API) by [@Ariedam64](https://github.com/Ariedam64) — ISC
**This fork:** [QenuDev/mgjs-data-api](https://github.com/QenuDev/mgjs-data-api) — see [`NOTICE`](NOTICE)
**Game:** [Magic Garden](https://magicgarden.gg) / [Magic Circle](https://magiccircle.gg)
