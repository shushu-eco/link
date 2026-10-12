"""Builds a private copy of Link for testing: its code, one sample tape, a home folder of its own.
usage (from the project's root): python tools/reels/test/make_copy.py <folder> [SRC-id]

The copy has its own home folder (settings, sign-ins, Discord: none), its own library with the one
sample tape, and Link's heavy parts (Electron, the speech model) linked, not copied. window_test.js runs it."""
import pathlib
import shutil
import subprocess
import sys

T = pathlib.Path(sys.argv[1])
SAMPLE = sys.argv[2] if len(sys.argv) > 2 else 'SRC-003'
src = pathlib.Path('tools/reels')
dst = T / 'tools' / 'reels'
if dst.exists():
    for rel in ('shell/node_modules', 'models'):          # the links first, so nothing behind them is deleted
        subprocess.run(['cmd', '/c', 'rmdir', str(dst / rel)], capture_output=True)
    shutil.rmtree(T, ignore_errors=True)
for d in ('videos/reels', 'videos/sources', 'videos/finals', 'home', 'home/Videos'):
    (T / d).mkdir(parents=True, exist_ok=True)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns('node_modules', 'models', '__pycache__', 'test'))
for rel in ('shell/node_modules', 'models'):               # the heavy parts are not copied: linked
    subprocess.run(['cmd', '/c', 'mklink', '/J', str(dst / rel), str((src / rel).resolve())], capture_output=True)
shutil.copytree(f'videos/reels/{SAMPLE}', T / f'videos/reels/{SAMPLE}', ignore=shutil.ignore_patterns('preview'))
print('node_modules linked:', (dst / 'shell/node_modules/electron/dist/electron.exe').exists(), '| model linked:', (dst / 'models/ggml-small.bin').exists())
print('sample tape:', len(list((T / f'videos/reels/{SAMPLE}').iterdir())), 'files')
