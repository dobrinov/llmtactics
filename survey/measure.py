# Counts the last 30 days of Claude Code history. Reads only; prints totals,
# medians and model names, never a prompt, a path or a project name.
import glob, json, os, statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone

DAYS = 30
now = datetime.now(timezone.utc)
since = now - timedelta(days=DAYS)
root = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
# Text the harness writes into the user's turn; not something the user typed.
NOT_TYPED = ("<task-notification", "<system-reminder", "<local-command", "<command-", "<bash-")
PARTS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def when(o):
    try:
        return datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
    except Exception:
        return None


def typed(o, msg):
    if o.get("isMeta") or o.get("isSidechain") or (o.get("origin") or {}).get("kind", "human") != "human":
        return False
    c = msg.get("content")
    if isinstance(c, list):
        kinds = {b.get("type") for b in c if isinstance(b, dict)}
        if "tool_result" in kinds or "text" not in kinds:
            return False
        c = next(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return isinstance(c, str) and bool(c.strip()) and not c.lstrip().startswith(NOT_TYPED)


requests = {}  # one per model reply: a reply is written as several lines, and copied into resumed sessions
prompts = defaultdict(int)
stamps = defaultdict(list)
lines = {}
days = set()
oldest = now
# Every transcript, subagents included: they sit in folders below the session's own file.
files = glob.glob(os.path.join(root, "projects", "**", "*.jsonl"), recursive=True)
for path in files:
    sub = os.sep + "subagents" + os.sep in path
    try:
        handle = open(path, errors="ignore")
    except OSError:
        continue
    for line in handle:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        t = when(o) if isinstance(o, dict) else None
        if not t:
            continue
        oldest = min(oldest, t)
        if t < since:
            continue
        msg = o.get("message") if isinstance(o.get("message"), dict) else {}
        session = o.get("sessionId") or path
        if o.get("type") == "user" and not sub:
            stamps[session].append(t)
            if typed(o, msg):
                prompts[session] += 1
                days.add(t.date())
        usage = msg.get("usage")
        if o.get("type") == "assistant" and isinstance(usage, dict):
            if not sub:
                stamps[session].append(t)
            r = requests.setdefault(msg.get("id") or o.get("uuid"), {"model": msg.get("model"), "sub": sub, "session": session})
            for p in PARTS:
                r[p] = max(r.get(p, 0), usage.get(p) or 0)
            for b in msg.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in ("Write", "Edit", "MultiEdit"):
                    i = b.get("input") or {}
                    text = [i.get("content"), i.get("new_string")] + [e.get("new_string") for e in i.get("edits") or [] if isinstance(e, dict)]
                    lines[b.get("id")] = sum(len(s.splitlines()) for s in text if isinstance(s, str))

reqs = [r for r in requests.values() if sum(r[p] for p in PARTS)]
total = lambda rows, *parts: sum(r[p] for r in rows for p in (parts or PARTS))
tokens = total(reqs) or 1
covered = max(1, min(DAYS, (now - oldest).days + 1))
month = lambda n: round(n * DAYS / covered)
median = lambda values: round(statistics.median(values)) if values else None
pct = lambda n: round(100 * n / tokens)
# What each kind of token costs next to new input, at list prices: the ratios are the same for every Claude model.
PRICE = {"cache_read_input_tokens": 0.1, "input_tokens": 1, "cache_creation_input_tokens": 1.25, "output_tokens": 5}
cost = sum(r[p] * PRICE[p] for r in reqs for p in PARTS) or 1
cost_pct = lambda *parts: round(100 * sum(r[p] * PRICE[p] for r in reqs for p in parts) / cost)
per_session = defaultdict(int)
by_model = defaultdict(int)
for r in reqs:
    by_model[r["model"]] += sum(r[p] for p in PARTS)
    if not r["sub"]:
        per_session[r["session"]] += 1


def minutes(ts):  # time at work: gaps over 30 minutes are breaks
    ts = sorted(ts)
    return sum((b - a).total_seconds() for a, b in zip(ts, ts[1:]) if (b - a).total_seconds() < 1800) / 60


worked = [s for s in prompts if prompts[s]]
print(json.dumps({
    "transcripts_read": len(files),
    "days_covered": covered,
    "days_with_prompts": min(len(days), covered),
    "sessions": len(worked),
    "a_month": {"prompts": month(sum(prompts.values())), "tokens": month(tokens), "requests": month(len(reqs)), "lines_written": month(sum(lines.values()))},
    "cost_split_pct": {"reread": cost_pct("cache_read_input_tokens"), "loaded": cost_pct("input_tokens", "cache_creation_input_tokens"), "written": cost_pct("output_tokens")},
    "subagent_tokens_pct": pct(total([r for r in reqs if r["sub"]])),
    "median": {
        "context_per_request": median([r["input_tokens"] + r["cache_creation_input_tokens"] + r["cache_read_input_tokens"] for r in reqs]),
        "prompts_per_session": median([prompts[s] for s in worked]),
        "requests_per_session": median([per_session[s] for s in worked if per_session[s]]),
        "minutes_per_session": median([minutes(stamps[s]) for s in worked]),
    },
    "models_pct_of_tokens": {m: pct(n) for m, n in sorted(by_model.items(), key=lambda x: -x[1]) if pct(n)},
}, indent=1))
