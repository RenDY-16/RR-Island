"""Platform-specific subprocess creation and shutdown for Codex App Server."""
import os
import signal
import subprocess
import sys


def spawn_codex(binary, args, **kwargs):
    argv = [str(binary), *args]
    if sys.platform != "win32":
        return subprocess.Popen(argv, start_new_session=True, **kwargs)

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    kwargs.setdefault("startupinfo", startupinfo)
    kwargs.setdefault("creationflags", subprocess.CREATE_NEW_PROCESS_GROUP)
    if str(binary).lower().endswith((".cmd", ".bat")):
        # Windows npm installs expose Codex as a .cmd shim. Arguments are fixed
        # by RR-Island; list2cmdline quotes the executable path and argv values.
        command = subprocess.list2cmdline(argv)
        comspec = os.environ.get("COMSPEC", "cmd.exe")
        proc = subprocess.Popen([comspec, "/d", "/s", "/c", f'"{command}"'], **kwargs)
        proc._rr_island_shell_wrapper = True
        return proc
    return subprocess.Popen(argv, **kwargs)


def terminate_process(proc, timeout=3):
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            if getattr(proc, "_rr_island_shell_wrapper", False):
                subprocess.run(
                    ["taskkill.exe", "/PID", str(proc.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                proc.terminate()
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill.exe", "/PID", str(proc.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if proc.poll() is None:
                proc.kill()
        else:
            os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
