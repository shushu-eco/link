"""Read the user's Instagram page through Instagram's official API (Instagram API with Instagram Login).

Usage:
    python tools/reels/instagram_api.py            print the analytics as JSON (fetches them now)

Needs a professional (Creator or Business) Instagram account and an access token made for it in the
Meta developer dashboard (Instagram > API setup with Instagram login > Generate token). The token is
kept in %USERPROFILE%\\.link\\instagram.json, never in the project and never sent to the dashboard
page. It lasts 60 days; fetching refreshes it once it is a week old, so it only runs out if Link is
not used for two months.

What it reads, with the permissions instagram_business_basic and instagram_business_manage_insights:
    the account      name, followers, number of posts
    every post       caption, date, link, thumbnail, likes, comments
    its insights     views, reach, shares, saves, average watch time (reels), interactions
    the last 28 days reach, views, accounts engaged and interactions of the whole account
Posting a reel (publish_reel) needs one more permission on the access key, instagram_business_content_publish.
A key without it still reads the numbers. Instagram lets a page publish 100 posts through the API in 24 hours.

Instagram's figures can lag by up to 48 hours, and a post's insights can be missing for a while
after it goes up; missing numbers are returned as None, never as 0.

The last result is kept in %USERPROFILE%\\.link\\instagram_cache.json so the screen opens at once.
"""
import calendar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import safe

DATA = Path.home() / ".link"   # not under AppData, see link.pyw
TOKEN_FILE, CACHE_FILE = DATA / "instagram.json", DATA / "instagram_cache.json"
API = os.environ.get("LINK_INSTAGRAM_API", "https://graph.instagram.com/v25.0")  # the variable is for tests
REFRESH_AFTER = 7 * 24 * 3600      # a token this old is exchanged for a fresh 60-day one
MAX_POSTS = 200
MEDIA_FIELDS = ["id", "permalink", "media_type", "thumbnail_url", "media_url", "timestamp", "like_count", "comments_count"]
OPTIONAL_FIELDS = ["caption", "media_product_type"]   # asked for too, dropped if the API refuses them
# Tried in this order; the first set the API accepts for a post is used.
INSIGHT_SETS = [["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"],
                ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"],
                ["views", "reach", "likes", "comments", "shares", "saved"],
                ["views", "reach"]]
ACCOUNT_METRICS = ["reach", "views", "accounts_engaged", "total_interactions"]
UPLOADS = os.environ.get("LINK_INSTAGRAM_UPLOAD", "")   # for tests; otherwise Instagram says where a reel's file goes
READY_WAIT = 300                   # seconds Instagram gets to take a reel in before Link gives up waiting
POLL = 3                           # seconds between looks at whether it has


class InstagramError(Exception):
    """Something Instagram said no to, in words the user can act on."""


class NoPermission(InstagramError):
    """The access key was made without the permission this needs."""


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(path, data):
    DATA.mkdir(parents=True, exist_ok=True)
    safe.write_json(path, data)   # whole or not there: half a file of sign-ins would mean signing in again


def call(path, token, post=False, **params):
    query = urllib.parse.urlencode({**params, "access_token": token})
    url = f"{API}/{path.lstrip('/')}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=query.encode()) if post else f"{url}?{query}", timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            error = json.load(e).get("error", {})
        except ValueError:
            error = {}
        message = error.get("message") or f"HTTP {e.code}"
        if error.get("code") == 190 or e.code == 401:
            raise InstagramError("Instagram no longer accepts the access key. Make a new one and connect again.") from None
        if error.get("code") == 10 or "permission" in message.lower():
            raise NoPermission(message) from None
        if "access blocked" in message.lower():
            # Meta refuses every call, the key included, so nothing Link sends can get past it.
            raise InstagramError("Meta has blocked API access for the app this access key was made in, or for the Instagram "
                                 "account. Link cannot undo that: open developers.facebook.com > My Apps and look for an alert "
                                 "on the app, and open Instagram to see whether the account has a restriction to clear. "
                                 "The numbers below are the last ones read. Once Meta lifts the block, press Refresh "
                                 "(or make a new key and connect again).") from None
        raise InstagramError(message) from None
    except OSError as e:
        raise InstagramError(f"Instagram could not be reached ({e}).") from None


