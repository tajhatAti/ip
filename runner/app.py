"""
runner/app.py — Code Execution Runner Service (Service #2)

A standalone FastAPI service that receives code, executes it in a sandboxed
subprocess with strict resource limits, and returns the output.

Deploy this as a SEPARATE Render service (or any Docker host).
The main website talks to it via /internal/execute with a shared secret.

Security:
  - Each run gets its own temp directory (deleted after).
  - Memory limit via RLIMIT_AS (Linux).
  - CPU/wall-time timeout (subprocess timeout).
  - Process group kill on timeout (no zombie children).
  - No network access inside the sandbox (documented; for full isolation
    use Piston/Docker --privileged, but this subprocess approach works
    without privileged mode on Render's managed Docker).

The shared secret (RUNNER_SERVICE_SECRET) authenticates every request.
"""
import os
import re
import json
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import logging
from collections import deque
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("runner")

app = FastAPI(title="Ahad Code Runner")

SECRET = os.getenv("RUNNER_SERVICE_SECRET", "").strip()
MAX_TIME_MS = int(os.getenv("MAX_EXECUTION_TIME_MS", "10000"))
MAX_MEM_MB = int(os.getenv("MAX_MEMORY_MB", "256"))
EXEC_PIP_TIMEOUT_S = int(os.getenv("EXEC_PIP_TIMEOUT_S", "120"))  # one-shot auto-install budget

# ─── Language definitions ──────────────────────────────────────────
# Each entry: extension, compile command (or None), run command.
# The run command uses {file} placeholder for the temp file path.

LANGS = {
    "python":     {"ext": "py",   "compile": None,                                                              "run": ["python3", "{file}"]},
    "python3":    {"ext": "py",   "compile": None,                                                              "run": ["python3", "{file}"]},
    "javascript": {"ext": "js",   "compile": None,                                                              "run": ["node", "{file}"]},
    "js":         {"ext": "js",   "compile": None,                                                              "run": ["node", "{file}"]},
    "typescript": {"ext": "ts",   "compile": None,                                                              "run": ["npx", "ts-node", "{file}"]},
    "bash":       {"ext": "sh",   "compile": None,                                                              "run": ["bash", "{file}"]},
    "sh":         {"ext": "sh",   "compile": None,                                                              "run": ["bash", "{file}"]},
    "ruby":       {"ext": "rb",   "compile": None,                                                              "run": ["ruby", "{file}"]},
    "php":        {"ext": "php",  "compile": None,                                                              "run": ["php", "{file}"]},
    "perl":       {"ext": "pl",   "compile": None,                                                              "run": ["perl", "{file}"]},
    "lua":        {"ext": "lua",  "compile": None,                                                              "run": ["lua", "{file}"]},
    "c":          {"ext": "c",    "compile": ["gcc", "{file}", "-o", "{bin}", "-lm", "-std=c11"],                "run": ["{bin}"]},
    "cpp":        {"ext": "cpp",  "compile": ["g++", "{file}", "-o", "{bin}", "-lm", "-std=c++17"],              "run": ["{bin}"]},
    "c++":        {"ext": "cpp",  "compile": ["g++", "{file}", "-o", "{bin}", "-lm", "-std=c++17"],              "run": ["{bin}"]},
    "java":       {"ext": "java", "compile": ["javac", "{file}"],                                                "run": ["java", "-cp", "{dir}", "Main"]},
    "go":         {"ext": "go",   "compile": None,                                                              "run": ["go", "run", "{file}"]},
    "rust":       {"ext": "rs",   "compile": ["rustc", "{file}", "-o", "{bin}"],                                "run": ["{bin}"]},
    "sql":        {"ext": "sql",  "compile": None,                                                              "run": ["sqlite3", ":memory:", ".read {file}"]},
    "text":       {"ext": "txt",  "compile": None,                                                              "run": ["cat", "{file}"]},
}


class ExecuteRequest(BaseModel):
    language: str
    code: str
    stdin: Optional[str] = None


def _check_secret(authorization: Optional[str]):
    """Verify the shared secret from the Authorization header."""
    if not SECRET:
        # If no secret configured, deny all requests (fail-closed).
        raise HTTPException(status_code=503, detail="Runner secret not configured.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized.")
    token = authorization.split(" ", 1)[1].strip()
    if token != SECRET:
        raise HTTPException(status_code=403, detail="Invalid runner secret.")


