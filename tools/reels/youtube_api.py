"""Read the user's YouTube Shorts through Google's official APIs (YouTube Data API v3 and YouTube Analytics API).

Usage:
    python tools/reels/youtube_api.py            print the analytics as JSON (fetches them now)

YouTube Studio itself cannot be read by a program; these two APIs are where its numbers come from.
They need an OAuth client of the user's own (console.cloud.google.com: a project with both APIs
enabled, and an OAuth client of the type "Web application" whose redirect URI is REDIRECT below).
The user pastes the client's ID and secret into Link and signs in on Google's own page; Link never
sees the password. Everything is kept in %USERPROFILE%\\.link\\youtube.json, never in the project and
never sent to the dashboard page. The access token lasts an hour and is renewed with the refresh
token. While the Google project is in "Testing", Google ends a sign-in after 7 days; publishing the
app ("In production", no review needed for one's own use) makes it last.

What it reads, with the permissions youtube.readonly and yt-analytics.readonly:
    the channel      name, handle, subscribers, picture
    every Short      title, date, link, thumbnail, length, views, likes, comments (Data API, up to the minute)
    its analytics    shares, average watch time, average percentage watched, subscribers gained
    the last 28 days views, watch time, likes, comments, shares and subscribers gained, of the Shorts
                     only when the API allows that filter, otherwise of the whole channel
Uploading a Short (upload) needs a third permission, youtube.upload. A sign-in made before Link asked
for it still reads the numbers; signing in again adds it. An upload costs 1600 of the 10,000 units
Google gives a project each day, so about six uploads a day. Google keeps what a project that has
not passed its audit uploads private, whatever is asked for; the video is then made public in
YouTube Studio.

YouTube gives no "reach" and no "saves" for a video. Its analytics lag a day or two, so a new Short
has its views and likes at once and its other numbers later; a missing number is None, never 0.

Which uploads are Shorts: YouTube keeps a playlist of them per channel ("UUSH" + the channel's id
without its first two letters). When that is not there, uploads of up to 3 minutes are taken instead
and the result says so.

The last result is kept in %USERPROFILE%\\.link\\youtube_cache.json so the screen opens at once.
"""
import base64
import datetime
import hashlib
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import safe

DATA = Path.home() / ".link"   # not under AppData, see link.pyw
TOKEN_FILE, CACHE_FILE = DATA / "youtube.json", DATA / "youtube_cache.json"
# The variables are for tests.
AUTH = os.environ.get("LINK_GOOGLE_AUTH", "https://accounts.google.com/o/oauth2/v2/auth")
TOKEN = os.environ.get("LINK_GOOGLE_TOKEN", "https://oauth2.googleapis.com/token")
API = os.environ.get("LINK_YOUTUBE_API", "https://www.googleapis.com/youtube/v3")
REPORTS = os.environ.get("LINK_YOUTUBE_ANALYTICS", "https://youtubeanalytics.googleapis.com/v2/reports")
REDIRECT = "http://127.0.0.1:8765/youtube/callback"
UPLOADS = os.environ.get("LINK_YOUTUBE_UPLOAD", "https://www.googleapis.com/upload/youtube/v3/videos")
UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
SCOPES = f"https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly {UPLOAD_SCOPE}"
PRIVACY = ("private", "unlisted", "public")
MAX_POSTS = 200
SHORT_MAX = 180            # seconds: the longest a Short can be, for when the Shorts playlist is not there
VIDEO_METRICS = ["views", "likes", "comments", "shares", "averageViewDuration", "averageViewPercentage", "subscribersGained"]
ACCOUNT_METRICS = ["views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained"]

_lock = threading.Lock()   # the server answers side by side; one of them renews the sign-in at a time
_pending = {}              # sign-in in progress: state -> PKCE verifier, kept until Google sends the user back
_trouble = ""              # why the last sign-in did not work, for the screen that is waiting for it


class YouTubeError(Exception):
    """Something Google said no to, in words the user can act on."""


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


# ---------------------------------------------------------------- signing in

