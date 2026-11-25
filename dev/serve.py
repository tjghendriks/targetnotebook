"""Local development server. Tells browsers never to cache, so a phone on the
home network always gets the current files (plain http has no service worker
to do that for it)."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # As GitHub Pages does, so the coach dashboard can borrow the app's code.
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
