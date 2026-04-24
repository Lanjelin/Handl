<img src="https://raw.githubusercontent.com/Lanjelin/Handl/refs/heads/main/public/icon.svg" alt="Handl" width="96" />

# Handl

Handl is a shared shopping list for families and couples.

It is:
- installable as a PWA
- fast to open on phones
- simple to share
- collaborative with live updates
- online-first, with a small local cache for settings

It is not:
- an offline-first note app
- a task manager
- a general-purpose document editor
- a multi-user account system
- a solution to all of your problems

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

## Top bar

The icons at the top are there to keep the app quiet and compact:

| Icon | Meaning |
| --- | --- |
| <a href="https://fonts.google.com/icons?icon.query=cloud_done"><img src="https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/cloud_done/default/48px.svg" alt="cloud_done" width="20" /></a> | Connected and in sync |
| <a href="https://fonts.google.com/icons?icon.query=cloud_sync"><img src="https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/cloud_sync/default/48px.svg" alt="cloud_sync" width="20" /></a> | Still syncing changes |
| <a href="https://fonts.google.com/icons?icon.query=cloud_off"><img src="https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/cloud_off/default/48px.svg" alt="cloud_off" width="20" /></a> | Disconnected or stale |
| <a href="https://fonts.google.com/icons?icon.query=groups"><img src="https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/groups/default/48px.svg" alt="groups" width="20" /></a> | Other people are viewing the same list |
| <a href="https://fonts.google.com/icons?icon.query=edit_note"><img src="https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/edit_note/default/48px.svg" alt="edit_note" width="20" /></a> | Toggle between checklist and text editor |
| <a href="https://fonts.google.com/icons?icon.query=settings"><img src="https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/settings/default/48px.svg" alt="settings" width="20" /></a> | Open local settings |

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
See `.env.example` for the full set of variables.  
For private instances, you can set `PASSWORD` to require a simple login before the app opens.  

## Notes

- Data is stored in SQLite under `./data`.
- `/metrics` exposes a small operational snapshot for debugging.