def saved_token():
    return (read_json(TOKEN_FILE) or {}).get("token")


def connect(token):
    """Check a pasted access key against Instagram and keep it. Returns the account it belongs to."""
    token = "".join(str(token).split())
    if len(token) < 30:
        raise InstagramError("That does not look like an access key. Copy the whole key from the Meta dashboard.")
    account = call("me", token, fields="user_id,username,account_type")
    write_json(TOKEN_FILE, {"token": token, "saved": time.time(), "refreshed": time.time(), "username": account.get("username")})
    CACHE_FILE.unlink(missing_ok=True)
    return account


def disconnect():
    TOKEN_FILE.unlink(missing_ok=True)
    CACHE_FILE.unlink(missing_ok=True)


def fresh_token():
    """The saved token, exchanged for a new 60-day one when it is over a week old."""
    saved = read_json(TOKEN_FILE)
    if not saved or not saved.get("token"):
        raise InstagramError("No access key is saved yet.")
    if time.time() - saved.get("refreshed", 0) > REFRESH_AFTER:
        try:
            new = call("refresh_access_token", saved["token"], grant_type="ig_refresh_token")
            saved.update(token=new["access_token"], refreshed=time.time(), expires_in=new.get("expires_in"))
            write_json(TOKEN_FILE, saved)
        except (InstagramError, KeyError):
            pass  # the old token still works until its 60 days are over
    return saved["token"]


def media_list(token):
    fields, posts = [*MEDIA_FIELDS, *OPTIONAL_FIELDS], []
    try:
        page = call("me/media", token, fields=",".join(fields), limit=50)
    except InstagramError:
        fields = MEDIA_FIELDS
        page = call("me/media", token, fields=",".join(fields), limit=50)
    while True:
        posts += page.get("data", [])
        after = page.get("paging", {}).get("cursors", {}).get("after")
        if not after or not page.get("paging", {}).get("next") or len(posts) >= MAX_POSTS:
            return posts[:MAX_POSTS]
        page = call("me/media", token, fields=",".join(fields), limit=50, after=after)


def insights(token, media_id):
    """{metric: number} for one post; an empty dict when Instagram has no insights for it (yet)."""
    for metrics in INSIGHT_SETS:
        try:
            data = call(f"{media_id}/insights", token, metric=",".join(metrics)).get("data", [])
        except InstagramError:
            continue
        return {m["name"]: m["values"][0].get("value") for m in data if m.get("values")}
    return {}


def account_window(token, since, until):
    """Totals of the whole account between two moments; metrics Instagram does not return are left out."""
    out = {}
    for metric in ACCOUNT_METRICS:
        try:
            data = call("me/insights", token, metric=metric, period="day", metric_type="total_value",
                        since=since, until=until).get("data", [])
            out[metric] = data[0]["total_value"]["value"]
        except (InstagramError, LookupError, TypeError):
            pass
    return out


def account_insights(token, days=28):
    """Totals of the whole account over the last `days` days."""
    now = int(time.time())
    return account_window(token, now - days * 86400, now)


WINDOW = 28 * 86400       # Instagram answers for about a month at a time
FURTHEST = 730 * 86400    # and keeps these figures for about two years


def account_all_time(token, first):
    """Totals since `first` (the first post). Longer than one window is read window by window and added up:
    views and interactions add up exactly; reach and accounts engaged count somebody again in every window
    they turn up in, so those two are then more than the true number, which "approx" says."""
    now = int(time.time())
    start, until, out, windows = max(int(first), now - FURTHEST), now, {}, 0
    while until > start:
        since = max(start, until - WINDOW)
        for key, value in account_window(token, since, until).items():
            if isinstance(value, (int, float)):
                out[key] = out.get(key, 0) + value
        until, windows = since, windows + 1
    if windows > 1:
        out["approx"] = [k for k in ("reach", "accounts_engaged") if k in out]
    return out


