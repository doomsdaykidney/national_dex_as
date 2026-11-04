#!/usr/bin/env python3
from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import socket
import subprocess
import threading

BASE_DIR = Path(__file__).resolve().parent
CAUGHT_PATH = BASE_DIR / "caught.json"
PORT = 8765
MAX_BODY_BYTES = 64 * 1024

_caught_lock = threading.Lock()
_ICON_RE = re.compile(r"^/icons/(\d{3}|pokeball)\.png$")
_ALLOWED_STATIC = {
    "/",
    "/index.html",
    "/style.css",
    "/app.js",
    "/pokemon.json",
    "/caught.json",
    "/favicon.ico",
    "/icons/pokeball.png",
}


def read_caught() -> set[int]:
    if not CAUGHT_PATH.exists():
        return set()
    try:
        data = json.loads(CAUGHT_PATH.read_text(encoding="utf-8"))
        raw = data.get("caught", []) if isinstance(data, dict) else []
        return {int(x) for x in raw if str(x).isdigit() and 1 <= int(x) <= 721}
    except (OSError, ValueError, TypeError):
        return set()


def update_caught_file(additions: list[int], removals: list[int]) -> list[int]:
    """Atomically merges additions and removals into caught.json and returns the sorted list."""
    with _caught_lock:
        caught = read_caught()
        for ndex in additions:
            if 1 <= ndex <= 721:
                caught.add(ndex)
        for ndex in removals:
            caught.discard(ndex)

        sorted_caught = sorted(caught)
        tmp_path = CAUGHT_PATH.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps({"caught": sorted_caught}, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp_path.replace(CAUGHT_PATH)
        return sorted_caught


def is_allowed_path(path: str) -> bool:
    """Only the app files, sprites, and local API are served."""
    clean = path.split("?", 1)[0]
    return clean in _ALLOWED_STATIC or _ICON_RE.match(clean) is not None


class BoxRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.path.startswith("/icons/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self) -> None:
        if not is_allowed_path(self.path):
            self.send_error(404)
            return
        super().do_HEAD()

    def do_GET(self) -> None:
        clean = self.path.split("?", 1)[0]
        if clean == "/api/local":
            self._send_json({"local_server": True, "caught": sorted(read_caught())})
            return
        if not is_allowed_path(self.path):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/caught":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("bad request size")
            body = json.loads(self.rfile.read(length).decode("utf-8"))

            if "caught" in body and isinstance(body["caught"], list):
                with _caught_lock:
                    new_set = {int(x) for x in body["caught"] if str(x).isdigit() and 1 <= int(x) <= 721}
                    sorted_caught = sorted(new_set)
                    tmp_path = CAUGHT_PATH.with_suffix(".json.tmp")
                    tmp_path.write_text(
                        json.dumps({"caught": sorted_caught}, indent=2) + "\n",
                        encoding="utf-8",
                    )
                    tmp_path.replace(CAUGHT_PATH)
                self._send_json({"ok": True, "caught": sorted_caught})
                return

            additions = [int(x) for x in body.get("additions", [])]
            removals = [int(x) for x in body.get("removals", [])]
            if "ndex" in body and "caught" in body:
                ndex_int = int(body["ndex"])
                if body["caught"]:
                    additions.append(ndex_int)
                else:
                    removals.append(ndex_int)
            sorted_caught = update_caught_file(additions, removals)
        except (ValueError, KeyError, TypeError) as e:
            self._send_json({"ok": False, "error": str(e)}, status=400)
            return
        self._send_json({"ok": True, "caught": sorted_caught})

    def log_message(self, format: str, *args) -> None:
        pass


def lan_ip() -> str | None:
    """Best-effort Wi-Fi/Ethernet address of this Mac."""
    for i in range(0, 6):
        try:
            out = subprocess.run(
                ["ipconfig", "getifaddr", f"en{i}"],
                capture_output=True,
                text=True,
                timeout=2,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            break
        if out:
            return out
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Pokémon Gen VI PC box tracker local server")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="listen on all network interfaces so a phone on the same Wi-Fi can connect "
        "(default: this computer only)",
    )
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    server = ThreadingHTTPServer((host, args.port), BoxRequestHandler)

    print(f"Serving on this computer:  http://127.0.0.1:{args.port}", flush=True)
    if args.lan:
        ip = lan_ip()
        name = socket.gethostname()
        if name and not name.endswith(".local"):
            name += ".local"
        if ip:
            print(f"On your iPhone (same Wi-Fi): http://{ip}:{args.port}", flush=True)
        print(f"  or (name-based, survives IP changes): http://{name}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
