# Code Execution Runner

Separate service for running user-submitted code in a sandboxed subprocess.

## Deploy on Render

1. Create a new Web Service on Render, connect this `runner/` directory
   (or the whole repo with Root Directory set to `runner/`).
2. Runtime: **Docker**.
3. Set environment variables:
   - `RUNNER_SERVICE_SECRET` — a strong random string (generate with
     `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`).
     **This must match** the `RUNNER_SERVICE_SECRET` on the main website.
   - `MAX_EXECUTION_TIME_MS` — default `10000` (10 seconds per run).
   - `MAX_MEMORY_MB` — default `256`.
4. Deploy. The health endpoint is `/health`.

## Supported languages

Python, JavaScript (Node), TypeScript, Bash, Ruby, PHP, Perl, Lua,
C, C++, Java, Go, Rust, SQL (SQLite), Plaintext.

## Security model

- Each execution runs in a fresh temp directory (deleted after).
- Memory limit via `RLIMIT_AS` (Linux).
- Wall-clock timeout kills the entire process group.
- Auth: every request needs `Authorization: Bearer <secret>`.

## Note on full sandbox isolation

This subprocess-based runner works without Docker `--privileged` (important
on Render's free tier). For maximum isolation (network namespace, fork
limits, etc.), consider swapping the execution backend to self-hosted
[Piston](https://github.com/engineer-man/piston) which uses Linux `isolate`.
The API contract (`/internal/execute`) is compatible.
