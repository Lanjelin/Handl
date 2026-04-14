# Handl

A phone-first collaborative shopping list PWA that feels as simple as writing in a text editor while supporting real-time syncing.

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

Set the `PORT` environment variable in the compose service if you need a different HTTP port (defaults to `3000`).
```

Run with:

```bash
docker compose up -d
```

The compose setup mirrors the docker run command and maps `./data` into `/app/data` for persistence.

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

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port where Handl listens | `3000` |

## Notes

- Data is stored in `data/handl.db` (SQLite). Make sure your Docker volume or local `data/` directory is writable.
- The app exposes port `3000` by default. You can override it via `PORT` if needed.
- When running from npm, you can still reuse the Docker volume contents by pointing your local `data/` directory at the same path.
