"""Files that are whole or not there, and jobs that end with the program that started them.

Link can be closed, or the PC switched off, at any moment. Two things keep that from leaving
something half-made behind:

    write_text, write_json   write next to the file under another name, then put it in the file's
                             place in one step. A reader sees the old file or the new one, never
                             half of the new one. A name ending in PART is such an unfinished write
                             and may be deleted.
    read_json                None for a file that is missing or cannot be read, instead of an error:
                             one damaged file must not stop everything that looks at all of them.
    end_with_me              a process started by this one is ended by Windows when this one ends,
                             however it ends. Without it a job outlives a closed Link, works on with
                             nobody reading what it says, and dies halfway at its next line.
"""
import ctypes
import json
import os
import sys
import time
from pathlib import Path

PART = ".part"


def write_text(path, text):
    path = Path(path)
    tmp = path.with_name(path.name + PART)
    tmp.write_text(text, encoding="utf-8")
    for attempt in range(5):
        try:
            return os.replace(tmp, path)
        except PermissionError:   # Windows: something is reading the file this instant
            if attempt == 4:
                raise
            time.sleep(0.05)


def write_json(path, data, **how):
    write_text(path, json.dumps(data, **{"ensure_ascii": False, **how}))


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))   # a BOM from a Windows editor is fine
    except (OSError, ValueError):
        return None


_job = None   # Windows' "job object": the processes put in it are ended when its last handle closes, which is when this process ends


def end_with_me(process):
    """Tie a subprocess.Popen, and everything it starts from now on, to the life of this process."""
    global _job
    if sys.platform != "win32":
        return
    try:
        kernel = ctypes.windll.kernel32
        kernel.CreateJobObjectW.restype = ctypes.c_void_p
        if _job is None:
            job = kernel.CreateJobObjectW(None, None)
            # JOBOBJECT_EXTENDED_LIMIT_INFORMATION, of which only LimitFlags is set: KILL_ON_JOB_CLOSE
            info = (ctypes.c_byte * 144)() if ctypes.sizeof(ctypes.c_void_p) == 8 else (ctypes.c_byte * 112)()
            ctypes.c_uint32.from_buffer(info, 16).value = 0x2000
            if not job or not kernel.SetInformationJobObject(ctypes.c_void_p(job), 9, info, len(info)):
                return
            _job = job
        kernel.AssignProcessToJobObject(ctypes.c_void_p(_job), ctypes.c_void_p(int(process._handle)))
    except (OSError, AttributeError, ValueError):
        pass   # the job then outlives a closed Link, as it did before; what it leaves is found at the next start