def set_client(client_id, client_secret):
    """Keep the ID and secret of the user's OAuth client. New ones forget the sign-in made with the old."""
    client_id, client_secret = "".join(str(client_id).split()), "".join(str(client_secret).split())
    if not re.fullmatch(r"[\w-]+\.apps\.googleusercontent\.com", client_id):
        raise YouTubeError("That is not a Client ID. Copy the one ending in .apps.googleusercontent.com from your OAuth client in Google Cloud.")
    if len(client_secret) < 16:
        raise YouTubeError("That does not look like the client secret. Copy it from the same OAuth client in Google Cloud.")
    write_json(TOKEN_FILE, {"client_id": client_id, "client_secret": client_secret})
    CACHE_FILE.unlink(missing_ok=True)


def sign_in_url():
    """Google's own sign-in page for this client, with a fresh PKCE challenge."""
    global _trouble
    _trouble = ""
    s = saved()
    if not s.get("client_id"):
        raise YouTubeError("Paste your OAuth client's ID and secret first.")
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    _pending.clear()
    _pending[state] = verifier
    return f"{AUTH}?" + urllib.parse.urlencode({
        "client_id": s["client_id"], "response_type": "code", "redirect_uri": REDIRECT, "scope": SCOPES,
        "access_type": "offline", "prompt": "consent",   # so that Google gives a refresh token every time
        "code_challenge_method": "S256", "code_challenge": challenge, "state": state})


def finish_sign_in(params):
    """Google sent the browser back to Link with ?code=...&state=... (or ?error=...)."""
    global _trouble
    try:
        _finish_sign_in(params)
    except YouTubeError as e:
        _trouble = str(e)
        raise


def _finish_sign_in(params):
    if params.get("error"):
        raise YouTubeError("You declined on Google's page, so nothing was connected." if params["error"] == "access_denied"
                           else f"Google said: {params['error']}.")
    verifier = _pending.pop(params.get("state", ""), None)
    if not verifier:
        raise YouTubeError("This sign-in is out of date. Press Connect in Link again.")
    s = saved()
    token = token_request(grant_type="authorization_code", code=params.get("code", ""), redirect_uri=REDIRECT,
                          client_id=s.get("client_id", ""), client_secret=s.get("client_secret", ""), code_verifier=verifier)
    if not token.get("refresh_token"):
        raise YouTubeError("Google gave no lasting sign-in. Press Connect again and tick every permission on Google's page.")
    store(s, token)
    CACHE_FILE.unlink(missing_ok=True)


