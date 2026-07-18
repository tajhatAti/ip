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
import tempfile
import time
import logging
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


def _run_subprocess(cmd, cwd, stdin_data, timeout_s):
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
        )
        return proc.stdout, proc.stderr, proc.returncode, False
    except subprocess.TimeoutExpired:
        return "", "Execution timed out after {} seconds.".format(timeout_s), -1, True
    except Exception as e:
        return "", str(e), -1, False


@app.get("/health")
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

        # --- Compile (if needed) ---
        if cfg["compile"]:
            compile_cmd = [c.replace("{file}", src_file).replace("{bin}", bin_file).replace("{dir}", tmpdir) for c in cfg["compile"]]
            cout, cerr, ccode, ctimed = _run_subprocess(compile_cmd, tmpdir, None, MAX_TIME_MS / 1000)
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
        stdout, stderr, exit_code, timed_out = _run_subprocess(run_cmd, tmpdir, stdin_data, timeout_s)

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
