#!/usr/bin/python3
"""Receive status-only Codex events. No network, prompts, or tool arguments."""
import json
import os
import argparse
from pathlib import Path
import sys
import tempfile
import time
from platform_lock import FileLock

STATES = {'SessionStart': 'idle', 'UserPromptSubmit': 'thinking',
          'PreToolUse': 'working', 'PostToolUse': 'working',
          'PostToolUseFailure': 'error', 'Stop': 'finished',
          'StopFailure': 'error', 'SessionEnd': 'idle'}

def clean(value, limit=64):
    return ''.join(ch for ch in str(value) if ch.isprintable())[:limit]

def main():
    try:
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument('--state-dir')
        args, _ = parser.parse_known_args()
        payload = json.loads(sys.stdin.read(65537))
        if not isinstance(payload, dict): return
        event = payload.get('hook_event_name')
        if event not in STATES: return
        sid = payload.get('session_id')
        if not isinstance(sid, str) or not sid or len(sid) > 160: return
        default_state = (Path(os.environ['LOCALAPPDATA'])/'RR-Island'/'state'
                         if os.environ.get('LOCALAPPDATA') else Path.home()/'.cache/codex-island')
        folder = Path(args.state_dir or os.environ.get('CODEX_ISLAND_STATE_DIR', default_state))
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        with FileLock(folder/'status.lock', blocking=True):
            target = folder/'status.json'
            try: data = json.loads(target.read_text())
            except (OSError, ValueError): data = {}
            sessions = data.get('sessions', {})
            if not isinstance(sessions, dict): sessions = {}
            now = time.time()
            sessions = {k:v for k,v in sessions.items() if isinstance(v,dict) and now-v.get('updated',0) < 86400}
            previous = sessions.get(sid, {})
            if event in {'PostToolUse', 'PostToolUseFailure'} and previous.get('status') in {'finished', 'idle'}:
                return
            project = clean(Path(str(payload.get('cwd', ''))).name) or previous.get('project', 'Codex')
            sessions[sid] = {'project': project, 'status': STATES[event],
                             'tool': clean(payload.get('tool_name', '')),
                             'updated': now}
            sessions = dict(sorted(sessions.items(), key=lambda x:x[1]['updated'], reverse=True)[:32])
            fd, tmp = tempfile.mkstemp(prefix='.status-', dir=folder)
            try:
                with os.fdopen(fd, 'w') as out:
                    json.dump({'version':1, 'sessions':sessions}, out)
                os.replace(tmp, target)
            finally:
                if os.path.exists(tmp): os.unlink(tmp)
    except (OSError, ValueError, TypeError):
        # Monitoring must never break the agent's work.
        return

if __name__ == '__main__': main()
