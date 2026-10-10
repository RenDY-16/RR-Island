"""Small advisory file lock shared by the bridge and status hook."""
import os
import sys
import time
from pathlib import Path


class FileLock:
    def __init__(self, path, *, blocking=False, timeout=30):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a+b")
        self.locked = False
        self._lock(blocking, timeout)

    def _lock(self, blocking, timeout):
        if sys.platform == "win32":
            import msvcrt

            self.file.seek(0, os.SEEK_END)
            if self.file.tell() == 0:
                self.file.write(b"\0")
                self.file.flush()
            deadline = time.monotonic() + timeout
            while True:
                self.file.seek(0)
                try:
                    msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
                    self.locked = True
                    return
                except OSError:
                    if not blocking or time.monotonic() >= deadline:
                        self.file.close()
                        raise BlockingIOError("file is already locked") from None
                    time.sleep(0.05)
        else:
            import fcntl

            flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
            try:
                fcntl.flock(self.file.fileno(), flags)
                self.locked = True
            except BlockingIOError:
                self.file.close()
                raise

    def close(self):
        if self.file.closed:
            return
        if self.locked:
            if sys.platform == "win32":
                import msvcrt

                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
            self.locked = False
        self.file.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

