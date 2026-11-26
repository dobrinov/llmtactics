# Reads the last 30 days of Claude Code and Codex history, and changes nothing.
#   measure          totals, medians and model names: no prompt, path or project name
#   read N           page N of the prompts the user typed, with secrets masked
#   count RE [RE..]  for each expression, the sessions and days whose prompts match it,
#                    and the frequency, status and cost to report
import glob, json, os, re, statistics, sys
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

DAYS = 30
now = datetime.now(timezone.utc)
# The window is 30 calendar days in the user's time zone, today included.
since = datetime.combine(date.today() - timedelta(days=DAYS - 1), time.min).astimezone()
day_of = lambda t: t.astimezone().date()
root = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
codex = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
# Text the harness writes into the user's turn; not something the user typed.
# Work the user keeps out of the survey: LLM_SURVEY_SKIP='name1,name2' skips every session whose
# project folder's path holds one of the names (without case, any punctuation alike).
norm = lambda s: re.sub(r"[^a-z0-9]+", "-", (s or "").lower())
SKIP = [norm(x).strip("-") for x in os.environ.get("LLM_SURVEY_SKIP", "").split(",") if x.strip()]
skipped = lambda where: any(s and s in norm(where) for s in SKIP)
NOT_TYPED = ("<task-notification", "<system-reminder", "<local-command", "<command-", "<bash-",
             "<environment_context", "<user_instructions", "<user_shell_command", "# AGENTS.md instructions")
PARTS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
# What each kind of token costs next to new input, at list prices. The ratios are the same for every
# Claude model, and for every OpenAI model Codex uses, which bills no cache writes.
CLAUDE_PRICE = {"cache_read_input_tokens": 0.1, "input_tokens": 1, "cache_creation_input_tokens": 1.25, "output_tokens": 5}
OPENAI_PRICE = {"cache_read_input_tokens": 0.1, "input_tokens": 1, "cache_creation_input_tokens": 0, "output_tokens": 8}


def when(o):
    try:
        return datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00"))
    except Exception:
        return None


def lines_of(o):
    try:
        return open(o, errors="ignore")
    except OSError:
        return []


# Codex writes one file per session ("rollout"), below sessions/<year>/<month>/<day>/, and moves
# archived ones to archived_sessions/. Its first line describes the session.
codex_files = sorted(set(glob.glob(os.path.join(codex, "sessions", "**", "*.jsonl"), recursive=True)
                         + glob.glob(os.path.join(codex, "archived_sessions", "*.jsonl"))))


def codex_meta(path):
    for line in lines_of(path):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if isinstance(o, dict) and o.get("type") == "session_meta" and isinstance(o.get("payload"), dict):
            p = o["payload"]
            source = p.get("source")
            parent = re.search(r'"parent_thread_id":\s*"([^"]+)"', json.dumps(source)) if isinstance(source, dict) else None
            return {"id": p.get("id") or path, "cwd": p.get("cwd") or "",
                    # A subagent's session: its replies count, its "user" turns are the parent's instructions.
                    "sub": isinstance(source, dict) and "subagent" in source, "parent": parent and parent.group(1)}
        break
    return {"id": path, "cwd": "", "sub": False, "parent": None}


codex_meta_of = {path: codex_meta(path) for path in codex_files}
codex_cwd = {m["id"]: m["cwd"] for m in codex_meta_of.values()}


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


# Masking. The patterns go by ASCII letters, so that text in a script written without spaces is
# left alone, and each starts at the start of a word, so that a long paste costs no time.
CUE = r"(?<![A-Za-z])(?:password|passwd|pwd|passphrase|passcode|secret|token|api[-_ ]?key|cookie|bearer|otp)s?(?![A-Za-z])"
VALUE = r"[\"']?[^\s\"',;]+[\"']?(?:,\s*[^\s\"',;]+)*"
FILES = set("c cpp cs css csv env erb ex exs go h htm html java jpg js json jsx kt lock log md pdf php png py rb rs "
            "scss sh sql svg swift toml ts tsx txt vue xml yaml yml".split())


