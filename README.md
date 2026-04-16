# Handl

A phone-first collaborative shopping list PWA that feels like writing in a text editor while supporting real-time syncing.

Handl is online-first: shared list data syncs over the websocket connection, while the browser keeps only lightweight local prefs and a small JSON snapshot cache for faster reopen on that device.

## Available builds

- Container image (hosted on GitHub Container Registry): `ghcr.io/lanjelin/handl:latest`
- Source code: `https://github.com/Lanjelin/Handl`

## Running

### 1. Docker

```bash
docker run -d \
  --name handl \
  -p 3000:3000 \
  -v handl-data:/app/data \
  ghcr.io/lanjelin/handl:latest
```

- Persisted data lives under `/app/data` inside the container, so mount a volume for durability.
- The container runs as UID/GID `1000:1000` (the `node` user in the base image); override it with `--user <>` (e.g., `--user node:node`) if your host volume needs different ownership.
- Set `PORT` in the container if you need a different HTTP port than `3000`.

### 2. Docker Compose

```yaml
version: '3.9'
services:
  handl:
    image: ghcr.io/lanjelin/handl:latest
    ports:
      - 3000:3000
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

Set the `PORT` environment variable in the compose service if you need a different HTTP port (defaults to `3000`).

Run with:

```bash
docker compose up -d
```

The compose setup mirrors the `docker run` example and maps `./data` into `/app/data` for persistence.

### 3. From source (npm)

1. Clone the repo:

   ```bash
   git clone https://github.com/Lanjelin/Handl.git
   cd Handl
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   export PORT=3000  # optional, defaults to 3000
   npm start
   ```

## Environment variables

Put these in `./data/.env` when running from source or mounting a container volume.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port where Handl listens | `3000` |
| `DATA_DIR` | Base directory for local app data | `./data` |
| `DB_FILE` | SQLite database path | `./data/handl.db` |
| `PUBLIC_DIR` | Static asset directory | `./public` |
| `PRUNE_AFTER_MS` | Delete inactive lists after this long | `15552000000` |
| `PERSIST_DEBOUNCE_MS` | Delay before writing active edits to SQLite | `750` |
| `PERSIST_MAX_DELAY_MS` | Maximum time before forcing a persistence flush | `30000` |
| `BROADCAST_DEBOUNCE_MS` | Batch websocket fanout during bursts | `50` |
| `COMPACT_IDLE_DELAY_MS` | Delay before compacting an idle list | `120000` |
| `HEARTBEAT_MS` | Interval for websocket heartbeats used to detect stale connections | `15000` |
| `METRICS_WINDOW_MS` | Rolling window used by `/metrics` for recent request counts | `900000` |
| `SHARE_CODE_LENGTH` | Length of generated restore codes | `8` |
| `SHARE_CODE_ALPHABET` | Alphabet used for restore codes | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` |
| `DEBUG_METRICS` | Enable lightweight browser console timing logs | `0` |

## Notes

- Data is stored in `data/handl.db` (SQLite). Make sure your Docker volume or local `data/` directory is writable.
- The app listens on port `3000` by default. Override it with `PORT` if needed.
- If you run from npm, you can still reuse the Docker volume contents by pointing your local `data/` directory at the same path.
- `/metrics` exposes a small operational snapshot: cached list count, active websocket clients, timer counts, and recent request totals within `METRICS_WINDOW_MS`.
- The mobile share button uses the native share sheet on supported devices and shares `/?join=<shareCode>`.
- The browser cache stores only a plain JSON snapshot of the current list; theme/language/checkbox-sort preferences are kept locally in the browser and persist across lists. It no longer keeps a full Automerge blob locally.
