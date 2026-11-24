# Reads the last 30 days of Claude Code history, and changes nothing.
#   measure          totals, medians and model names: no prompt, path or project name
#   read N           page N of the prompts the user typed, with secrets masked
#   count RE [RE..]  for each expression, the sessions and days whose prompts match it
import glob, json, os, re, statistics, sys
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


MASKS = [
    (re.compile(r"https?://\S+"), "[link]"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[email]"),
    (re.compile(r"(?i)\b(password|passwd|pwd|secret|token|api[-_ ]?key|cookie|bearer)(\s*(?:is|=|:)\s*|\s+)\S+"), r"\1 [masked]"),
    (re.compile(r"\b(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])[\w+/=-]{20,}"), "[masked]"),
]


def masked(text, limit):
    for pattern, to in MASKS:
        text = pattern.sub(to, text)
    return " ".join(text.split())[:limit]


# The prompt log: one line for everything the user typed, slash commands included.
log = []
try:
    for line in open(os.path.join(root, "history.jsonl"), errors="ignore"):
        try:
            o = json.loads(line)
            t = datetime.fromtimestamp(o["timestamp"] / 1000, timezone.utc)
        except (ValueError, KeyError, TypeError):
            continue
        if t >= since and isinstance(o.get("display"), str):
            pastes = [v.get("content") for v in (o.get("pastedContents") or {}).values() if isinstance(v, dict)]
            log.append((t, o.get("sessionId"), o["display"], pastes))
except OSError:
    pass
log.sort(key=lambda e: e[0])
day_of = lambda t: t.astimezone().date()
log_days = sorted({day_of(e[0]) for e in log})
mode = sys.argv[1] if len(sys.argv) > 1 else "measure"

if mode == "read":
    PAGE = 24000
    order = {}
    pages, size = [[]], 0
    for t, session, text, pastes in log:
        row = "d%02d s%d | %s" % (log_days.index(day_of(t)) + 1, order.setdefault(session, len(order) + 1), masked(text, 600))
        for paste in pastes:
            row += " [pasted: %s]" % (masked(paste, 120) if isinstance(paste, str) else "text not kept")
        if size + len(row) > PAGE and pages[-1]:
            pages.append([])
            size = 0
        pages[-1].append(row)
        size += len(row) + 1
    n = min(max(int(sys.argv[2]) if len(sys.argv) > 2 else 1, 1), len(pages))
    print("page %d of %d. %d prompts, %d sessions, %d days. d = day, s = session." % (n, len(pages), len(log), len(order), len(log_days)))
    print("\n".join(pages[n - 1]))
    sys.exit()

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


if mode == "count":
    spent = defaultdict(int)
    for r in reqs:
        spent[r["session"]] += sum(r[p] for p in PARTS)
    typed_in = defaultdict(int)
    for e in log:
        typed_in[e[1]] += 1
    # What a prompt costs in tokens, in a set of sessions: this is what makes a habit light or heavy.
    per_prompt = lambda sessions: sum(spent[s] for s in sessions) / max(1, sum(typed_in[s] for s in sessions if spent[s])) if any(spent[s] for s in sessions) else None
    usual = per_prompt(set(typed_in))
    for expression in sys.argv[2:]:
        try:
            hits = [e for e in log if re.search(expression, e[2] + " " + " ".join(p for p in e[3] if isinstance(p, str)), re.I | re.S)]
        except re.error as error:
            print(json.dumps({"expression": expression, "error": str(error)}))
            continue
        sessions = {e[1] for e in hits}
        on = len({day_of(e[0]) for e in hits})
        here = per_prompt(sessions)
        ratio = here / usual if here and usual else None
        print(json.dumps({
            "expression": expression, "prompts": len(hits), "sessions": len(sessions), "days": on, "of_days": len(log_days),
            "qualifies": len(sessions) >= 3,
            "frequency": "daily" if on * 2 >= len(log_days) else "weekly" if on >= 4 else "occasionally",
            "cost": None if ratio is None else "light" if ratio < 0.5 else "heavy" if ratio > 2 else "medium",
        }))
    sys.exit()

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
