"""Remote control for the user's Spotify, behind the small music player in Link's window.

Usage:
    python tools/reels/spotify_api.py            print what Spotify is playing now, as JSON

Link plays no music itself, and nothing from Spotify is recorded: the recorder takes only the Studio's
own picture and sound. The player shows what the Spotify app (on this PC or a phone) is playing and
presses play, pause, next and previous there, through Spotify's Web API. Pressing needs Premium.

Setup, once: on developer.spotify.com make an app (API: Web API) with the redirect URI
http://127.0.0.1:8765/spotify/callback, and paste its Client ID into the player. Connect opens
Spotify's own sign-in page in the browser; with PKCE there is no client secret. The sign-in is kept
in %USERPROFILE%\\.link\\spotify.json, never in the project and never sent to the dashboard page.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import safe

DATA = Path.home() / ".link"   # not under AppData, see link.pyw
TOKEN_FILE = DATA / "spotify.json"
ACCOUNTS = "https://accounts.spotify.com"
API = os.environ.get("LINK_SPOTIFY_API", "https://api.spotify.com/v1")  # the variable is for tests
REDIRECT = "http://127.0.0.1:8765/spotify/callback"
SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing"
NO_DEVICE = "Open Spotify on this PC or your phone first; Link presses its buttons from here."
ACTIONS = {"play": ("PUT", "me/player/play"), "pause": ("PUT", "me/player/pause"),
           "next": ("POST", "me/player/next"), "previous": ("POST", "me/player/previous")}

_lock = threading.Lock()   # the server answers side by side; one of them renews the sign-in at a time
_pending = {}              # sign-in in progress: state -> PKCE verifier, kept until Spotify sends the user back


class SpotifyError(Exception):
    """Something Spotify said no to, in words the user can act on."""


class NoDevice(SpotifyError):
    pass


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


def set_client_id(client_id):
    """Keep the Client ID of the user's Spotify app. A new one forgets the sign-in made with the old."""
    client_id = "".join(str(client_id).split())
    if not re.fullmatch(r"[0-9a-fA-F]{32}", client_id):
        raise SpotifyError("That is not a Client ID. Copy the 32 letters and numbers under Client ID in your app on developer.spotify.com.")
    write_json(TOKEN_FILE, {"client_id": client_id.lower()})


def sign_in_url():
    """Spotify's own sign-in page for this app, with a fresh PKCE challenge."""
    client_id = saved().get("client_id")
    if not client_id:
        raise SpotifyError("Paste your Spotify app's Client ID first.")
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    _pending.clear()
    _pending[state] = verifier
    return f"{ACCOUNTS}/authorize?" + urllib.parse.urlencode({
        "client_id": client_id, "response_type": "code", "redirect_uri": REDIRECT, "scope": SCOPES,
        "code_challenge_method": "S256", "code_challenge": challenge, "state": state})


def finish_sign_in(params):
    """Spotify sent the browser back to Link with ?code=...&state=... (or ?error=...)."""
    if params.get("error"):
        raise SpotifyError("You declined on Spotify's page, so nothing was connected." if params["error"] == "access_denied"
                           else f"Spotify said: {params['error']}.")
    verifier = _pending.pop(params.get("state", ""), None)
    if not verifier:
        raise SpotifyError("This sign-in is out of date. Press Connect in Link again.")
    s = saved()
    store(s, token_request(grant_type="authorization_code", code=params.get("code", ""), redirect_uri=REDIRECT,
                           client_id=s.get("client_id", ""), code_verifier=verifier))


