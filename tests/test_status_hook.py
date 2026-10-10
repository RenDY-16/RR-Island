import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StatusHookTests(unittest.TestCase):
    def test_hook_updates_status_without_persisting_prompt_content(self):
        with tempfile.TemporaryDirectory(prefix="rr island hook ") as directory:
            state_dir = Path(directory) / "state with spaces"
            payload = {
                "hook_event_name":"PreToolUse",
                "session_id":"session-123",
                "cwd":directory,
                "tool_name":"shell",
                "prompt":"private prompt must not be written",
            }
            result = subprocess.run(
                [sys.executable,str(ROOT/"hook.py"),"--rr-island-owned-hook=v1","--state-dir",str(state_dir)],
                input=json.dumps(payload),text=True,capture_output=True,timeout=10,
            )
            self.assertEqual(result.returncode,0,result.stderr)
            status_file=state_dir/"status.json"
            data=json.loads(status_file.read_text(encoding="utf-8"))
            self.assertEqual(data["sessions"]["session-123"]["status"],"working")
            self.assertEqual(data["sessions"]["session-123"]["tool"],"shell")
            self.assertNotIn("private prompt",status_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
