#!/usr/bin/env python3
"""
claude-bridge.py

HTTP bridge exposing Claude to Docker-based n8n.
Runs on the host. n8n reaches it via: http://host.docker.internal:3333/generate

Request body (JSON):
  prompt  : str  — user message (required)
  system  : str  — system prompt (optional, cached when using API mode)
  model   : str  — model ID (optional, defaults to claude-sonnet-4-6)

Response body (JSON):
  output     : str
  exitCode   : int  (0 = success)
  error      : str
  retryAfter : str  (optional — ISO8601 UTC timestamp, only present when
                      error == "usage_limit". n8n error handlers can use
                      this to pause and retry the same node after the
                      real reset time instead of failing the whole run.)

Modes:
  API mode  — when ANTHROPIC_API_KEY env var is set. Calls Anthropic API
               directly with prompt caching on system messages.
  CLI mode  — fallback. Calls `claude -p` subprocess.

Usage:
  ANTHROPIC_API_KEY=sk-ant-... python3 claude-bridge.py
  python3 claude-bridge.py   # CLI fallback
"""

import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

PORT = 3333
DEFAULT_MODEL = "claude-sonnet-4-6"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MAX_TOKENS = 16384

# Claude Code CLI prints this on its own line (and exits non-zero, usually)
# when the rolling usage window is exhausted, e.g.:
#   "Claude AI usage limit reached|1749924000"
# Some CLI versions instead print a human-readable message and exit 0.
USAGE_LIMIT_PIPE_RE = re.compile(r"Claude AI usage limit reached\|(\d+)")
USAGE_LIMIT_TEXT_RE = re.compile(r"usage limit reached|spend limit", re.IGNORECASE)