def token_request(**form):
    request = urllib.request.Request(f"{ACCOUNTS}/api/token", data=urllib.parse.urlencode(form).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(request, timeout=20) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            error = json.load(e)
        except ValueError:
            error = {}
        if error.get("error") == "invalid_grant":
            raise SpotifyError("Spotify no longer accepts Link's sign-in. Press Connect again.") from None
        if error.get("error") == "invalid_client":
            raise SpotifyError("Spotify does not know that Client ID. Check it in your app on developer.spotify.com.") from None
        raise SpotifyError(error.get("error_description") or f"Spotify's sign-in answered HTTP {e.code}.") from None
    except OSError as e:
        raise SpotifyError(f"Spotify could not be reached ({e}).") from None


def store(s, token):
    s.update(access=token["access_token"], expires=time.time() + token.get("expires_in", 3600) - 60,
             refresh=token.get("refresh_token") or s.get("refresh"))
    write_json(TOKEN_FILE, s)


def access_token(renew=False):
    """A valid access token, renewed with the saved refresh token when it has run out (after an hour)."""
    with _lock:
        s = saved()
        if not s.get("refresh"):
            raise SpotifyError("Link is not connected to Spotify yet.")
        if renew or time.time() >= s.get("expires", 0):
            store(s, token_request(grant_type="refresh_token", refresh_token=s["refresh"], client_id=s["client_id"]))
        return s["access"]


def disconnect():
    """Forget the sign-in; the Client ID stays, so Connect is one press away."""
    write_json(TOKEN_FILE, {"client_id": saved().get("client_id")})


def call(method, path, body=None, retry=True, **params):
    url = f"{API}/{path}" + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body).encode() if body is not None else (b"" if method in ("PUT", "POST") else None)
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {access_token(renew=not retry)}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as res:
            raw = res.read()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        try:
            error = json.load(e).get("error", {})
        except (ValueError, AttributeError):
            error = {}
        error = error if isinstance(error, dict) else {"message": str(error)}
        reason, message = error.get("reason", ""), error.get("message", "")
        if e.code == 401 and retry:   # the token ran out early: renew it once and try again
            return call(method, path, body, retry=False, **params)
        if e.code == 401:
            raise SpotifyError("Spotify no longer accepts Link's sign-in. Press Connect again.") from None
        if reason == "NO_ACTIVE_DEVICE" or (e.code == 404 and path.startswith("me/player")):
            raise NoDevice(NO_DEVICE) from None
        if reason == "PREMIUM_REQUIRED":
            raise SpotifyError("Spotify lets other apps press play and pause only on Premium accounts.") from None
        if e.code == 403 and "registered" in message.lower():
            raise SpotifyError("Spotify keeps your app to its listed users: add your Spotify account under User Management in the app on developer.spotify.com.") from None
        if e.code == 429:
            raise SpotifyError("Spotify asked Link to slow down. Try again in a moment.") from None
        raise SpotifyError(message or f"Spotify answered HTTP {e.code}.") from None
    except OSError as e:
        raise SpotifyError(f"Spotify could not be reached ({e}).") from None


def now_playing():
    """The song (or podcast episode) Spotify is on, or {"idle": True} when nothing is."""
    p = call("GET", "me/player", additional_types="track,episode")
    item = (p or {}).get("item")
    if not item:
        return {"idle": True, "ad": (p or {}).get("currently_playing_type") == "ad"}
    if item.get("type") == "episode":
        who, images = (item.get("show") or {}).get("name", ""), item.get("images") or (item.get("show") or {}).get("images") or []
    else:
        who, images = ", ".join(a.get("name", "") for a in item.get("artists", [])), (item.get("album") or {}).get("images") or []
    cover = min((i for i in images if (i.get("width") or 0) >= 64), key=lambda i: i.get("width") or 0, default=images[0] if images else None)
    return {"idle": False, "playing": bool(p.get("is_playing")), "title": item.get("name", ""), "artist": who,
            "cover": cover and cover.get("url"), "position": (p.get("progress_ms") or 0) / 1000,
            "length": (item.get("duration_ms") or 0) / 1000, "device": (p.get("device") or {}).get("name", "")}


def command(action):
    """Press play, pause, next or previous in Spotify. With nothing playing anywhere, play wakes this PC's
    Spotify (or the first other one that is open) and plays there."""
    method, path = ACTIONS[action]
    try:
        call(method, path)
    except NoDevice:
        if action != "play":
            raise
        devices = [d for d in (call("GET", "me/player/devices") or {}).get("devices", []) if not d.get("is_restricted")]
        if not devices:
            raise
        here = socket.gethostname().lower()
        pick = next((d for d in devices if d.get("name", "").lower() == here), None) \
            or next((d for d in devices if d.get("type") == "Computer"), devices[0])
        call("PUT", "me/player", {"device_ids": [pick["id"]], "play": True})


def status():
    """What the player shows: whether it is set up and connected, and what is playing."""
    s = saved()
    out = {"client_id": bool(s.get("client_id")), "connected": bool(s.get("refresh"))}
    if out["connected"]:
        try:
            out["now"] = now_playing()
        except SpotifyError as e:
            out["error"] = str(e)
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(json.dumps(status(), indent=1, ensure_ascii=False))
