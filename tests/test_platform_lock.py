import tempfile
import unittest
from pathlib import Path

from platform_lock import FileLock


class FileLockTests(unittest.TestCase):
    def test_lock_excludes_a_second_handle_and_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lease.lock"
            first = FileLock(path)
            with self.assertRaises(BlockingIOError):
                FileLock(path)
            first.close()
            second = FileLock(path)
            second.close()

    def test_context_manager_releases_after_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lease.lock"
            with self.assertRaisesRegex(RuntimeError, "sentinel"):
                with FileLock(path):
                    raise RuntimeError("sentinel")
            with FileLock(path):
                pass


if __name__ == "__main__":
    unittest.main()