def token_request(**form):
    request = urllib.request.Request(TOKEN, data=urllib.parse.urlencode(form).encode(),
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
            raise YouTubeError("Google no longer accepts Link's sign-in. Press Connect again. (While your Google project is "
                               "in Testing, a sign-in lasts 7 days; publishing it makes it last.)") from None
        if error.get("error") in ("invalid_client", "unauthorized_client"):
            raise YouTubeError("Google does not accept that Client ID and secret. Check both in your OAuth client in Google Cloud.") from None
        if error.get("error") == "redirect_uri_mismatch":
            raise YouTubeError(f"The OAuth client does not list Link's address. Add {REDIRECT} under Authorised redirect URIs.") from None
        raise YouTubeError(error.get("error_description") or f"Google's sign-in answered HTTP {e.code}.") from None
    except OSError as e:
        raise YouTubeError(f"Google could not be reached ({e}).") from None


def store(s, token):
    s.update(access=token["access_token"], expires=time.time() + token.get("expires_in", 3600) - 60,
             refresh=token.get("refresh_token") or s.get("refresh"),
             scopes=token.get("scope") or s.get("scopes") or "")   # what the user ticked on Google's page
    write_json(TOKEN_FILE, s)


def access_token(renew=False):
    """A valid access token, renewed with the saved refresh token when it has run out (after an hour)."""
    with _lock:
        s = saved()
        if not s.get("refresh"):
            raise YouTubeError("Link is not connected to YouTube yet.")
        if renew or time.time() >= s.get("expires", 0):
            store(s, token_request(grant_type="refresh_token", refresh_token=s["refresh"],
                                   client_id=s["client_id"], client_secret=s["client_secret"]))
        return s["access"]


def disconnect():
    """Forget the sign-in; the client's ID and secret stay, so Connect is one press away."""
    s = saved()
    write_json(TOKEN_FILE, {k: s[k] for k in ("client_id", "client_secret") if s.get(k)})
    CACHE_FILE.unlink(missing_ok=True)


def can_upload():
    return UPLOAD_SCOPE in (saved().get("scopes") or "").split()


def forget():
    """Forget everything: the sign-in and the client."""
    TOKEN_FILE.unlink(missing_ok=True)
    CACHE_FILE.unlink(missing_ok=True)


# ---------------------------------------------------------------- reading

def call(url, retry=True, **params):
    request = urllib.request.Request(url + "?" + urllib.parse.urlencode(params),
                                     headers={"Authorization": f"Bearer {access_token(renew=not retry)}"})
    try:
        with urllib.request.urlopen(request, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            error = json.load(e).get("error", {})
        except (ValueError, AttributeError):
            error = {}
        error = error if isinstance(error, dict) else {"message": str(error)}
        reasons = {d.get("reason", "") for d in error.get("errors", []) if isinstance(d, dict)}
        message = error.get("message", "")
        if e.code == 401 and retry:   # the token ran out early: renew it once and try again
            return call(url, retry=False, **params)
        if e.code == 401:
            raise YouTubeError("Google no longer accepts Link's sign-in. Press Connect again.") from None
        if "accessNotConfigured" in reasons or "has not been used in project" in message or "is disabled" in message:
            which = "YouTube Analytics API" if url == REPORTS else "YouTube Data API v3"
            raise YouTubeError(f"The {which} is not switched on in your Google Cloud project. Enable it under APIs & Services, wait a minute and press Refresh.") from None
        if reasons & {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}:
            raise YouTubeError("Google's daily allowance for your project is used up. It starts again at midnight, Pacific time.") from None
        if "youtubeSignupRequired" in reasons:
            raise YouTubeError("That Google account has no YouTube channel. Sign in with the account your channel belongs to.") from None
        if e.code == 404 and "playlistNotFound" in reasons:
            raise LookupError("no such playlist") from None
        raise YouTubeError(message or f"YouTube answered HTTP {e.code}.") from None
    except OSError as e:
        raise YouTubeError(f"YouTube could not be reached ({e}).") from None


def channel():
    items = call(f"{API}/channels", part="snippet,statistics,contentDetails", mine="true").get("items") or []
    if not items:
        raise YouTubeError("That Google account has no YouTube channel. Sign in with the account your channel belongs to.")
    return items[0]


def playlist_ids(playlist):
    """The ids of the videos in a playlist, newest first, up to MAX_POSTS."""
    ids, page = [], None
    while len(ids) < MAX_POSTS:
        params = {"part": "contentDetails", "playlistId": playlist, "maxResults": 50}
        if page:
            params["pageToken"] = page
        got = call(f"{API}/playlistItems", **params)
        ids += [i["contentDetails"]["videoId"] for i in got.get("items", []) if i.get("contentDetails", {}).get("videoId")]
        page = got.get("nextPageToken")
        if not page:
            break
    return ids[:MAX_POSTS]


def seconds(iso):
    """PT1M5S -> 65."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", iso or "")
    if not m:
        return None
    d, h, mi, s = (float(x) if x else 0 for x in m.groups())
    return round(d * 86400 + h * 3600 + mi * 60 + s)


def videos(ids):
    """Title, date, length and the public counts of each video."""
    out = []
    for i in range(0, len(ids), 50):
        out += call(f"{API}/videos", part="snippet,statistics,contentDetails", id=",".join(ids[i:i + 50]), maxResults=50).get("items", [])
    return out


def report(**params):
    """One YouTube Analytics report as a list of {column: value}."""
    got = call(REPORTS, ids="channel==MINE", **params)
    names = [c["name"] for c in got.get("columnHeaders", [])]
    return [dict(zip(names, row)) for row in got.get("rows") or []]


def video_analytics(ids, since, until):
    """{video id: {metric: number}} for the videos Google has analytics for; the others are left out."""
    out = {}
    for i in range(0, len(ids), 100):
        try:
            rows = report(startDate=since, endDate=until, metrics=",".join(VIDEO_METRICS), dimensions="video",
                          filters="video==" + ",".join(ids[i:i + 100]), maxResults=200, sort="-views")
        except YouTubeError:
            if i == 0:
                raise
            break   # the first hundred came; show them rather than nothing
        for row in rows:
            out[row.pop("video")] = row
    return out


def account_analytics(until, days=28, since=None):
    """Totals of the last `days` days (or from `since` on), of the Shorts only when the API takes that filter.
    Returns (numbers, of Shorts only?)."""
    since = since or (datetime.date.fromisoformat(until) - datetime.timedelta(days=days)).isoformat()
    # Google's documentation writes the value in capitals; the API itself takes and gives it in small letters.
    for filters in ("creatorContentType==shorts", "creatorContentType==SHORTS", None):
        try:
            params = {"startDate": since, "endDate": until, "metrics": ",".join(ACCOUNT_METRICS)}
            if filters:
                params["filters"] = filters
            rows = report(**params)
            return (rows[0] if rows else {}), bool(filters)
        except YouTubeError:
            continue
    return {}, False


def fetch():
    """Everything the Analytics screen shows, read from YouTube now and kept as the cache."""
    me = channel()
    snippet, stats = me.get("snippet", {}), me.get("statistics", {})
    note = ""
    try:
        ids = playlist_ids("UUSH" + me["id"][2:])
    except LookupError:
        ids = None
    listed = videos(ids) if ids else []
    if ids is None:   # no Shorts playlist: take the short uploads
        uploads = me.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        try:
            listed = [v for v in videos(playlist_ids(uploads)) if (seconds(v.get("contentDetails", {}).get("duration")) or 0) <= SHORT_MAX] if uploads else []
        except LookupError:
            listed = []
        note = "YouTube did not give its list of your Shorts, so these are your uploads of up to 3 minutes."
    today = datetime.date.today().isoformat()
    started = (snippet.get("publishedAt") or "2005-02-14")[:10]
    try:
        analytics, trouble = video_analytics([v["id"] for v in listed], started, today), ""
    except YouTubeError as e:
        analytics, trouble = {}, str(e)
    number = lambda value: int(value) if str(value).lstrip("-").isdigit() else None
    posts = []
    for v in listed:
        s, st, a = v.get("snippet", {}), v.get("statistics", {}), analytics.get(v["id"], {})
        thumbs = s.get("thumbnails", {})
        thumb = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url")
        watch, share = a.get("averageViewDuration"), a.get("averageViewPercentage")
        posts.append({
            "id": v["id"], "link": f"https://www.youtube.com/shorts/{v['id']}", "thumbnail": thumb,
            "caption": s.get("title") or "", "posted": s.get("publishedAt"), "kind": "SHORT",
            "length": seconds(v.get("contentDetails", {}).get("duration")),
            # the public counts are up to the minute; the analytics behind them lag a day or two
            "views": number(st.get("viewCount")) if st.get("viewCount") is not None else a.get("views"),
            "likes": number(st.get("likeCount")) if st.get("likeCount") is not None else a.get("likes"),
            "comments": number(st.get("commentCount")) if st.get("commentCount") is not None else a.get("comments"),
            "shares": a.get("shares"),
            "watch_seconds": round(watch, 1) if isinstance(watch, (int, float)) else None,
            "watched_percent": round(share, 1) if isinstance(share, (int, float)) else None,
            "subscribers": a.get("subscribersGained"),
        })
    recent, shorts_only = account_analytics(today)
    # the same totals over each stretch the Analytics screen offers; all time is since the channel began
    periods = {"7": account_analytics(today, 7)[0], "28": recent, "all": account_analytics(today, since=started)[0]}
    result = {
        "fetched": time.time(),
        "account": {"username": (snippet.get("customUrl") or "").lstrip("@") or snippet.get("title"), "name": snippet.get("title"),
                    "followers": None if stats.get("hiddenSubscriberCount") else number(stats.get("subscriberCount")),
                    "posts": len(posts), "picture": (snippet.get("thumbnails", {}).get("default") or {}).get("url"),
                    "link": f"https://www.youtube.com/channel/{me['id']}"},
        "last_28_days": recent, "last_28_days_shorts_only": shorts_only, "periods": periods,
        "posts": posts, "note": " ".join(x for x in (note, trouble) if x),
    }
    write_json(CACHE_FILE, result)
    return result


# How YouTube names where a view came from, in plain words.
SOURCES = {"SHORTS": "Shorts feed", "YT_SEARCH": "YouTube search", "SUBSCRIBER": "Subscriptions and home", "YT_CHANNEL": "Your channel page",
           "RELATED_VIDEO": "Suggested videos", "EXT_URL": "Other websites and apps", "NO_LINK_OTHER": "Direct or unknown",
           "NO_LINK_EMBEDDED": "Embedded elsewhere", "PLAYLIST": "Playlists", "NOTIFICATION": "Notifications", "YT_OTHER_PAGE": "Other YouTube pages",
           "HASHTAGS": "Hashtag pages", "SOUND_PAGE": "Sound pages", "END_SCREEN": "End screens", "ADVERTISING": "Advertising",
           "YT_PLAYLIST_PAGE": "Playlist pages", "SHORTS_CONTENT_LINKS": "Links in Shorts", "LIVE_REDIRECT": "Live redirects",
           "CAMPAIGN_CARD": "Campaign cards", "ANNOTATION": "Cards", "PRODUCT_PAGE": "Product pages", "VIDEO_REMIXES": "Remixes"}


def video_details(video_id):
    """One Short in depth, read now: its description and settings, its totals, its views day by day,
    where the views came from and the countries they came from. A part Google does not give is None."""
    if not re.fullmatch(r"[\w-]{6,20}", str(video_id)):
        raise YouTubeError("That is not a video.")
    items = call(f"{API}/videos", part="snippet,statistics,contentDetails,status", id=video_id).get("items") or []
    if not items:
        raise YouTubeError("YouTube no longer lists that video.")
    v = items[0]
    s, status, content = v.get("snippet", {}), v.get("status", {}), v.get("contentDetails", {})
    since, today = (s.get("publishedAt") or "2005-02-14")[:10], datetime.date.today().isoformat()

    def ask(**params):
        try:
            return report(startDate=since, endDate=today, filters=f"video=={video_id}", **params)
        except YouTubeError:
            return None

    totals = ask(metrics="views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,dislikes,comments,shares,subscribersGained,subscribersLost")
    days = ask(metrics="views,estimatedMinutesWatched", dimensions="day", sort="day")
    sources = ask(metrics="views", dimensions="insightTrafficSourceType", sort="-views")
    countries = ask(metrics="views", dimensions="country", sort="-views", maxResults=5)
    return {
        "description": s.get("description") or "", "tags": s.get("tags") or [], "privacy": status.get("privacyStatus"),
        "made_for_kids": status.get("madeForKids"), "definition": content.get("definition"), "language": s.get("defaultAudioLanguage") or s.get("defaultLanguage"),
        "totals": totals[0] if totals else None,
        "days": [{"day": d["day"], "views": d.get("views") or 0, "minutes": d.get("estimatedMinutesWatched") or 0} for d in days] if days is not None else None,
        "sources": [{"name": SOURCES.get(r["insightTrafficSourceType"], r["insightTrafficSourceType"].replace("_", " ").capitalize()), "views": r.get("views") or 0}
                    for r in sources if r.get("views")] if sources is not None else None,
        "countries": [{"code": r["country"], "views": r.get("views") or 0} for r in countries if r.get("views")] if countries is not None else None,
    }


# ---------------------------------------------------------------- uploading

def upload_trouble(e):
    """What Google said no to when a video was sent, in words the user can act on."""
    try:
        error = json.load(e).get("error", {})
    except (ValueError, AttributeError):
        error = {}
    error = error if isinstance(error, dict) else {"message": str(error)}
    reasons = {d.get("reason", "") for d in error.get("errors", []) if isinstance(d, dict)}
    if e.code == 401:
        return "Google no longer accepts Link's sign-in. Press Connect in Analytics again."
    if reasons & {"insufficientPermissions", "forbidden"} or "insufficient authentication scopes" in error.get("message", "").lower():
        return "This sign-in may not upload. Sign in to YouTube again and tick the permission to manage your videos."
    if reasons & {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}:
        return "Google's daily allowance for your project is used up (an upload takes 1600 of its 10,000 units). It starts again at midnight, Pacific time."
    if "uploadLimitExceeded" in reasons:
        return "YouTube says this channel has uploaded as many videos as it may for now. Try again tomorrow."
    if "youtubeSignupRequired" in reasons:
        return "That Google account has no YouTube channel. Sign in with the account your channel belongs to."
    if reasons & {"invalidTitle", "invalidDescription"}:
        return "YouTube does not take that title or description. Take out < and >, and keep the title under 100 letters."
    return error.get("message") or f"YouTube answered HTTP {e.code}."


def upload(path, title, description="", privacy="private"):
    """Put a finished reel on the channel as a Short. Returns {"id", "link", "privacy"}: the privacy is
    what YouTube made it, which is private for a project that has not passed Google's audit."""
    path = Path(path)
    if not path.is_file():
        raise YouTubeError(f"{path.name} is not there any more.")
    if not can_upload():
        raise YouTubeError("This sign-in may not upload. Sign in to YouTube again and tick the permission to manage your videos.")
    clean = lambda text: str(text or "").replace("<", "").replace(">", "").strip()
    title = clean(title)[:100]
    if not title:
        raise YouTubeError("A Short needs a title.")
    about = {"snippet": {"title": title, "description": clean(description)[:5000], "categoryId": "22"},
             "status": {"privacyStatus": privacy if privacy in PRIVACY else "private", "selfDeclaredMadeForKids": False}}
    size = path.stat().st_size
    try:
        # Google's "resumable" upload: first what the video is, then the file itself to the address Google answers with.
        begin = urllib.request.Request(UPLOADS + "?uploadType=resumable&part=snippet,status", data=json.dumps(about).encode(), method="POST",
                                       headers={"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json; charset=UTF-8",
                                                "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size)})
        with urllib.request.urlopen(begin, timeout=30) as res:
            where = res.headers.get("Location")
        if not where:
            raise YouTubeError("YouTube did not say where to send the video.")
        with open(path, "rb") as f:
            send = urllib.request.Request(where, data=f, method="PUT", headers={"Content-Type": "video/mp4", "Content-Length": str(size)})
            with urllib.request.urlopen(send, timeout=900) as res:
                made = json.load(res)
    except urllib.error.HTTPError as e:
        raise YouTubeError(upload_trouble(e)) from None
    except (OSError, ValueError) as e:
        raise YouTubeError(f"The upload did not get through ({e}).") from None
    if not made.get("id"):
        raise YouTubeError("YouTube took the file but gave no video back.")
    CACHE_FILE.unlink(missing_ok=True)   # the numbers on file do not have this Short yet
    return {"id": made["id"], "link": f"https://www.youtube.com/shorts/{made['id']}", "privacy": (made.get("status") or {}).get("privacyStatus")}


def cached():
    return read_json(CACHE_FILE)


def status():
    """What the Analytics screen needs. The secret and the tokens never leave the server."""
    s = saved()
    return {"client": bool(s.get("client_id") and s.get("client_secret")), "connected": bool(s.get("refresh")), "can_upload": bool(s.get("refresh")) and can_upload(),
            "redirect": REDIRECT, "trouble": _trouble, "data": cached()}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        print(json.dumps(fetch(), indent=1, ensure_ascii=False))
    except YouTubeError as e:
        sys.exit(str(e))
