"""Stand-in for the coach server (server/src/index.js), for testing on this Mac
without Cloudflare: python3 dev/mock-coach.py, then the dashboard is at
http://localhost:8787/coach and the pupil setup link uses the code "squad".

Same endpoints and replies as the Worker, kept in memory, but with no
Cloudflare Access check: never run it anywhere others can reach.
"""
import hashlib
import json
import pathlib
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JOIN_CODE = "squad"
APP_URL = "http://localhost:8765/"
ORIGINS = {"http://localhost:8765"}
DASHBOARD = pathlib.Path(__file__).resolve().parent.parent / "server/src/dashboard.html"

devices = {}  # id -> {id, key_hash, name, pupil, created_at, last_seen}
cards = {}  # (device_id, id) -> {data, received_at, deleted}


def now():
    return datetime.now(timezone.utc).isoformat()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, kind="application/json"):
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", kind)
        origin = self.headers.get("origin", "")
        if origin in ORIGINS:
            self.send_header("access-control-allow-origin", origin)
            self.send_header("access-control-allow-methods", "POST, OPTIONS")
            self.send_header("access-control-allow-headers", "content-type")
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")

    def do_OPTIONS(self):
        self.reply(204, "")

    def do_GET(self):
        if self.path.startswith("/coach"):
            return self.reply(200, DASHBOARD.read_text().replace("%APP_URL%", APP_URL), "text/html; charset=utf-8")
        if self.path.startswith("/api/coach/data"):
            setup = f"{APP_URL}#/coach-setup?server=http%3A%2F%2Flocalhost%3A8787&code={JOIN_CODE}"
            return self.reply(200, {
                "devices": [{k: v for k, v in d.items() if k != "key_hash"} for d in devices.values()],
                "cards": [{"deviceId": dev, "receivedAt": c["received_at"], "card": c["data"]}
                          for (dev, _), c in cards.items() if not c["deleted"]],
                "setup": setup,
            })
        self.reply(404, {"error": "Not found"})

    def do_POST(self):
        b = self.body()
        if self.path == "/api/register":
            if b.get("code") != JOIN_CODE:
                return self.reply(403, {"error": "That squad code is not right. Ask your coach for a new setup link."})
            h = hashlib.sha256(b["key"].encode()).hexdigest()
            d = devices.get(b["deviceId"])
            if d and d["key_hash"] != h:
                return self.reply(403, {"error": "This device is already registered."})
            devices[b["deviceId"]] = {**(d or {"id": b["deviceId"], "key_hash": h, "pupil": None, "created_at": now()}),
                                      "name": b["name"].strip()[:60], "last_seen": now()}
            return self.reply(200, {"ok": True})
        if self.path == "/api/cards":
            d = devices.get(b.get("deviceId"))
            if not d or d["key_hash"] != hashlib.sha256(b.get("key", "").encode()).hexdigest():
                return self.reply(401, {"error": "This device is not registered with your coach any more."})
            for c in b.get("cards", []):
                c.pop("images", None)
                cards[(d["id"], c["id"])] = {"data": c, "received_at": now(), "deleted": False}
            for i in b.get("deleted", []):
                if (d["id"], i) in cards:
                    cards[(d["id"], i)]["deleted"] = True
            d["last_seen"] = now()
            return self.reply(200, {"ok": True, "received": len(b.get("cards", [])), "deleted": len(b.get("deleted", []))})
        if self.path == "/api/coach/device":
            if b.get("remove"):
                devices.pop(b["id"], None)
                for k in [k for k in cards if k[0] == b["id"]]:
                    del cards[k]
            elif b["id"] in devices:
                devices[b["id"]]["pupil"] = (b.get("pupil") or "").strip() or None
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "Not found"})


if __name__ == "__main__":
    print("Mock coach server on http://localhost:8787 (dashboard at /coach)")
    ThreadingHTTPServer(("localhost", 8787), Handler).serve_forever()