def first_post(posts, fallback):
    """When the oldest post went up, as seconds; `fallback` when there is none to go by."""
    times = []
    for p in posts:
        try:
            times.append(calendar.timegm(time.strptime(p["posted"][:19], "%Y-%m-%dT%H:%M:%S")))   # Instagram's times are UTC
        except (KeyError, TypeError, ValueError):
            pass
    return min(times) - 86400 if times else fallback   # a day before it, so its first hours are inside


def fetch():
    """Everything the Analytics screen shows, read from Instagram now and kept as the cache."""
    token = fresh_token()
    me = call("me", token, fields="user_id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url")
    posts = []
    for m in media_list(token):
        got = insights(token, m["id"])
        number = lambda key, fallback=None: got.get(key, m.get(fallback) if fallback else None)
        watch = got.get("ig_reels_avg_watch_time")
        posts.append({
            "id": m["id"], "link": m.get("permalink"), "thumbnail": m.get("thumbnail_url") or m.get("media_url"),
            "caption": m.get("caption") or "", "posted": m.get("timestamp"),
            "kind": m.get("media_product_type") or m.get("media_type") or "",
            "views": number("views"), "reach": number("reach"),
            "likes": number("likes", "like_count"), "comments": number("comments", "comments_count"),
            "shares": number("shares"), "saves": number("saved"),
            "interactions": number("total_interactions"),
            "watch_seconds": round(watch / 1000, 1) if isinstance(watch, (int, float)) else None,  # the API gives milliseconds
        })
    # the whole account over each stretch the Analytics screen offers; "last_28_days" is kept for a cache read by an older page
    periods = {"7": account_insights(token, 7), "28": account_insights(token, 28),
               "all": account_all_time(token, first_post(posts, time.time() - WINDOW))}
    result = {
        "fetched": time.time(),
        "account": {"username": me.get("username"), "name": me.get("name"), "type": me.get("account_type"),
                    "followers": me.get("followers_count"), "following": me.get("follows_count"),
                    "posts": me.get("media_count"), "picture": me.get("profile_picture_url")},
        "last_28_days": periods["28"], "periods": periods,
        "posts": posts,
    }
    write_json(CACHE_FILE, result)
    return result


# Asked for one at a time: which of them a post has depends on its kind, and one refusal must not lose the others.
EXTRA_INSIGHTS = ["ig_reels_video_view_total_time", "follows", "profile_visits"]
DETAIL_FIELDS = ["shortcode", "is_comment_enabled", "is_shared_to_feed", "media_product_type", "media_type"]


def media_details(media_id):
    """One post in depth, read now: its settings, the insights the list does not ask for, and its
    newest comments. A part Instagram does not give is None."""
    if not str(media_id).isdigit():
        raise InstagramError("That is not a post.")
    token = fresh_token()
    about, refused = None, None
    for fields in (DETAIL_FIELDS, ["media_product_type", "media_type"]):
        try:
            about = call(str(media_id), token, fields=",".join(fields))
            break
        except InstagramError as e:
            refused = e
    if about is None:   # Instagram knows no such post (or will not show it to this key): say so, not a page of blanks
        raise InstagramError(f"Instagram could not find that post. ({refused})")
    extra = {}
    for metric in EXTRA_INSIGHTS:
        try:
            data = call(f"{media_id}/insights", token, metric=metric).get("data", [])
            extra[metric] = data[0]["values"][0].get("value")
        except (InstagramError, LookupError, TypeError):
            pass
    try:
        said = call(f"{media_id}/comments", token, fields="text,username,timestamp,like_count", limit=10).get("data", [])
        comments = [{"who": c.get("username") or "", "text": c.get("text") or "", "at": c.get("timestamp"), "likes": c.get("like_count") or 0} for c in said]
    except InstagramError:
        comments = None   # the access key was made without the permission to read comments
    total = extra.get("ig_reels_video_view_total_time")
    return {
        "shortcode": about.get("shortcode"), "comments_on": about.get("is_comment_enabled"), "in_feed": about.get("is_shared_to_feed"),
        "total_watch_seconds": round(total / 1000) if isinstance(total, (int, float)) else None,   # the API gives milliseconds
        "follows": extra.get("follows"), "profile_visits": extra.get("profile_visits"),
        "comments": comments,
    }