def parse_usage_limit(text: str) -> str | None:
    """
    Inspect CLI output for Claude's usage-limit message.

    Returns an ISO8601 UTC timestamp for when the limit resets, or None if
    the text does not indicate a usage-limit condition. If a limit is
    detected but the CLI didn't include a parseable reset timestamp, falls
    back to "5 hours from now" — the length of Claude's rolling usage
    window — as a conservative estimate.
    """
    if not text:
        return None
    m = USAGE_LIMIT_PIPE_RE.search(text)
    if m:
        return datetime.fromtimestamp(int(m.group(1)), tz=timezone.utc).isoformat()
    if USAGE_LIMIT_TEXT_RE.search(text):
        return (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    return None


def call_api(system: str, prompt: str, model: str, max_tokens: int = MAX_TOKENS) -> tuple[str, int, str, str | None]:
    """Call Anthropic API directly with prompt caching on system message."""
    messages = [{"role": "user", "content": prompt}]

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    if system:
        payload["system"] = [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        ANTHROPIC_API_URL,
        data=data,
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
            "content-type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            result = json.loads(resp.read())

        output = result["content"][0]["text"]
        usage = result.get("usage", {})
        cache_read = usage.get("cache_read_input_tokens", 0)
        cache_write = usage.get("cache_creation_input_tokens", 0)
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        cache_status = ""
        if cache_read:
            cache_status = f" | cache HIT: {cache_read} tokens saved"
        elif cache_write:
            cache_status = f" | cache WRITE: {cache_write} tokens cached"

        print(f"[bridge] {model} | in:{input_tokens} out:{output_tokens}{cache_status}")
        return output, 0, "", None

    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[bridge] API error {e.code}: {body[:300]}")

        retry_after = None
        if e.code == 429:
            ra_header = e.headers.get("retry-after")
            if ra_header:
                try:
                    retry_after = (datetime.now(timezone.utc) + timedelta(seconds=int(ra_header))).isoformat()
                except ValueError:
                    pass
            if retry_after is None:
                retry_after = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()

        return "", 1, f"HTTP {e.code}: {body}", retry_after


WHISPER_BIN = "/usr/local/opt/whisper-cpp/bin/whisper-cli"
WHISPER_MODEL = "/usr/local/share/whisper-cpp/ggml-base.en.bin"


def _parse_whisper_json(json_path: str) -> dict:
    with open(json_path, "r") as f:
        data = json.load(f)

    words = []
    for entry in data.get("transcription", []):
        for token in entry.get("tokens", []):
            text = token.get("text", "")
            if text.startswith("[_") and text.endswith("]"):
                continue
            cleaned = text.strip()
            if not cleaned:
                continue
            offsets = token.get("offsets", {})
            words.append({
                "word": cleaned,
                "start": offsets.get("from", 0) / 1000,
                "end":   offsets.get("to",   0) / 1000,
                "confidence": round(token.get("p", 1.0), 4),
            })

    full_text = " ".join(w["word"] for w in words)
    total_duration = words[-1]["end"] if words else 0
    return {"words": words, "full_text": full_text, "total_duration_seconds": total_duration}


def run_whisper(audio_path: str, output_base: str) -> dict:
    json_path = output_base + ".json"
    if os.path.exists(json_path):
        print(f"[bridge] Transcript cache hit: {json_path}")
        return _parse_whisper_json(json_path)

    cmd = [
        WHISPER_BIN, "-m", WHISPER_MODEL,
        "--language", "en", "-ml", "80", "-sow", "-ojf", "-t", "8",
        "-of", output_base, audio_path,
    ]
    print(f"[bridge] Transcribing: {audio_path}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError(f"whisper-cli failed: {result.stderr[:400]}")

    print(f"[bridge] Transcription complete → {json_path}")
    return _parse_whisper_json(json_path)


NO_TOOLS_PREAMBLE = (
    "For this task, respond with the requested output directly — no tool calls, "
    "file writes, commands, or web searches needed. This is a single-shot text "
    "generation request; just return the text/JSON described below.\n\n"
)

def call_cli(system: str, prompt: str, model: str, max_tokens: int = MAX_TOKENS, effort: str = "medium", output_path: str = "") -> tuple[str, int, str, str | None]:
    """Fall back to claude CLI subprocess."""
    full_prompt = NO_TOOLS_PREAMBLE + prompt
    if system:
        full_prompt = NO_TOOLS_PREAMBLE + system + "\n\n---\n\n" + prompt

    cmd = ["claude", "-p", full_prompt, "--model", model, "--effort", effort, "--dangerously-skip-permissions"]
    print(f"[bridge] CLI mode | model:{model} | effort:{effort} | prompt:{len(full_prompt)} chars")

    env = os.environ.copy()
    env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = "100000"

    if output_path:
        # Redirect stdout directly to file — avoids pipe-buffer truncation for
        # large outputs (e.g. Media Placement Agent generating 100KB+ of JSON).
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as out_file:
            result = subprocess.run(
                cmd, stdout=out_file, stderr=subprocess.PIPE,
                text=True, timeout=7200, env=env,
            )
        exit_code = result.returncode
        error = result.stderr if exit_code != 0 else ""

        # Check for usage-limit message in stderr (stdout went to file)
        retry_after = parse_usage_limit(error)
        if retry_after is not None:
            print(f"[bridge] usage limit reached — retry after {retry_after}")
            exit_code = 1
            output = ""
        elif exit_code != 0:
            print(f"[bridge] claude exited {exit_code}: {error[:200]}")
            output = ""
        else:
            file_size = os.path.getsize(output_path)
            print(f"[bridge] Output saved to disk: {output_path} ({file_size} bytes)")
            output = "__disk__:" + output_path

        return output, exit_code, error, retry_after

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=7200, env=env)

    output = result.stdout
    exit_code = result.returncode
    error = result.stderr if exit_code != 0 else ""

    # Usage-limit detection. Most CLI versions exit non-zero with the
    # "Claude AI usage limit reached|<ts>" marker, but some versions print
    # the human-readable message to stdout and exit 0 — check both cases.
    retry_after = parse_usage_limit(output) or parse_usage_limit(error)
    if retry_after is not None:
        print(f"[bridge] usage limit reached — retry after {retry_after}")
        if exit_code == 0:
            exit_code = 1
            error = output.strip() or "usage limit reached"
            output = ""
    elif exit_code != 0:
        print(f"[bridge] claude exited {exit_code}: {result.stderr[:200]}")

    return output, exit_code, error, retry_after


VALIDATOR_PATH = "/Users/jneal/n8n_projects/validate_media_timeline.py"

# Host-side Phase 2 stages. n8n runs in an Alpine/Node container with no python3
# (verified: `docker exec n8n-n8n-1 command -v python3` returns nothing), so
# these cannot be executeCommand nodes. Whitelisted by name — the stage name from
# the request is never used to build a path.
STAGE_SCRIPTS = {
    "segment": "/Users/jneal/n8n_projects/segment.py",
    "merge": "/Users/jneal/n8n_projects/merge_timeline.py",
    "validate": VALIDATOR_PATH,
    "compose_music": "/Users/jneal/n8n_projects/compose_music.py",
}


def run_stage(stage: str, episode_dir: str, extra_args=None) -> tuple[bool, str]:
    """Run a whitelisted Phase 2 stage script on the host."""
    script = STAGE_SCRIPTS[stage]
    cmd = ["python3", script, episode_dir] + list(extra_args or [])
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    return proc.returncode == 0, (proc.stdout or "") + (proc.stderr or "")


def run_timeline_validator(episode_dir: str) -> tuple[bool, dict, str]:
    """
    Run the deterministic media_timeline.json validator on the host.

    Exists because n8n runs in an Alpine/Node container without python3, so an
    executeCommand node can't do this. Same pattern as /transcribe, which shells
    out to whisper-cli on the host.

    Returns (valid, report_dict, human_readable_stdout).
    """
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        json_out = tf.name

    cmd = ["python3", VALIDATOR_PATH, episode_dir, "--json-out", json_out]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    report = {}
    try:
        with open(json_out) as f:
            report = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    finally:
        try:
            os.unlink(json_out)
        except OSError:
            pass

    valid = proc.returncode == 0
    return valid, report, proc.stdout + proc.stderr


class ClaudeHandler(BaseHTTPRequestHandler):

    def do_POST(self):
        if self.path not in ("/generate", "/transcribe", "/validate", "/stage"):
            self.send_error(
                404,
                "Supported endpoints: POST /generate, POST /transcribe, "
                "POST /validate, POST /stage",
            )
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))

            if self.path == "/transcribe":
                self._handle_transcribe(body)
                return

            if self.path == "/validate":
                self._handle_validate(body)
                return

            if self.path == "/stage":
                self._handle_stage(body)
                return

            prompt = body.get("prompt", "").strip()
            system = body.get("system", "").strip()
            model = body.get("model", DEFAULT_MODEL).strip()
            max_tokens = int(body.get("max_tokens", MAX_TOKENS))
            effort = body.get("effort", "medium").strip()
            output_path = body.get("output_path", "").strip()

            if not prompt:
                self.send_error(400, "Missing 'prompt' in request body")
                return

            if ANTHROPIC_API_KEY:
                output, exit_code, error, retry_after = call_api(system, prompt, model, max_tokens)
                # API mode: handle output_path after the fact (API mode buffers in memory)
                if output_path and output and exit_code == 0:
                    os.makedirs(os.path.dirname(output_path), exist_ok=True)
                    with open(output_path, "w") as f:
                        f.write(output)
                    print(f"[bridge] Output saved to disk: {output_path} ({len(output)} chars)")
                    output = "__disk__:" + output_path
            else:
                # CLI mode: pass output_path so stdout is redirected directly to file,
                # avoiding pipe-buffer truncation for large responses.
                output, exit_code, error, retry_after = call_cli(system, prompt, model, max_tokens, effort, output_path)

            response_dict = {
                "output": output,
                "exitCode": exit_code,
                "error": error,
            }
            if retry_after is not None:
                response_dict["rawError"] = error
                response_dict["error"] = "usage_limit"
                response_dict["retryAfter"] = retry_after

            response_body = json.dumps(response_dict)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(response_body.encode())

        except subprocess.TimeoutExpired:
            print("[bridge] ERROR: timed out")
            self.send_error(504, "Claude timed out")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON body")
        except FileNotFoundError:
            print("[bridge] ERROR: 'claude' not found in PATH")
            self.send_error(500, "claude binary not found")
        except Exception as exc:
            print(f"[bridge] ERROR: {exc}")
            self.send_error(500, str(exc))

    def _handle_transcribe(self, body):
        audio_path = body.get("audio_path", "").strip()
        output_base = body.get("output_base", "").strip()

        if not audio_path:
            self.send_error(400, "Missing 'audio_path' in request body")
            return

        if not output_base:
            output_base = audio_path

        result = run_whisper(audio_path, output_base)

        response_body = json.dumps(result)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(response_body.encode())

    def _handle_stage(self, body):
        """
        Run a host-side Phase 2 stage (segment / merge / validate).

        200 on success, 422 on stage failure so an n8n HTTP node can gate on it
        directly. stdout is returned either way — these scripts print a useful
        summary that lands in the n8n execution log.
        """
        stage = (body.get("stage") or "").strip()
        episode_dir = (body.get("episode_dir") or "").strip()
        extra = body.get("args") or []

        if stage not in STAGE_SCRIPTS:
            self.send_error(
                400, f"Unknown stage '{stage}'. Valid: {sorted(STAGE_SCRIPTS)}")
            return
        if not episode_dir:
            self.send_error(400, "Missing 'episode_dir' in request body")
            return

        ok, output = run_stage(stage, episode_dir, extra)
        print(f"[bridge] stage {stage} on {os.path.basename(episode_dir)} — "
              f"{'OK' if ok else 'FAILED'}")

        payload = json.dumps({"stage": stage, "ok": ok, "output": output}).encode()
        self.send_response(200 if ok else 422)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def _handle_validate(self, body):
        """
        Phase 2 generation-time gate.

        Returns HTTP 200 when the timeline is valid, HTTP 422 when it is not, so
        an n8n HTTP Request node fails the run naturally without needing an
        extra IF node. The response body carries the full error list either way.
        """
        episode_dir = body.get("episode_dir", "").strip()
        if not episode_dir:
            self.send_error(400, "Missing 'episode_dir' in request body")
            return

        valid, report, stdout = run_timeline_validator(episode_dir)

        n_err = report.get("error_count", 0 if valid else -1)
        print(f"[bridge] validate {os.path.basename(episode_dir)} — "
              f"{'PASS' if valid else 'FAIL'} ({n_err} errors)")

        payload = json.dumps({
            "valid": valid,
            "report": report,
            "stdout": stdout,
        }).encode()

        self.send_response(200 if valid else 422)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        print(f"[bridge] {self.address_string()}  {fmt % args}")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    mode = "API mode (caching enabled)" if ANTHROPIC_API_KEY else "CLI fallback mode (set ANTHROPIC_API_KEY for caching)"
    server = ThreadedHTTPServer(("0.0.0.0", PORT), ClaudeHandler)
    print(f"[bridge] Claude bridge running on port {PORT} — {mode}")
    print(f"[bridge] n8n endpoint → http://host.docker.internal:{PORT}/generate")
    print(f"[bridge] Default model: {DEFAULT_MODEL}")
    print(f"[bridge] Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] Stopped.")
        sys.exit(0)
