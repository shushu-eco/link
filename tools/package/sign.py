"""Signs a release of Link with Link's own key, so that an installed Link takes an update only from
whoever holds that key, not from whoever can publish on GitHub.

    python tools/package/sign.py --new            make the key (once); says the public half
    python tools/package/sign.py --public         say the public half of the key that is here
    python tools/package/sign.py <latest.json>    write <latest.json>.sig beside it

The key is 32 random bytes in %USERPROFILE%\\.link\\release-key.txt, on the publisher's PC and nowhere
else: not in the repository, not on GitHub. Its public half is PUBLIC_KEY in tools/reels/update.py,
which every installed Link carries. release.ps1 calls this for each release.

Keep a copy of release-key.txt somewhere safe and offline. Without it no installed Link can be
updated any more (they refuse what is not signed with it), and a new installer would have to be
handed out with a new key. Whoever has it can update every Link.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "reels"))
import ed25519  # noqa: E402
import update  # noqa: E402

KEY = Path(os.environ.get("LINK_RELEASE_KEY") or Path.home() / ".link" / "release-key.txt")


def secret():
    try:
        key = bytes.fromhex(KEY.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        sys.exit(f"There is no release key at {KEY}. Make one with --new, or put the kept copy back.")
    if len(key) != 32:
        sys.exit(f"{KEY} does not hold a key.")
    return key


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else ""
    if what == "--new":
        if KEY.exists():
            sys.exit(f"A key is there already ({KEY}). It is not replaced: installed copies of Link trust that one.")
        KEY.parent.mkdir(parents=True, exist_ok=True)
        KEY.write_text(os.urandom(32).hex() + "\n", encoding="ascii")
        print(f"Made {KEY}. Keep a copy of it somewhere safe and offline.")
        print("PUBLIC_KEY for tools/reels/update.py:", ed25519.public_key(secret()).hex())
        return
    if what == "--public":
        print(ed25519.public_key(secret()).hex())
        return
    if not what or not Path(what).is_file():
        sys.exit(__doc__)
    key = secret()
    public = ed25519.public_key(key).hex()
    if public != update.PUBLIC_KEY:
        sys.exit("The key here is not the one Link trusts (PUBLIC_KEY in tools/reels/update.py): nothing was signed.")
    data = Path(what).read_bytes()
    signature = ed25519.sign(key, data)
    if not ed25519.verify(bytes.fromhex(public), data, signature):
        sys.exit("The signature does not check out: nothing was written.")
    Path(what + ".sig").write_text(signature.hex() + "\n", encoding="ascii")
    print(f"signed {Path(what).name} -> {Path(what).name}.sig")


if __name__ == "__main__":
    main()
