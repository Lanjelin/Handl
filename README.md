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
  -e HANDL_PASSWORD="your-secret" \
  -e HANDL_COOKIE_MAXAGE="30d" \
  -e HANDL_TITLE="Handl" \
  ghcr.io/lanjelin/handl:latest
```

- `HANDL_PASSWORD` (required if set) protects the list with a password prompt.
- `HANDL_COOKIE_MAXAGE` accepts numbers (seconds), `none`, `inf`/`infinite`, or duration strings like `30d`. Defaults to `30d`.
- `HANDL_TITLE` lets you customize the displayed app name (defaults to `Handl`).
- Persisted data lives under `/app/data` inside the container, so mount a volume for durability.

### 2. Docker Compose

```yaml
version: '3.9'
services:
  handl:
    image: ghcr.io/lanjelin/handl:latest
    ports:
      - 3000:3000
    environment:
      HANDL_PASSWORD: "your-secret"
      HANDL_COOKIE_MAXAGE: "30d"
      HANDL_TITLE: "Handl"
    volumes:
      - handl-data:/app/data

volumes:
  handl-data:
```

Run with:

```bash
docker compose up -d
```

The compose setup also reuses the same env vars and binds `handl-data` for persistence.

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

3. Export env vars and start:

   ```bash
   export HANDL_PASSWORD="your-secret"
   export HANDL_COOKIE_MAXAGE="30d"
   export HANDL_TITLE="Handl"
   npm start
   ```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HANDL_PASSWORD` | Set to require a password before viewing the list | (none) |
| `HANDL_COOKIE_MAXAGE` | Cookie lifetime in seconds (or `none`/`inf`/`infinite` to control persistence). Defaults to `30d` (2,592,000 s) | `30d` |
| `HANDL_TITLE` | Custom title shown in the UI | `Handl` |

Use the `HANDL_PASSWORD` and `HANDL_COOKIE_MAXAGE` vars together to control access and session length. Setting the cookie age to `none` creates a session-only login, while `inf`/`infinite` keeps it around for one year.

## Notes

- Data is stored in `data/list.json`. Make sure your Docker volume or local `data/` directory is writable.
- The app exposes port `3000` by default.
- When running from npm, you can still use Docker volumes by copying `data/` if you later migrate to containers.
