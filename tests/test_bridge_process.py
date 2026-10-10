import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BridgeProcessTests(unittest.TestCase):
    def test_bridge_starts_codex_and_uses_json_lines_on_native_platform(self):
        with tempfile.TemporaryDirectory(prefix="rr island ") as directory:
            root = Path(directory)
            fake = root / "fake_codex.py"
            fake.write_text(
                "import json,sys\n"
                "for line in sys.stdin:\n"
                " request=json.loads(line)\n"
                " print(json.dumps({'id':request['id'],'result':{}}),flush=True)\n",
                encoding="utf-8",
            )
            binary = fake
            if os.name == "nt":
                binary = root / "fake_codex.cmd"
                py = subprocess.list2cmdline([sys.executable, str(fake)])
                binary.write_text(f"@echo off\r\n{py} %*\r\n", encoding="utf-8")
            else:
                binary.chmod(0o755)
                fake.write_text(
                    f"#!{sys.executable}\n" + fake.read_text(encoding="utf-8"),
                    encoding="utf-8",
                )

            proc = subprocess.Popen(
                [sys.executable, str(ROOT / "bridge.py"), "--codex-binary", str(binary),
                 "--state-dir", str(root / "state"), "--idle-seconds", "60"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
            )
            try:
                events = []
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    line = proc.stdout.readline()
                    if not line:
                        break
                    event = json.loads(line)
                    events.append(event)
                    if event.get("event") == "ready":
                        break
                self.assertTrue(any(e.get("event") == "ready" for e in events), events)
                proc.stdin.write('{"id":"probe","op":"connect"}\n')
                proc.stdin.flush()
                deadline = time.monotonic() + 10
                reply = None
                while time.monotonic() < deadline:
                    line = proc.stdout.readline()
                    if not line:
                        break
                    event = json.loads(line)
                    if event.get("id") == "probe":
                        reply = event
                        break
                self.assertEqual(reply, {"id": "probe", "ok": True, "data": {"threadId": None}})
                proc.stdin.write('{"id":"quit","op":"shutdown"}\n')
                proc.stdin.flush()
                proc.wait(timeout=10)
                self.assertEqual(proc.returncode, 0, proc.stderr.read())
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5)
                for stream in (proc.stdin, proc.stdout, proc.stderr):
                    if stream and not stream.closed:
                        stream.close()


if __name__ == "__main__":
    unittest.main()
