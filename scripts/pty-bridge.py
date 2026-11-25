#!/usr/bin/env python3
"""
Lightweight real PTY bridge for Gemini Mobile Bridge.
Reads JSON lines from stdin:
  {"t": "i", "d": "<utf8 input>"}
  {"t": "r", "c": <cols>, "r": <rows>}
Streams raw PTY output bytes directly to stdout.
"""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd: int, rows: int, cols: int) -> None:
    rows = max(5, min(rows, 500))
    cols = max(10, min(cols, 500))
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def main() -> int:
    if len(sys.argv) < 5:
        sys.stderr.write("Usage: pty-bridge.py <cwd> <cols> <rows> <cmd> [args...]\n")
        return 2

    cwd = sys.argv[1]
    cols = int(sys.argv[2])
    rows = int(sys.argv[3])
    cmd = sys.argv[4:]

    master_fd, slave_fd = pty.openpty()
    set_winsize(slave_fd, rows, cols)

    pid = os.fork()
    if pid == 0:
        # Child process
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.close(master_fd)

        try:
            if cwd and os.path.isdir(cwd):
                os.chdir(cwd)
        except OSError:
            pass

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env.setdefault("LANG", "C.UTF-8")

        try:
            os.execvpe(cmd[0], cmd, env)
        except Exception as exc:
            sys.stderr.write(f"Failed to exec {cmd[0]}: {exc}\n")
            os._exit(127)

    # Parent process
    os.close(slave_fd)
    set_winsize(master_fd, rows, cols)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    def cleanup(*_args) -> None:
        try:
            os.killpg(pid, signal.SIGHUP)
        except OSError:
            pass
        try:
            os.killpg(pid, signal.SIGTERM)
        except OSError:
            pass

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    stdin_buf = b""
    stdin_open = True

    try:
        while True:
            read_fds = [master_fd]
            if stdin_open:
                read_fds.append(stdin_fd)

            try:
                rlist, _, _ = select.select(read_fds, [], [], 0.25)
            except InterruptedError:
                continue

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 8192)
                except OSError:
                    break
                if not data:
                    break
                os.write(stdout_fd, data)

            if stdin_fd in rlist:
                try:
                    chunk = os.read(stdin_fd, 4096)
                except OSError:
                    stdin_open = False
                    break
                if not chunk:
                    stdin_open = False
                    break
                stdin_buf += chunk
                while b"\n" in stdin_buf:
                    line, stdin_buf = stdin_buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line.decode("utf-8", errors="ignore"))
                    except json.JSONDecodeError:
                        continue
                    mtype = msg.get("t")
                    if mtype == "i":
                        payload = msg.get("d", "")
                        if isinstance(payload, str) and payload:
                            os.write(master_fd, payload.encode("utf-8"))
                    elif mtype == "r":
                        c = int(msg.get("c", cols))
                        r = int(msg.get("r", rows))
                        set_winsize(master_fd, r, c)
                        try:
                            os.killpg(pid, signal.SIGWINCH)
                        except OSError:
                            pass

            # Check if child exited
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                # Drain any remaining PTY output
                while True:
                    r_rem, _, _ = select.select([master_fd], [], [], 0.05)
                    if not r_rem:
                        break
                    try:
                        rem = os.read(master_fd, 8192)
                        if not rem:
                            break
                        os.write(stdout_fd, rem)
                    except OSError:
                        break
                break
    finally:
        cleanup()
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.waitpid(pid, os.WNOHANG)
        except OSError:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