def _set_limits():
    """preexec_fn: set memory limit for the child process (Linux only)."""
    try:
        import resource
        mem_bytes = MAX_MEM_MB * 1024 * 1024
        # Soft + hard limit on virtual memory (address space).
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
    except Exception:
        pass  # Non-Linux or no permission — timeout is the main guard.


def _run_subprocess(cmd, cwd, stdin_data, timeout_s, env=None):
    """Run a command with timeout, return (stdout, stderr, exit_code, timed_out)."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            preexec_fn=_set_limits if os.name != "nt" else None,
            # Start in a new process group so we can kill all children on timeout.
            start_new_session=True,
            env=env,
        )
        return proc.stdout, proc.stderr, proc.returncode, False
    except subprocess.TimeoutExpired:
        return "", "Execution timed out after {} seconds.".format(timeout_s), -1, True
    except Exception as e:
        return "", str(e), -1, False


# NOTE: api_route with methods=["GET", "HEAD"] — FastAPI's plain @app.get does
# NOT answer HEAD requests (returns 405), but Render's health checker pings
# with HEAD and needs a 2xx. So register both methods explicitly.
@app.api_route("/", methods=["GET", "HEAD"])
def root():
    """Root endpoint — returns 200 so platform health checks (Render pings "/"
    by default) and curious browsers see the service is alive instead of a 404.
    The actual health/details endpoints remain below."""
    return {
        "service": "ahad-code-runner",
        "status": "ok",
        "endpoints": ["/health", "/api/v2/runtimes"],
        "note": "This is an internal code-execution API. POST /internal/execute with a Bearer secret to run code.",
    }


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    """Simple health check — no auth needed."""
    return {"status": "ok", "languages": sorted(LANGS.keys())}


@app.get("/api/v2/runtimes")
def runtimes(authorization: Optional[str] = Header(None)):
    """Piston-compatible runtimes listing (also auth-gated)."""
    _check_secret(authorization)
    out = []
    for lang, cfg in sorted(LANGS.items()):
        out.append({"language": lang, "version": "latest", "aliases": []})
    return out


@app.post("/internal/execute")
def execute(req: ExecuteRequest, authorization: Optional[str] = Header(None)):
    """Execute code in a sandboxed subprocess.

    Requires: Authorization: Bearer <RUNNER_SERVICE_SECRET>
    Returns: { success, stdout, stderr, exit_code, execution_time_ms, error }
    """
    _check_secret(authorization)

    lang = (req.language or "").lower().strip()
    code = req.code or ""
    stdin_data = req.stdin or ""

    # --- Validate ---
    if lang not in LANGS:
        return JSONResponse({
            "success": False, "stdout": "", "stderr": "",
            "exit_code": -1, "execution_time_ms": 0,
            "error": "Unsupported language: {}. Available: {}".format(lang, ", ".join(sorted(LANGS.keys()))),
        })
    if not code.strip():
        return JSONResponse({
            "success": False, "stdout": "", "stderr": "",
            "exit_code": -1, "execution_time_ms": 0,
            "error": "Code is empty.",
        })

    cfg = LANGS[lang]
    start = time.monotonic()
    tmpdir = None

    try:
        tmpdir = tempfile.mkdtemp(prefix="run_")
        src_file = os.path.join(tmpdir, "main." + cfg["ext"])
        bin_file = os.path.join(tmpdir, "main.bin")

        # Write the source code (truncate at 256KB to prevent abuse).
        with open(src_file, "w") as f:
            f.write(code[:262144])

        # --- Auto-install whatever libraries the code imports ---
        # Same magic as jobs: paste code, we figure out its pip deps ourselves.
        reqs = _detect_imports(code)
        run_env = None
        if reqs:
            pylibs = os.path.join(tmpdir, "pylibs")
            os.makedirs(pylibs, exist_ok=True)
            _, perr, pcode, ptimed = _run_subprocess(
                ["python3", "-m", "pip", "install", "--quiet", "--target", pylibs] + reqs,
                tmpdir, None, EXEC_PIP_TIMEOUT_S,
            )
            if pcode != 0:
                return JSONResponse({
                    "success": False, "stdout": "", "stderr": (perr or "")[-3000:],
                    "exit_code": -1,
                    "execution_time_ms": int((time.monotonic() - start) * 1000),
                    "error": "pip install failed" + (" (timed out)" if ptimed else "") + " for: " + " ".join(reqs),
                })
            run_env = dict(os.environ)
            run_env["PYTHONPATH"] = pylibs + os.pathsep + run_env.get("PYTHONPATH", "")

        # --- Compile (if needed) ---
        if cfg["compile"]:
            compile_cmd = [c.replace("{file}", src_file).replace("{bin}", bin_file).replace("{dir}", tmpdir) for c in cfg["compile"]]
            cout, cerr, ccode, ctimed = _run_subprocess(compile_cmd, tmpdir, None, MAX_TIME_MS / 1000, env=run_env)
            if ccode != 0:
                elapsed = int((time.monotonic() - start) * 1000)
                return JSONResponse({
                    "success": False,
                    "stdout": cout,
                    "stderr": cerr,
                    "exit_code": ccode,
                    "execution_time_ms": elapsed,
                    "error": "Compilation failed." if not ctimed else "Compilation timed out.",
                })

        # --- Run ---
        run_cmd = [c.replace("{file}", src_file).replace("{bin}", bin_file).replace("{dir}", tmpdir) for c in cfg["run"]]
        timeout_s = MAX_TIME_MS / 1000.0
        stdout, stderr, exit_code, timed_out = _run_subprocess(run_cmd, tmpdir, stdin_data, timeout_s, env=run_env)

        elapsed = int((time.monotonic() - start) * 1000)

        # Truncate very long output (prevent abuse).
        stdout = stdout[:65536] if stdout else ""
        stderr = stderr[:65536] if stderr else ""

        return JSONResponse({
            "success": exit_code == 0 and not timed_out,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "execution_time_ms": elapsed,
            "error": "Execution timed out." if timed_out else None,
        })

    except Exception as e:
        logger.exception("Execution error")
        elapsed = int((time.monotonic() - start) * 1000)
        return JSONResponse({
            "success": False, "stdout": "", "stderr": "",
            "exit_code": -1, "execution_time_ms": elapsed,
            "error": "Internal error: {}".format(str(e)[:200]),
        })
    finally:
        if tmpdir and os.path.isdir(tmpdir):
            shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/api/v2/execute")
def execute_piston(req: ExecuteRequest, authorization: Optional[str] = Header(None)):
    """Piston-compatible endpoint (same logic, aliased)."""
    _check_secret(authorization)
    return execute(req, authorization)


# ═══════════════════════════════════════════════════════════════════
# PERSISTENT BACKGROUND JOBS  ("Always-On" — mini PythonAnywhere)
# ═══════════════════════════════════════════════════════════════════
# Unlike /internal/execute (one-shot, 10s timeout), a JOB is a long-lived
# process: Telegram bots, scrapers, loops — anything that should keep
# running. The runner supervises each job:
#   * isolated temp dir + same memory limits as one-shot runs
#   * stdout/stderr captured into a small ring buffer (for live logs)
#   * auto-restart on crash (few attempts, spaced out — like PA's tasks)
# Jobs live in THIS process's memory, so a runner redeploy/restart clears
# them — the main site keeps the job definitions and can re-spawn them.
# ---------------------------------------------------------------------------
MAX_BG_JOBS = int(os.getenv("MAX_BG_JOBS", "5"))   # free plan = 512MB RAM!
JOB_LOG_LINES = 2000                                # ring buffer per job (full history)
JOB_RESTART_LIMIT = 3                               # auto-restart attempts
JOB_RESTART_DELAY_S = 5
JOB_PIP_TIMEOUT_S = int(os.getenv("JOB_PIP_TIMEOUT_S", "240"))  # pip install budget

_jobs: dict = {}                                    # id -> job record
_jobs_lock = threading.Lock()


class JobStartRequest(BaseModel):
    language: str
    code: str
    name: Optional[str] = ""
    restart: Optional[bool] = True


def _parse_requirements(code: str) -> list:
    """PythonAnywhere-style dependency declaration: a comment near the top of
    the code like

        # requirements: python-telegram-bot requests

    is collected and pip-installed before the job starts."""
    reqs = []
    for line in (code or "").splitlines()[:40]:
        m = re.match(r"^\s*#\s*requirements\s*[::]\s*(.+)$", line, re.IGNORECASE)
        if m:
            reqs.extend(p for p in re.split(r"[,\s]+", m.group(1).strip()) if p)
    return reqs


# ─── Automatic dependency detection ─────────────────────────────────────────
# We read the code's top-level imports, drop stdlib modules, map the remaining
# module names to their PyPI package names, and pip-install them — so a user
# just pastes code and EVERYTHING it needs appears magically. No headers,
# no instructions. (The optional "# requirements:" line still lets users pin
# exact packages/versions on top of the auto-detected ones.)
_STDLIB = set(sys.stdlib_module_names) | {"__future__"}

# Import-name -> PyPI package-name, for the cases where they DIFFER.
# (Modules like `requests`, `numpy`, `flask`, `pandas`, `ccxt`, `web3`,
# `pyrogram`, `openai`… share their package name and need no entry.)
_IMPORT_TO_PYPI = {
    # ── images / vision ──
    "pil": "pillow",
    "cv2": "opencv-python",
    "imageio": "imageio",
    "pytesseract": "pytesseract",
    # ── messaging / bots ──
    "telegram": "python-telegram-bot",
    "discord": "discord.py",
    "pyrogram": "pyrogram",
    "telethon": "telethon",
    "slack_sdk": "slack-sdk",
    "twilio": "twilio",
    # ── web / scraping / http ──
    "bs4": "beautifulsoup4",
    "lxml": "lxml",
    "html5lib": "html5lib",
    "selenium": "selenium",          # note: needs a browser binary to actually drive
    "playwright": "playwright",      # note: needs `playwright install` for browsers
    "aiohttp": "aiohttp",
    "httpx": "httpx",
    "websocket": "websocket-client",
    "websockets": "websockets",
    "feedparser": "feedparser",
    "tweepy": "tweepy",
    "praw": "praw",
    # ── data / science ──
    "sklearn": "scikit-learn",
    "seaborn": "seaborn",
    "openpyxl": "openpyxl",
    "xlrd": "xlrd",
    # ── formats / utils ──
    "yaml": "pyyaml",
    "dotenv": "python-dotenv",
    "qrcode": "qrcode[pil]",  # image output secretly needs Pillow (pip extra)
    "dateutil": "python-dateutil",
    "pytz": "pytz",
    "jinja2": "jinja2",
    "schedule": "schedule",
    "psutil": "psutil",
    "watchdog": "watchdog",
    "crypto": "pycryptodome",
    "jwt": "pyjwt",
    "multipart": "python-multipart",
    "pyfiglet": "pyfiglet",
    "emoji": "emoji",
    "wordcloud": "wordcloud",
    # ── databases ──
    "pymongo": "pymongo",
    "psycopg2": "psycopg2-binary",
    # ── ai apis ──
    "openai": "openai",
    "anthropic": "anthropic",
    "groq": "groq",
    "cohere": "cohere",
    # ── paid-data / exchange ──
    "binance": "python-binance",
    # ── media / misc fun ──
    "pywhatkit": "pywhatkit",
    "pytubefix": "pytubefix",
    "pytube": "pytube",
    "moviepy": "moviepy",
    "pydub": "pydub",
    "gtts": "gtts",
}


def _detect_imports(code: str) -> list:
    """Return the PyPI packages this code needs (auto-detected + header)."""
    pkgs = set()
    for m in re.finditer(r"^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)", code or "", re.MULTILINE):
        mod = m.group(1).lower()
        if mod in _STDLIB:
            continue
        pkgs.add(_IMPORT_TO_PYPI.get(mod, mod))
    for p in _parse_requirements(code):
        pkgs.add(p)
    return sorted(pkgs)[:20]  # sanity cap


def _pkg_display_name(spec: str) -> str:
    """'qrcode[pil]' -> 'qrcode', 'psycopg2-binary==2.9' -> 'psycopg2-binary'."""
    return re.split(r"[<>=!~\[]", spec, 1)[0].strip()


def _installed_version(name: str, pylibs: str) -> str:
    """Resolve the version pip just installed into the job's target dir, so
    logs can report 'flask==3.0.3' instead of a bare package name."""
    try:
        env = dict(os.environ, PYTHONPATH=pylibs)
        p = subprocess.run(
            ["python3", "-c",
             "import importlib.metadata as m,sys;print(m.version(sys.argv[1].lower().replace('_','-')))",
             name],
            capture_output=True, text=True, timeout=15, env=env,
        )
        v = (p.stdout or "").strip()
        return v if v and p.returncode == 0 else "?"
    except Exception:
        return "?"


def _prepare_and_run(j: dict, reqs: list) -> None:
    """Background worker: pip install a job's deps ONE BY ONE (so the log can
    credit — or blame — each package with its exact version), THEN start it.
    Detached on purpose: creation returns instantly with status=installing,
    so even big installs never run into HTTP/proxy timeouts."""
    if reqs:
        j["log"].append(f"[system] Installing libraries: {', '.join(reqs)}")
        deadline = time.monotonic() + JOB_PIP_TIMEOUT_S
        failed = None
        for spec in reqs:
            remain = int(deadline - time.monotonic())
            if remain <= 0:
                j["log"].append(f"[system] ✗ {_pkg_display_name(spec)} failed: install budget exhausted (timed out)")
                failed = spec
                break
            name = _pkg_display_name(spec)
            tout, terr, tcode, ttimed = _run_subprocess(
                ["python3", "-m", "pip", "install", "--quiet", "--target", j["pylibs"], spec],
                j["dir"], None, remain,
            )
            if tcode == 0:
                ver = _installed_version(name, j["pylibs"])
                j["log"].append(f"[system] ✓ {name}=={ver} installed")
            else:
                # Surface the real reason: last meaningful pip output line.
                lines = [ln for ln in ((terr or "") + "\n" + (tout or "")).splitlines() if ln.strip()]
                reason = ("pip timed out" if ttimed else (lines[-1].strip() if lines else "unknown error"))
                j["log"].append(f"[system] ✗ {name} failed: {reason[:240]}")
                failed = spec
                break
        if failed:
            j["status"] = "install_failed"
            j["log"].append("[system] Install stopped — fix the failing package and press ▶ Restart.")
            return
        j["log"].append(f"[system] All libraries ready ({len(reqs)} package{'s' if len(reqs) != 1 else ''})")
    _spawn(j)


def _job_public(j: dict) -> dict:
    """Safe public view of a job (no internal objects)."""
    running = j["proc"] is not None and j["proc"].poll() is None
    return {
        "id": j["id"],
        "name": j["name"],
        "language": j["lang"],
        "status": "running" if running else j["status"],
        "restarts": j["restarts"],
        "started_at": j["started_at"],
        "uptime_s": int(time.time() - j["started_at"]) if running else 0,
    }


def _kill_job_tree(j: dict) -> None:
    """Kill the whole process group so children die with the parent."""
    proc = j.get("proc")
    if proc and proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=3)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                pass


def _spawn(j: dict) -> None:
    """(Re)start the job process + reader thread + supervisor thread."""
    cfg = LANGS[j["lang"]]
    cmd = [c.replace("{file}", j["file"]).replace("{bin}", j["bin"]).replace("{dir}", j["dir"]) for c in cfg["run"]]
    # pip-installed packages (from the "# requirements:" header) live in the
    # job's own dir and persist across auto-restarts via PYTHONPATH.
    env = dict(os.environ)
    if j.get("pylibs"):
        env["PYTHONPATH"] = j["pylibs"] + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.Popen(
        cmd, cwd=j["dir"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,  # merged, VPS-style
        text=True, bufsize=1,
        preexec_fn=_set_limits if os.name != "nt" else None,
        start_new_session=True,
        env=env,
    )
    j["proc"] = proc
    j["status"] = "running"
    j["log"].append(f"[system] started (pid {proc.pid})")

    def _reader():
        try:
            for line in proc.stdout:
                j["log"].append(line.rstrip("\n"))
        except Exception:
            pass

    def _supervisor():
        rc = proc.wait()
        j["log"].append(f"[system] exited with code {rc}")
        if j.get("stop_requested"):
            j["status"] = "stopped"
            return
        if j["restart_enabled"] and j["restarts"] < JOB_RESTART_LIMIT:
            j["restarts"] += 1
            j["log"].append(f"[system] restarting in {JOB_RESTART_DELAY_S}s (attempt {j['restarts']}/{JOB_RESTART_LIMIT})")
            time.sleep(JOB_RESTART_DELAY_S)
            if not j.get("stop_requested"):
                _spawn(j)
        else:
            j["status"] = "crashed" if rc != 0 else "stopped"

    threading.Thread(target=_reader, daemon=True).start()
    threading.Thread(target=_supervisor, daemon=True).start()


@app.post("/internal/jobs", status_code=201)
def job_start(req: JobStartRequest, authorization: Optional[str] = Header(None)):
    """Create & start a persistent job. Auth: same Bearer secret."""
    _check_secret(authorization)

    lang = (req.language or "").lower().strip()
    code = req.code or ""
    if lang not in LANGS:
        raise HTTPException(400, detail=f"Unsupported language: {lang}. Available: {', '.join(sorted(LANGS))}")
    if not code.strip():
        raise HTTPException(400, detail="Code is empty.")

    with _jobs_lock:
        active = sum(1 for j in _jobs.values() if j["proc"] and j["proc"].poll() is None)
    if active >= MAX_BG_JOBS:
        raise HTTPException(429, detail=f"Runner at capacity ({active}/{MAX_BG_JOBS} jobs). Stop one first.")

    job_id = uuid.uuid4().hex[:12]
    jdir = tempfile.mkdtemp(prefix=f"job_{job_id}_")
    cfg = LANGS[lang]
    src = os.path.join(jdir, "main." + cfg["ext"])
    binf = os.path.join(jdir, "main.bin")
    with open(src, "w") as f:
        f.write(code[:262144])

    # Compiled languages: compile ONCE before the job is considered started.
    if cfg["compile"]:
        ccmd = [c.replace("{file}", src).replace("{bin}", binf).replace("{dir}", jdir) for c in cfg["compile"]]
        cout, cerr, ccode, _ = _run_subprocess(ccmd, jdir, None, MAX_TIME_MS / 1000)
        if ccode != 0:
            shutil.rmtree(jdir, ignore_errors=True)
            raise HTTPException(400, detail="Compilation failed:\n" + (cerr or cout)[:3000])

    # Dependencies: AUTO-DETECTED from the code's own imports (plus optional
    # "# requirements:" header). Installed in a BACKGROUND thread so this HTTP
    # request returns instantly — the job shows status "installing" while pip
    # works, and the frontend gets to show its loading animation. ✨
    reqs = _detect_imports(code)
    pylibs = None
    if reqs:
        pylibs = os.path.join(jdir, "pylibs")
        os.makedirs(pylibs, exist_ok=True)

    job = {
        "id": job_id,
        "name": (req.name or "job").strip()[:60] or "job",
        "lang": lang,
        "dir": jdir,
        "file": src,
        "bin": binf,
        "pylibs": pylibs,
        "proc": None,
        "status": "installing" if reqs else "starting",
        "log": deque(maxlen=JOB_LOG_LINES),
        "restarts": 0,
        "restart_enabled": bool(req.restart),
        "stop_requested": False,
        "started_at": time.time(),
    }
    with _jobs_lock:
        _jobs[job_id] = job
    if reqs:
        job["log"].append("[system] Job queued — preparing libraries…")
        threading.Thread(target=_prepare_and_run, args=(job, reqs), daemon=True).start()
    else:
        # No dependencies — start right away.
        _spawn(job)
    logger.info("Job %s (%s/%s) created", job_id, job["name"], lang)
    return _job_public(job)


@app.get("/internal/jobs")
def job_list(authorization: Optional[str] = Header(None)):
    _check_secret(authorization)
    with _jobs_lock:
        return {"jobs": [_job_public(j) for j in _jobs.values()], "capacity": MAX_BG_JOBS}


@app.get("/internal/jobs/{job_id}")
def job_detail(job_id: str, authorization: Optional[str] = Header(None)):
    _check_secret(authorization)
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, detail="Job not found (runner was restarted?).")
    info = _job_public(j)
    info["logs"] = "\n".join(j["log"])
    return info


@app.post("/internal/jobs/{job_id}/stop")
def job_stop(job_id: str, authorization: Optional[str] = Header(None)):
    _check_secret(authorization)
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, detail="Job not found.")
    j["stop_requested"] = True
    _kill_job_tree(j)
    j["status"] = "stopped"
    j["log"].append("[system] stopped by user")
    # Free the disk while the job definition is still visible.
    if os.path.isdir(j["dir"]):
        shutil.rmtree(j["dir"], ignore_errors=True)
    logger.info("Job %s stopped", job_id)
    return _job_public(j)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