# ---------------------------------------------------------------- posting

NEEDS_PUBLISH = ("This access key may not post. In the Meta dashboard add the permission instagram_business_content_publish "
                 "to your app, generate a new key and connect it in Analytics.")


def publish_known():
    """Whether the saved key may post, as far as is known without asking Instagram: True, False, or None for not asked yet."""
    return (read_json(TOKEN_FILE) or {}).get("publish")


def can_publish():
    """Whether the saved key may post. Asked from Instagram once per key and kept with it."""
    saved = read_json(TOKEN_FILE)
    if not saved or not saved.get("token"):
        return False
    if "publish" not in saved:
        try:
            call("me/content_publishing_limit", saved["token"], fields="quota_usage")   # only a key that may post may ask this
            saved["publish"] = True
        except NoPermission:
            saved["publish"] = False
        except InstagramError:
            return False   # Instagram could not be asked just now: ask again next time
        write_json(TOKEN_FILE, saved)
    return saved["publish"]


def publish_reel(path, caption=""):
    """Post a finished reel on the page, with its caption. Returns {"id", "link"}.
    Instagram's way: say a reel is coming, send the file, wait until it has taken it in, then publish."""
    path = Path(path)
    if not path.is_file():
        raise InstagramError(f"{path.name} is not there any more.")
    token = fresh_token()
    if not can_publish():
        raise InstagramError(NEEDS_PUBLISH)
    try:
        me = call("me", token, fields="user_id")["user_id"]
        box = call(f"{me}/media", token, post=True, media_type="REELS", upload_type="resumable", caption=str(caption or "")[:2200])
        size = path.stat().st_size
        with open(path, "rb") as f:
            send = urllib.request.Request(UPLOADS or box["uri"], data=f, method="POST",
                                          headers={"Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size), "Content-Length": str(size)})
            try:
                with urllib.request.urlopen(send, timeout=900) as res:
                    res.read()
            except urllib.error.HTTPError as e:
                raise InstagramError(f"Instagram did not take the file (HTTP {e.code}).") from None
            except OSError as e:
                raise InstagramError(f"The upload did not get through ({e}).") from None
        for _ in range(int(READY_WAIT / POLL)):
            state = call(box["id"], token, fields="status_code,status")
            if state.get("status_code") == "FINISHED":
                break
            if state.get("status_code") in ("ERROR", "EXPIRED"):
                raise InstagramError(f"Instagram could not use the video: {state.get('status') or state['status_code']}.")
            time.sleep(POLL)
        else:
            raise InstagramError("Instagram is still taking the video in after five minutes. Nothing was posted; try again later.")
        made = call(f"{me}/media_publish", token, post=True, creation_id=box["id"])
    except NoPermission:
        raise InstagramError(NEEDS_PUBLISH) from None
    except KeyError as e:
        raise InstagramError(f"Instagram's answer had no {e}.") from None
    try:
        link = call(made["id"], token, fields="permalink").get("permalink")
    except InstagramError:
        link = None   # it is posted; only its address could not be read
    CACHE_FILE.unlink(missing_ok=True)   # the numbers on file do not have this reel yet
    return {"id": made["id"], "link": link}


def cached():
    return read_json(CACHE_FILE)


if __name__ == "__main__":
    try:
        print(json.dumps(fetch(), indent=1, ensure_ascii=False))
    except InstagramError as e:
        sys.exit(str(e))
