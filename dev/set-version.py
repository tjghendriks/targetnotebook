"""Stamp a release version through the app: dev/set-version.py 2026.10.12-1

Every module is loaded with ?v=<version>, so a browser can never mix files
from two releases (new app.js with a cached, older store.js, for example).
The same version shows at the bottom of Settings and names the offline cache.
"""
import pathlib
import re
import sys

version = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent


def rewrite(path, rules):
    text = path.read_text()
    for pattern, repl in rules:
        text = re.sub(pattern, repl, text)
    path.write_text(text)


for script in sorted((root / "js").glob("*.js")) + [root / "sw.js"]:
    rewrite(script, [
        (r"const VERSION = '[^']*';", f"const VERSION = '{version}';"),
        (r"(from '\./[\w-]+\.js)(\?v=[^']*)?'", rf"\1?v={version}'"),
    ])
rewrite(root / "index.html", [
    (r'(href="css/style\.css)(\?v=[^"]*)?"', rf'\1?v={version}"'),
    (r'(src="js/app\.js)(\?v=[^"]*)?"', rf'\1?v={version}"'),
])
print(f"version set to {version}")