def path(m):  # two slashes or more, and a letter: not a date or a fraction
    text = m.group(0)
    return "[path]" if text.count("/") >= 2 and re.search("[A-Za-z]", text) else text


def name(m):  # a host, or any dotted name; a file name such as stats.js stays
    return m.group(0) if m.group(1).lower() in FILES else "[name]"


MASKS = [
    (re.compile(r"https?://\S+"), "[link]"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b", re.A), "[email]"),
    # "the password is X", "changed the token to X", "DB_PASSWORD=X", "password": "X": what follows the cue.
    (re.compile(r"(?i)(%s[\"']?)((?:\s+[A-Za-z]+){0,3}?(?:\s+(?:to|is|was)\s+|\s*[=:]\s*))%s" % (CUE, VALUE)), r"\1\2[masked]"),
    # "password hunter2", "API key sk-abc": the next word, when it is not an ordinary word.
    (re.compile(r"(?i)(%s)\s+(?=\S*[\d_\-!@#$%%^&*+=])\S+" % CUE), r"\1 [masked]"),
    (re.compile(r"(?i)\b(bearer)\s+\S+", re.A), r"\1 [masked]"),
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", re.A), "[address]"),
    (re.compile(r"(?<![\w/.~\\-])[A-Za-z]:\\[^\s\"']+", re.A), "[path]"),
    (re.compile(r"(?<![\w/.~-])(?:~|\.{1,2})?/?[\w.@-]+(?:/[\w.@-]+)+/?", re.A), path),
    (re.compile(r"(?<![\w.-])[\w-]{2,}(?:\.[\w-]+)*\.([A-Za-z]{2,})\b(?![\w-]*\()", re.A), name),
    (re.compile(r"(?<![!-~])[!-~]*%[0-9A-Fa-f]{2}[!-~]*"), "[masked]"),
    # Any word of 8 characters or more that mixes letters and digits: keys, cookies, codes, ids.
    (re.compile(r"(?<![!-~])(?=[!-~]*\d)(?=[!-~]*[A-Za-z])[!-~]{8,}"), "[masked]"),
    (re.compile(r"\b\d(?:[ -]?\d){4,}\b", re.A), "[number]"),
]


def masked(text, limit):
    text = text[:limit * 5]  # what is shown is cut to `limit`; no need to mask a whole paste
    for pattern, to in MASKS:
        text = pattern.sub(to, text)
    return " ".join(text.split())[:limit]


# The prompt log: one line for everything the user typed, slash commands included.
# A session that ran this survey is not a habit: it starts with the invitation, or names the script.
SURVEY = re.compile(r"Fetch \S+/contribute\S* and follow|llm-survey\.py", re.I)
log, older, surveyed = [], [], set()


def logged(t, session, display, pastes, tool):
    texts = [display.strip()] + [p for p in pastes if isinstance(p, str)]
    if t < since:
        older.append((t, texts))
        return
    if session and any(SURVEY.search(x) for x in texts):
        surveyed.add(session)
    log.append((t, session, display, pastes, texts, tool))


try:
    for line in open(os.path.join(root, "history.jsonl"), errors="ignore"):
        try:
            o = json.loads(line)
            t = datetime.fromtimestamp(o["timestamp"] / 1000, timezone.utc)
        except (ValueError, KeyError, TypeError):
            continue
        if not isinstance(o.get("display"), str) or skipped(o.get("project")):
            continue
        pastes = [v.get("content") for v in (o.get("pastedContents") or {}).values() if isinstance(v, dict)]
        logged(t, o.get("sessionId"), o["display"], pastes, "Claude Code")
except OSError:
    pass
# Codex's prompt log: {"session_id", "ts" in seconds, "text"}; pasted text is part of the prompt.
for line in lines_of(os.path.join(codex, "history.jsonl")):
    try:
        o = json.loads(line)
        t = datetime.fromtimestamp(o["ts"], timezone.utc)
    except (ValueError, KeyError, TypeError, OverflowError, OSError):
        continue
    text = o.get("text")
    if not isinstance(text, str) or not text.strip() or text.lstrip().startswith(NOT_TYPED) or skipped(codex_cwd.get(o.get("session_id"))):
        continue
    logged(t, o.get("session_id"), text, [], "Codex CLI")
log.sort(key=lambda e: e[0])
log = [e for e in log if e[1] not in surveyed]
log_days = sorted({day_of(e[0]) for e in log})
mode = sys.argv[1] if len(sys.argv) > 1 else "measure"

if mode == "tools":
    # The tools around the assistant, from a fixed list: which are installed, which run now, and on
    # how many of the 30 days each was used. Evidence: the command word of each shell history line
    # (nothing else of the line is kept), the dates of the tools' own session files, and the
    # terminal this runs in. It prints names from this list, numbers and model ids, nothing else.
    import shutil, subprocess
    home = os.path.expanduser("~")
    MAC = ["/Applications", os.path.join(home, "Applications")]
    # name, kind, app bundles, commands (installed, typed), processes, folders whose files are sessions
    KNOWN = [
        ("Claude Code", "harness", [], ["claude"], ["claude"], []),
        ("Codex CLI", "harness", [], ["codex"], ["codex"], ["~/.codex/sessions/**/*.jsonl"]),
        ("Gemini CLI", "harness", [], ["gemini"], ["gemini"], ["~/.gemini/tmp/*/chats/*.json", "~/.gemini/tmp/*/logs.json"]),
        ("OpenCode", "harness", [], ["opencode"], ["opencode"], ["~/.local/share/opencode/storage/session/**/*.json"]),
        ("Aider", "harness", [], ["aider"], ["aider"], []),
        ("Amp", "harness", [], ["amp"], ["amp"], []),
        ("Cursor", "editor", ["Cursor.app"], ["cursor"], ["Cursor"], ["~/Library/Application Support/Cursor/User/workspaceStorage/*", "~/.config/Cursor/User/workspaceStorage/*"]),
        ("VS Code", "editor", ["Visual Studio Code.app"], ["code"], ["Code", "code"], ["~/Library/Application Support/Code/User/workspaceStorage/*", "~/.config/Code/User/workspaceStorage/*"]),
        ("Windsurf", "editor", ["Windsurf.app"], ["windsurf"], ["Windsurf"], ["~/Library/Application Support/Windsurf/User/workspaceStorage/*", "~/.config/Windsurf/User/workspaceStorage/*"]),
        ("Zed", "editor", ["Zed.app"], ["zed"], ["zed"], []),
        ("Neovim", "editor", [], ["nvim"], ["nvim"], []),
        ("Vim", "editor", [], ["vim"], ["vim"], []),
        ("Emacs", "editor", ["Emacs.app"], ["emacs"], ["emacs", "Emacs"], []),
        ("Ghostty", "terminal", ["Ghostty.app"], ["ghostty"], ["ghostty"], []),
        ("iTerm2", "terminal", ["iTerm.app"], [], ["iTerm2"], []),
        ("Warp", "terminal", ["Warp.app"], [], ["stable", "Warp"], []),
        ("WezTerm", "terminal", ["WezTerm.app"], ["wezterm"], ["wezterm-gui"], []),
        ("kitty", "terminal", ["kitty.app"], ["kitty"], ["kitty"], []),
        ("Alacritty", "terminal", ["Alacritty.app"], ["alacritty"], ["alacritty"], []),
        ("Terminal.app", "terminal", [], [], ["Terminal"], []),
        ("tmux", "multiplexer", [], ["tmux"], ["tmux"], []),
        ("Zellij", "multiplexer", [], ["zellij"], ["zellij"], []),
        ("ChatGPT", "chat", ["ChatGPT.app"], [], ["ChatGPT"], []),
        ("Claude", "chat", ["Claude.app"], [], ["Claude"], []),
    ]
    # What TERM_PROGRAM and friends call each terminal: it runs on every day the assistant is used.
    TERMS = {"ghostty": "Ghostty", "iTerm.app": "iTerm2", "WarpTerminal": "Warp", "WezTerm": "WezTerm", "Apple_Terminal": "Terminal.app", "vscode": "VS Code", "zed": "Zed"}
    window = lambda t: t >= since
    days_of = defaultdict(set)
    # Shell history with times: zsh (": <time>:0;cmd"), bash with HISTTIMEFORMAT ("#<time>" lines), fish.
    words = {c: n for n, _, _, cmds, _, _ in KNOWN for c in cmds}
    def typed_word(cmd, t):
        m = re.match(r"\s*(?:sudo\s+|command\s+|exec\s+|\w+=\S*\s+)*([\w.-]+)", cmd)
        if m and m.group(1) in words and window(t):
            days_of[words[m.group(1)]].add(day_of(t))
    for hist in [os.environ.get("HISTFILE") or "", os.path.join(home, ".zsh_history"), os.path.join(home, ".bash_history")]:
        try:
            stamp = None
            for line in open(hist, errors="ignore"):
                z = re.match(r": (\d{9,11}):\d+;(.*)", line)
                if z:
                    typed_word(z.group(2), datetime.fromtimestamp(int(z.group(1)), timezone.utc))
                elif re.match(r"#\d{9,11}\s*$", line):
                    stamp = datetime.fromtimestamp(int(line[1:]), timezone.utc)
                elif stamp:
                    typed_word(line, stamp)
                    stamp = None
        except (OSError, ValueError):
            pass
    try:
        cmd = None
        for line in open(os.path.join(home, ".local/share/fish/fish_history"), errors="ignore"):
            if line.startswith("- cmd: "):
                cmd = line[7:]
            elif line.strip().startswith("when: ") and cmd:
                typed_word(cmd, datetime.fromtimestamp(int(line.split(":")[1]), timezone.utc))
                cmd = None
    except (OSError, ValueError):
        pass
    # Session files: the day each was last written.
    for n, _, _, _, _, globs in KNOWN:
        for g in globs:
            for f in glob.glob(os.path.expanduser(g), recursive=True):
                try:
                    t = datetime.fromtimestamp(os.path.getmtime(f), timezone.utc)
                except OSError:
                    continue
                if window(t):
                    days_of[n].add(day_of(t))
    # This assistant's own days, and the terminal and multiplexer it runs in share them.
    for e in log:
        days_of[e[5]].add(day_of(e[0]))
    here = []
    if os.environ.get("TMUX"):
        here.append("tmux")
    if os.environ.get("ZELLIJ"):
        here.append("Zellij")
    # Cursor's and Windsurf's terminals say "vscode" too: their app path or bundle id tells them apart.
    def term_name(program, env):
        if program != "vscode":
            return TERMS.get(program)
        hint = " ".join(env.get(k, "") for k in ("__CFBundleIdentifier", "VSCODE_GIT_ASKPASS_NODE", "VSCODE_GIT_ASKPASS_MAIN")).lower()
        if "cursor" in hint or "todesktop" in hint or env.get("CURSOR_TRACE_ID"):
            return "Cursor"
        if "windsurf" in hint or "exafunction" in hint:
            return "Windsurf"
        return "VS Code"
    terminal = term_name(os.environ.get("TERM_PROGRAM", ""), os.environ)
    if os.environ.get("TMUX"):
        try:
            out = subprocess.run(["tmux", "show-environment", "-g", "TERM_PROGRAM"], capture_output=True, text=True, timeout=5).stdout
            terminal = term_name(out.strip().partition("=")[2], os.environ) or terminal
        except (OSError, subprocess.SubprocessError):
            pass
    for prefix, n in (("GHOSTTY_", "Ghostty"), ("ITERM_", "iTerm2"), ("KITTY_", "kitty"), ("WEZTERM_", "WezTerm"), ("ALACRITTY_", "Alacritty"), ("WARP_", "Warp")):
        if any(k.startswith(prefix) for k in os.environ):
            terminal = terminal or n
    if terminal:
        here.append(terminal)
    for n in here:
        days_of[n] |= set(log_days)
    # Running now: process names only.
    try:
        running = {os.path.basename(p.strip()) for p in subprocess.run(["ps", "-axo", "comm="], capture_output=True, text=True, timeout=10).stdout.splitlines()}
    except (OSError, subprocess.SubprocessError):
        running = set()
    active = set(log_days).union(*days_of.values()) if days_of else set(log_days)
    rows = []
    for n, kind, apps, cmds, procs, _ in KNOWN:
        installed = any(os.path.exists(os.path.join(d, a)) for d in MAC for a in apps) or any(shutil.which(c) for c in cmds)
        is_open = n in here or any(p in running for p in procs)
        d = len(days_of[n])
        if not (installed or is_open or d):
            continue
        rows.append({"name": n, "kind": kind, "installed": bool(installed), "open": is_open, "days": d,
                     "frequency": None if not d else "daily" if d * 2 >= len(active) else "weekly" if d >= 4 else "occasionally"})
    # The model each agent is set to use, from its settings file.
    MODEL = re.compile(r"^[A-Za-z0-9._:/@-]{1,60}$")
    def setting(path, read):
        try:
            text = open(os.path.expanduser(path), errors="ignore").read()
            value = read(text)
            return value if isinstance(value, str) and MODEL.match(value) else None
        except (OSError, ValueError, AttributeError, TypeError, KeyError):
            return None
    def toml_model(text):
        m = re.search(r'(?m)^model\s*=\s*"([^"]+)"', text)
        return m and m.group(1)
    def json_model(text):
        o = json.loads(re.sub(r"(?m)^\s*//.*$", "", text))
        m = o.get("model")
        return m.get("name") if isinstance(m, dict) else m
    settings = {
        "Claude Code": setting(os.path.join(root, "settings.json"), json_model),
        "Codex CLI": setting("~/.codex/config.toml", toml_model),
        "Gemini CLI": setting("~/.gemini/settings.json", json_model),
        "OpenCode": setting("~/.config/opencode/opencode.json", json_model) or setting("~/.config/opencode/opencode.jsonc", json_model),
        "Aider": setting("~/.aider.conf.yml", lambda t: re.search(r"(?m)^model:\s*(\S+)", t).group(1)),
    }
    print(json.dumps({"active_days": len(active), "tools": sorted(rows, key=lambda r: (-r["days"], not r["open"], r["name"])),
                      "models_in_settings": {k: v for k, v in settings.items() if v}}, indent=1))
    sys.exit()

if mode == "read":
    PAGE = 16000  # bytes: small enough for a tool to show whole
    order = {}
    pages, size = [[]], 0
    for t, session, text, pastes, *_ in log:
        row = "d%02d s%d | %s" % (log_days.index(day_of(t)) + 1, order.setdefault(session, len(order) + 1), masked(text, 600))
        for paste in pastes:
            row += " [pasted: %s]" % (masked(paste, 120) if isinstance(paste, str) else "text not kept")
        weight = len(row.encode("utf-8", "replace")) + 1
        if size + weight > PAGE and pages[-1]:
            pages.append([])
            size = 0
        pages[-1].append(row)
        size += weight
    n = min(max(int(sys.argv[2]) if len(sys.argv) > 2 else 1, 1), len(pages))
    print("page %d of %d. %d prompts, %d sessions, %d days. d = day, s = session. Left out: %d sessions that ran this survey."
          % (n, len(pages), len(log), len(order), len(log_days), len(surveyed)))
    print("\n".join(pages[n - 1]).encode("utf-8", "replace").decode())
    sys.exit()

requests = {}  # one per model reply: a reply is written as several lines, and copied into resumed sessions
prompts = defaultdict(int)
stamps = defaultdict(list)
lines = {}
days = set()
oldest = now
# Every transcript, subagents included: they sit in folders below the session's own file.
projects = os.path.join(root, "projects")
files = [f for f in glob.glob(os.path.join(projects, "**", "*.jsonl"), recursive=True)
         if not skipped(os.path.relpath(f, projects).split(os.sep)[0])]
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
                days.add(day_of(t))
        usage = msg.get("usage")
        if o.get("type") == "assistant" and isinstance(usage, dict):
            if not sub:
                stamps[session].append(t)
            r = requests.setdefault(msg.get("id") or o.get("uuid"), {"model": msg.get("model"), "sub": sub, "session": session, "t": t, "seen": set(), "price": CLAUDE_PRICE})
            r["seen"].add(session)  # a resumed session holds a copy of the replies before it
            for p in PARTS:
                r[p] = max(r.get(p, 0), usage.get(p) or 0)
            for b in msg.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in ("Write", "Edit", "MultiEdit"):
                    i = b.get("input") or {}
                    text = [i.get("content"), i.get("new_string")] + [e.get("new_string") for e in i.get("edits") or [] if isinstance(e, dict)]
                    lines[b.get("id")] = sum(len(s.splitlines()) for s in text if isinstance(s, str))


def patch_lines(text):  # lines a Codex patch adds: in "*** Begin Patch" format each starts with "+"
    return sum(1 for l in text.splitlines() if l.startswith("+") and not l.startswith("+++"))


# Codex: every line is {"timestamp", "type", "payload"}. The prompts are the "user_message" events;
# after each model reply comes a "token_count" event whose last_token_usage is that reply. The same
# event is sometimes written twice, and a forked session copies the events before it: a reply is
# one (time, running total) pair. OpenAI counts cached input inside input_tokens, and reasoning
# inside output_tokens.
codex_prompts = set()
for path in codex_files:
    meta = codex_meta_of[path]
    if skipped(meta["cwd"]):
        continue
    sub = meta["sub"]
    session = (meta["parent"] if sub else None) or meta["id"]
    model, running = None, None
    for line in lines_of(path):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if not isinstance(o, dict) or not isinstance(o.get("payload"), dict):
            continue
        p, kind = o["payload"], o.get("type")
        if kind == "turn_context":
            model = p.get("model") or model
            continue
        t = when(o)
        if not t:
            continue
        oldest = min(oldest, t)
        info = p.get("info") if kind == "event_msg" and p.get("type") == "token_count" else None
        total = json.dumps(info.get("total_token_usage"), sort_keys=True) if isinstance(info, dict) else None
        fresh = total is not None and total != running
        if total is not None:
            running = total
        if t < since:
            continue
        if kind == "event_msg" and p.get("type") == "user_message" and not sub:
            stamps[session].append(t)
            text = p.get("message")
            key = (o.get("timestamp"), text)  # a forked session copies the prompts before it
            if p.get("kind") in (None, "plain") and isinstance(text, str) and text.strip() and not text.lstrip().startswith(NOT_TYPED) and key not in codex_prompts:
                codex_prompts.add(key)
                prompts[session] += 1
                days.add(day_of(t))
        last = info.get("last_token_usage") if isinstance(info, dict) else None
        if fresh and isinstance(last, dict):
            if not sub:
                stamps[session].append(t)
            num = lambda k: last.get(k) if isinstance(last.get(k), int) else 0
            cached = min(num("cached_input_tokens"), num("input_tokens"))
            r = requests.setdefault(("codex", o.get("timestamp"), total), {
                "model": model, "sub": sub, "session": session, "t": t, "seen": set(), "price": OPENAI_PRICE,
                "input_tokens": num("input_tokens") - cached, "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": cached, "output_tokens": num("output_tokens")})
            r["seen"].add(session)
        if kind == "response_item" and p.get("type") in ("custom_tool_call", "function_call"):
            body = p.get("input") if p.get("type") == "custom_tool_call" else p.get("arguments")
            if isinstance(body, str) and "*** Begin Patch" in body:
                try:  # a shell call carries the patch inside a JSON list of arguments
                    parsed = json.loads(body)
                    body = "\n".join(x for x in (parsed.get("command") or []) if isinstance(x, str)) if isinstance(parsed, dict) else body
                except (ValueError, AttributeError, TypeError):
                    pass
                lines[("codex", p.get("call_id") or o.get("timestamp"))] = patch_lines(body)

reqs = [r for r in requests.values() if sum(r[p] for p in PARTS)]
total = lambda rows, *parts: sum(r[p] for r in rows for p in (parts or PARTS))
tokens = total(reqs) or 1
covered = max(1, min(DAYS, (day_of(now) - day_of(oldest)).days + 1))
month = lambda n: round(n * DAYS / covered)
median = lambda values: round(statistics.median(values)) if values else None
pct = lambda n: round(100 * n / tokens)
cost = sum(r[p] * r["price"][p] for r in reqs for p in PARTS) or 1
cost_pct = lambda *parts: round(100 * sum(r[p] * r["price"][p] for r in reqs for p in parts) / cost)
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
    # What a prompt costs: the tokens of every reply between it and the user's next prompt in that
    # session, subagents included, weighed by price. This is what makes a habit light or heavy.
    replies = defaultdict(list)
    for r in reqs:
        for session in r["seen"]:  # a copy sits before the first prompt of its session, so in no turn
            replies[session].append((r["t"], sum(r[p] * r["price"][p] for p in PARTS)))
    turns = defaultdict(list)
    for e in log:
        turns[e[1]].append(e[0])
    price = {}
    for session, starts in turns.items():
        for i, start in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else now
            if replies[session]:
                price[(session, start)] = sum(c for t, c in replies[session] if start <= t < end)
    # The usual prompt is one that got a reply: a command that starts no work is not the measure.
    usual = statistics.median([c for c in price.values() if c] or [0])
    first_record = min([e[0] for e in older] or [since])
    for expression in sys.argv[2:]:
        try:
            match = re.compile(expression, re.I | re.S)
        except re.error as error:
            print(json.dumps({"expression": expression, "error": str(error)}))
            continue
        hits = [e for e in log if any(match.search(x) for x in e[4])]
        sessions = {e[1] for e in hits}
        on = len({day_of(e[0]) for e in hits})
        costs = [price[(e[1], e[0])] for e in hits if (e[1], e[0]) in price]
        ratio = statistics.median(costs) / usual if costs and usual else None
        before = any(match.search(x) for _, texts in older for x in texts)
        print(json.dumps({
            "expression": expression, "prompts": len(hits), "sessions": len(sessions), "of_sessions": len({e[1] for e in log}),
            "days": on, "of_days": len(log_days),
            "qualifies": len(sessions) >= 3,
            "frequency": "daily" if on * 2 >= len(log_days) else "weekly" if on >= 4 else "occasionally",
            # New: nothing matches before these 30 days, in a log that goes back at least another 30.
            "status": "new" if hits and not before and (since - first_record).days >= DAYS else "active",
            "cost": None if ratio is None else "light" if ratio < 0.5 else "heavy" if ratio > 2 else "medium",
        }))
    sys.exit()

worked = [s for s in prompts if prompts[s]]
print(json.dumps({
    "transcripts_read": {k: n for k, n in (("Claude Code", len(files)), ("Codex CLI", len(codex_files))) if n},
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
