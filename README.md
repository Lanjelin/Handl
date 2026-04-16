![Handl](https://raw.githubusercontent.com/Lanjelin/Handl/refs/heads/main/public/icon.svg)

# Handl

Handl is a shared shopping list for families and couples.

It is:
- fast to open on phones
- simple to share
- collaborative for a few people at a time
- online-first, with a small local cache for quicker reopen on the same device

It is not:
- an offline-first note app
- a task manager
- a general-purpose document editor
- a multi-user account system

## Try it

- Hosted instance: [handl.gn.gy](https://handl.gn.gy/)
- Docker image: `ghcr.io/lanjelin/handl:latest`

## How to use it

1. Open Handl and create a new list, or join one with a share code.
2. Share the list code with the other people who should use the list.
3. Use the list like a simple shopping list:
   - check items off
   - add new items or edit the list
   - remove checked items when done shopping

On mobile, the share button opens the native share sheet where supported.
On desktop, copy the list code and send it however you want.

## Self-host

### Docker run

```bash
docker run -d \
  --name handl \
  -p 3000:3000 \
  -v handl-data:/app/data \
  ghcr.io/lanjelin/handl:latest
```

### Docker Compose

```yaml
services:
  handl:
    image: ghcr.io/lanjelin/handl:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    env_file:
      - ./data/.env
    restart: unless-stopped
```

### From source

```bash
git clone https://github.com/Lanjelin/Handl.git
cd Handl
npm install
npm start
```

## Configuration

Handl reads optional environment variables from `./data/.env` when self-hosted.
You can also set them directly in the container or shell environment.

Common values:
- `PORT`
- `DATA_DIR`
- `DB_FILE`
- `PUBLIC_DIR`
- `PRUNE_AFTER_MS`
- `PERSIST_DEBOUNCE_MS`
- `PERSIST_MAX_DELAY_MS`
- `BROADCAST_DEBOUNCE_MS`
- `COMPACT_IDLE_DELAY_MS`
- `HEARTBEAT_MS`
- `METRICS_WINDOW_MS`
- `SHARE_CODE_LENGTH`
- `SHARE_CODE_ALPHABET`
- `DEBUG_METRICS`

## Notes

- Data is stored in SQLite under `./data`.
- `/metrics` exposes a small operational snapshot for debugging.
- If you change the container port, update `PORT` accordingly.
