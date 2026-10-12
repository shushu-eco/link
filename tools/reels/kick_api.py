"""Ask Kick's official API about a channel: whether it is live, and what the stream is called.

Usage:
    python tools/reels/kick_api.py <channel> [<channel> ...]     print what Kick says about them, as JSON

Needs an app of the user's own (kick.com > Settings > Developer; Kick asks for two-step sign-in
first). The user pastes the app's Client ID and Client Secret into Link. With those Link gets an
"app access token", which reads only what anyone can see on Kick; nobody signs in, and Link can
change nothing on Kick. Everything is kept in %USERPROFILE%\\.link\\kick.json, never in the project
and never sent to the dashboard page. The token lasts a while and is asked for again when it runs out.

What it reads (GET /public/v1/channels?slug=...):
    live        whether the channel is streaming now
    title       what the stream is called
    category    the game or category it is in
    viewers     how many watch
Kick's API has nothing about a channel's clips.

An answer is kept for KEEP seconds, so the Studio can ask every few seconds without Kick being
asked that often.
"""
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import safe

DATA = Path.home() / ".link"   # not under AppData, see link.pyw
TOKEN_FILE = DATA / "kick.json"
# The variables are for tests.
TOKEN = os.environ.get("LINK_KICK_TOKEN", "https://id.kick.com/oauth/token")
API = os.environ.get("LINK_KICK_API", "https://api.kick.com/public/v1")
KEEP = 20                  # seconds an answer about a channel stands
AGENT = "Link/1.0"         # Kick turns away urllib's own name

_lock = threading.Lock()   # the server answers side by side; one of them renews the token at a time
_known = {}                # channel -> (when asked, what Kick said)


class KickError(Exception):
    """Something Kick said no to, in words the user can act on."""


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(path, data):
    DATA.mkdir(parents=True, exist_ok=True)
    safe.write_json(path, data)   # whole or not there: half a file of sign-ins would mean signing in again


def saved():
    return read_json(TOKEN_FILE) or {}


def token_request(client_id, client_secret):
    form = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}
    request = urllib.request.Request(TOKEN, data=urllib.parse.urlencode(form).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": AGENT})
    try:
        with urllib.request.urlopen(request, timeout=20) as res:
            token = json.load(res)
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403):
            raise KickError("Kick does not accept that Client ID and secret. Copy both again from your app under kick.com > Settings > Developer.") from None
        raise KickError(f"Kick's sign-in answered HTTP {e.code}.") from None
    except (OSError, ValueError) as e:
        raise KickError(f"Kick could not be reached ({e}).") from None
    if not token.get("access_token"):
        raise KickError("Kick gave no access token for that Client ID and secret.")
    return token


def store(s, token):
    s.update(access=token["access_token"], expires=time.time() + float(token.get("expires_in") or 3600) - 60)
    write_json(TOKEN_FILE, s)


def connect(client_id, client_secret):
    """Check the ID and secret of the user's Kick app against Kick and keep them."""
    client_id, client_secret = "".join(str(client_id).split()), "".join(str(client_secret).split())
    if len(client_id) < 16:
        raise KickError("That does not look like a Client ID. Copy it from your app under kick.com > Settings > Developer.")
    if len(client_secret) < 16:
        raise KickError("That does not look like the client secret. Copy it from the same app on Kick.")
    with _lock:
        store({"client_id": client_id, "client_secret": client_secret}, token_request(client_id, client_secret))
        _known.clear()


def disconnect():
    TOKEN_FILE.unlink(missing_ok=True)
    _known.clear()


def access_token(renew=False):
    """A valid app token, asked for again when it has run out."""
    with _lock:
        s = saved()
        if not s.get("client_id") or not s.get("client_secret"):
            raise KickError("Link is not connected to Kick yet.")
        if renew or not s.get("access") or time.time() >= s.get("expires", 0):
            store(s, token_request(s["client_id"], s["client_secret"]))
        return s["access"]


def call(path, retry=True, **params):
    request = urllib.request.Request(f"{API}/{path.lstrip('/')}?" + urllib.parse.urlencode(params, doseq=True),
                                     headers={"Authorization": f"Bearer {access_token(renew=not retry)}", "Accept": "application/json", "User-Agent": AGENT})
    try:
        with urllib.request.urlopen(request, timeout=15) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        if e.code == 401 and retry:   # the token ran out early: ask for a new one once and try again
            return call(path, retry=False, **params)
        if e.code == 401:
            raise KickError("Kick no longer accepts Link's app. Connect it again in Settings > Accounts.") from None
        if e.code == 429:
            raise KickError("Kick is being asked too often. It answers again in a minute.") from None
        try:
            message = json.load(e).get("message")
        except (ValueError, AttributeError):
            message = ""
        raise KickError(message or f"Kick answered HTTP {e.code}.") from None
    except (OSError, ValueError) as e:
        raise KickError(f"Kick could not be reached ({e}).") from None


def channel(name):
    """{"live", "title", "category", "viewers"} of one channel, or None when Kick knows no such channel."""
    name = str(name).strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{2,40}", name):
        raise KickError("That is not a Kick channel.")
    at, known = _known.get(name, (0, None))
    if time.time() - at < KEEP:
        return known
    data = call("channels", slug=name).get("data") or []
    found = next((c for c in data if str(c.get("slug", "")).lower() == name), data[0] if data else None)
    if found:
        stream, live = found.get("stream") or {}, bool((found.get("stream") or {}).get("is_live"))
        found = {"live": live, "title": found.get("stream_title") or "", "category": (found.get("category") or {}).get("name") or "",
                 "viewers": stream.get("viewer_count") if live else None}
    _known[name] = (time.time(), found)
    return found


def status():
    """What Settings needs. The secret and the token never leave the server."""
    s = saved()
    return {"connected": bool(s.get("client_id") and s.get("client_secret"))}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        print(json.dumps({name: channel(name) for name in sys.argv[1:]}, indent=1, ensure_ascii=False))
    except KickError as e:
        sys.exit(str(e))
