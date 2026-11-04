# Pokémon Generation VI PC Box Tracker

Self-contained Generation VI (Alpha Sapphire) National Pokédex base stats & location tracker styled as a 25-box (`6 × 5`) PC Storage System.

Designed to run both **locally** (via Python test server) and **online** on **GitHub Pages** (with direct GitHub repository sync).

## Quick Start

### 1. Test Locally (Mac / Linux / Windows)

Run the zero-dependency Python server:

```bash
python3 server.py
```

To test on your iPhone on the same Wi-Fi network:

```bash
caffeinate -i python3 server.py --lan
```

Open the printed URL (`http://127.0.0.1:8765` on desktop, or `http://<lan-ip>:8765` on phone).
Any Pokémon you toggle as caught will automatically and atomically save to `caught.json`.

---

### 2. GitHub Pages (Online)

1. Push this repository to GitHub.
2. In your repository settings, enable **GitHub Pages** (Deploy from branch: `main`, folder: `/ (root)`).
3. Open your GitHub Pages URL in your browser.
4. Click the **Sync** button in the header and enter:
   - **Repository**: `your-username/national_dex_as`
   - **Personal Access Token**: A fine-grained GitHub PAT with **Contents: Read and write** permissions for this repository.
5. Your caught Pokémon will now sync directly to `caught.json` in your GitHub repo!

---

## Architecture & Files

- `index.html` — Clean semantic HTML structure with desktop hover/click and iPhone Safari touch/swipe support.
- `style.css` — Responsive PC storage system styling tuned for desktop and iPhone 16 Pro Max Safari.
- `app.js` — Client application logic handling box rendering, caught toggles, touch gestures, and dual local/GitHub syncing.
- `pokemon.json` — All 721 Generation VI Pokémon with base stats and Alpha Sapphire (or fallback OR/Y/X) locations.
- `caught.json` — Lightweight array of caught Pokémon Ndex numbers (`{"caught": [...]}`). Keeping this separate from `pokemon.json` makes syncing near-instantaneous.
- `icons/` — 721 `32 × 32` Pokémon PC box sprites (`001.png`–`721.png`).
- `server.py` — Zero-dependency Python HTTP server for local testing and atomic updates to `caught.json`.
