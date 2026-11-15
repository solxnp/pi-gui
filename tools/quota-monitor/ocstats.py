#!/usr/bin/env python3
"""
ocstats - 按模型统计 OpenCode Go 的真实额度消耗

原理（全部实测验证）：
  Reasonix 的两次记录可以拼出精确的按模型用量：
    1. events.jsonl 的 append 事件带 message_index + created_at（精确到秒）
    2. wire.jsonl 的 turn_started 带 msgIndex + modelRef（哪个模型）
    3. wire.jsonl 的 usage 事件带 costUsd（Reasonix 已按 rate_card 算好，精确）
  按 seq 顺序把 usage 归属到最近的 turn_started，就得到「某模型在某时刻花了多少钱」。

窗口：用官方 /usage 返回的 rolling.resetsAt 反推 5 小时窗口起点，不自己猜。
      实测确认：resetsAt 不是整点，是从当天首次请求起算的滚动块。

用法：
  ocstats              # 主模型 5 小时窗口
  ocstats --all        # 所有模型
  ocstats --week       # 本周
  ocstats --month      # 本月
  ocstats --json       # 机器可读
"""
import argparse
import datetime
import glob
import json
import os
import sqlite3
import sys
import time
import urllib.request
from collections import defaultdict

# 官方 Go 价格表：月限额(USD) 与 allowance 折算系数
# 来源 https://opencode.ai/docs/console/go#usage-limits （2026-11-07 实测）
PLANS = {
    "deepseek-v4.1-flash": {"limit": 100, "k": 0.6},
    "deepseek-v4-pro":     {"limit": 15,  "k": 4.0},
    "glm-5.3-flash":       {"limit": 60,  "k": 1.0},
    "glm-5.3":             {"limit": 15,  "k": 4.0},
    "glm-5.2":             {"limit": 60,  "k": 1.0},
    "qwen3.8-flash":       {"limit": 30,  "k": 2.0},
    "qwen3.8-max":         {"limit": 15,  "k": 1.0},
    "qwen3.7-plus":        {"limit": 60,  "k": 1.0},
    "minimax-m3.1-flash":  {"limit": 20,  "k": 3.0},
    "minimax-m3":          {"limit": 60,  "k": 1.0},
    "kimi-k3":             {"limit": 15,  "k": 4.0},
    "kimi-k3.1-pro":       {"limit": 15,  "k": 1.0},
    "kimi-k2.7-code":      {"limit": 60,  "k": 1.0},
    "longcat-2.0":         {"limit": 60,  "k": 1.0},
    "step-5-preview":      {"limit": 15,  "k": 1.0},
    "mimo-v2.6-flash":     {"limit": 60,  "k": 1.0},
    "mimo-v2.6-pro":       {"limit": 15,  "k": 1.0},
    "muse-spark-1.2-contributor": {"limit": 60, "k": 1.0},
    "muse-spark-1.3-contributor": {"limit": 60, "k": 1.0},
    "hy4":                 {"limit": 60,  "k": 1.0},
    "hy4-preview":         {"limit": 30,  "k": 1.0},
    "hy3":                 {"limit": 60,  "k": 1.0},
    "grok-4.7":            {"limit": 15,  "k": 1.0},
    "gpt-6-luna":          {"limit": 15,  "k": 1.0},
    "gpt-5.6-luna":        {"limit": 15,  "k": 1.0},
    "claude-haiku-5-5":    {"limit": 15,  "k": 1.0},
    "gemini-4-argon":      {"limit": 30,  "k": 1.0},
}

SHARE_5H, SHARE_WEEK, SHARE_MONTH = 0.20, 0.50, 1.00

# ── 高峰时段价格倍数 ───────────────────────────────────────────────
# 官方 /zen/go/v1/models 的 cost.multipliers 会给某些模型配高峰倍数，
# 例如 DS V4.1 Flash：周一至周五 UTC 01:00–04:00、06:00–10:00 价格 ×2
# （= 北京时间 09:00–12:00、14:00–18:00，同一日历日，不跨日）。
#
# 作用范围实测（2026-11-13 01:05Z，周五，高峰窗口内）：
#   DS V4.1 Flash  list_cost 1.05e-05（低谷 5.25e-06，×2）
#                  allowance 6.30e-06（低谷 3.15e-06，×2）  比值仍 = k(0.6)
#   GLM-5.3-Flash  无倍数规则 → list_cost/allowance 完全不变（对照组）
# 而 pi 与 Reasonix 记的 cost 都是基础价、不含倍数（同一分钟实测比值均为 1.00），
# 所以这里必须按【请求发生的时刻】自己把倍数乘回去，否则高峰期低估一半。
CATALOG_CACHE = os.path.expanduser(
    "~/.reasonix/global-workspace/.ocquota-models.json")
CATALOG_TTL = 24 * 3600

# 拉不到 /v1/models 且没缓存时的兜底规则（结构与官方 multipliers 一致）
_PEAK_MON_FRI = {
    "utc_days": {"in": ["mon", "tue", "wed", "thu", "fri"]},
    "any": [
        {"all": [{"utc_hours": {"gte": "01:00"}}, {"utc_hours": {"lt": "04:00"}}]},
        {"all": [{"utc_hours": {"gte": "06:00"}}, {"utc_hours": {"lt": "10:00"}}]},
    ],
}
DEFAULT_MULTIPLIERS = {
    "deepseek-v4.1-flash": [{"when": _PEAK_MON_FRI, "factor": 2}],
    "deepseek-v4-pro": [{"when": _PEAK_MON_FRI, "factor": 2}],
}

_DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _hhmm_minutes(s):
    h, m = str(s).split(":")[:2]
    return int(h) * 60 + int(m)


def match_when(when, dt):
    """
    按官方 multipliers[].when 的结构判断某一时刻是否命中。

    只实现实际出现过的算子（any / all / utc_days.in / utc_hours.gte|lt /
    date.gte|lt）；遇到没见过的算子直接判不命中——宁可少算一次倍数，
    也不凭空编一个倍数出来。
    """
    if not isinstance(when, dict):
        return False
    for key, cond in when.items():
        if key == "any":
            if not any(match_when(c, dt) for c in cond):
                return False
        elif key == "all":
            if not all(match_when(c, dt) for c in cond):
                return False
        elif key == "utc_days":
            days = cond.get("in") if isinstance(cond, dict) else None
            if not days or _DAY_NAMES[dt.weekday()] not in days:
                return False
        elif key == "utc_hours":
            cur = dt.hour * 60 + dt.minute
            gte, lt = cond.get("gte"), cond.get("lt")
            if gte is not None and cur < _hhmm_minutes(gte):
                return False
            if lt is not None and cur >= _hhmm_minutes(lt):
                return False
        elif key == "date":
            today = dt.date().isoformat()
            gte, lt = cond.get("gte"), cond.get("lt")
            if gte is not None and today < gte:
                return False
            if lt is not None and today >= lt:
                return False
        else:
            return False
    return True


def load_catalog(force=False):
    """
    返回 ({model_id: [multiplier...]}, 来源)。

    优先用 24 小时内的本地缓存；过期就拉 /v1/models（带 token）并写缓存；
    拉失败则退回旧缓存，再不行用 DEFAULT_MULTIPLIERS —— 绝不让面板变空。
    """
    cache = {}
    try:
        with open(CATALOG_CACHE, encoding="utf-8") as f:
            cache = json.load(f) or {}
    except (OSError, ValueError):
        cache = {}

    cached = cache.get("multipliers")
    fetched_at = cache.get("fetched_at") or 0
    if not force and isinstance(cached, dict) and time.time() - fetched_at < CATALOG_TTL:
        return cached, "cache"

    key = load_key()
    data = None
    if key:
        try:
            req = urllib.request.Request(
                "https://opencode.ai/zen/go/v1/models",
                headers={"Authorization": f"Bearer {key}",
                         "User-Agent": "opencode/2.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.load(r)
        except Exception:
            data = None

    if isinstance(data, dict) and isinstance(data.get("data"), list):
        vals = {}
        for m in data["data"]:
            mid = m.get("id")
            if mid:
                vals[mid] = ((m.get("cost") or {}).get("multipliers") or [])
        try:
            tmp = CATALOG_CACHE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"fetched_at": time.time(), "multipliers": vals},
                          f, ensure_ascii=False)
            os.replace(tmp, CATALOG_CACHE)
        except OSError:
            pass
        return vals, "api"

    if isinstance(cached, dict):
        return cached, "cache(stale)"
    return dict(DEFAULT_MULTIPLIERS), "builtin"


_multipliers_cache = None


def multiplier_for(model, dt):
    """某模型在某时刻生效的价格倍数（1.0 表示不翻倍）。"""
    global _multipliers_cache
    if _multipliers_cache is None:
        _multipliers_cache = load_catalog()
    rules = (_multipliers_cache[0] or {}).get(model) or []
    factor = 1.0
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        if match_when(rule.get("when") or {}, dt):
            try:
                factor *= float(rule.get("factor") or 1.0)
            except (TypeError, ValueError):
                continue
    return factor


def catalog_source():
    """已加载的价表来源（api / cache / cache(stale) / builtin），仅用于展示。"""
    global _multipliers_cache
    if _multipliers_cache is None:
        _multipliers_cache = load_catalog()
    return _multipliers_cache[1]


def load_key():
    env = os.path.expanduser("~/.reasonix/.env")
    try:
        for line in open(env, encoding="utf-8"):
            line = line.strip()
            if line.startswith("OPENCODE_GO_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    try:
        con = sqlite3.connect(os.path.expanduser("~/.local/share/opencode/opencode.db"))
        row = con.execute(
            "SELECT value FROM credential WHERE integration_id='opencode' AND active=1"
        ).fetchone()
        if row:
            return json.loads(row[0]).get("access")
    except Exception:
        pass
    return None


def account_usage(key):
    req = urllib.request.Request(
        "https://opencode.ai/zen/go/v1/usage",
        headers={"Authorization": f"Bearer {key}", "User-Agent": "opencode/2.0"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r).get("usage", {})


def parse_iso(s):
    """兼容 Python 3.9：fromisoformat 不支持任意位数的小数秒。"""
    if not s:
        return None
    raw = s.replace("Z", "+00:00")
    try:
        return datetime.datetime.fromisoformat(raw)
    except ValueError:
        pass
    # 归一化小数秒到 6 位
    import re
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$", raw)
    if not m:
        return None
    head, frac, tail = m.group(1), m.group(2) or "", m.group(3) or ""
    frac = (frac + "000000")[:6]
    try:
        return datetime.datetime.fromisoformat(f"{head}.{frac}{tail}")
    except ValueError:
        return None


def collect_pi(since_utc):
    """
    扫描 pi / pi-gui 的会话日志，返回 [(model, ts, costUsd)]。

    原因（2026-11-12 实测）：Reasonix 的日志只记录 Reasonix 自己发出的请求。
    改用 pi 之后 Reasonix 不再写日志，5 小时窗口里就一条记录都没有，
    面板的「单模型」区域整块消失。pi 的每条 assistant 消息自带
    usage.cost.total 和 model，直接按 model 累加即可。
    """
    rows = []
    pattern = os.path.expanduser("~/.pi/agent/sessions/*/*.jsonl")
    for f in glob.glob(pattern):
        try:
            # 文件在本窗口开始前就没有再写过 → 不可能有窗口内的记录，直接跳过（省秒级扫描）
            if os.path.getmtime(f) < since_utc.timestamp():
                continue
            with open(f, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if '"usage"' not in line:
                        continue
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    msg = d.get("message") or {}
                    u = msg.get("usage") or {}
                    if not u:
                        continue
                    cost = (u.get("cost") or {}).get("total") or 0
                    ts_ms = msg.get("timestamp") or d.get("timestamp") or 0
                    if not cost or not ts_ms:
                        continue
                    dt = datetime.datetime.fromtimestamp(
                        ts_ms / 1000.0, tz=datetime.timezone.utc)
                    if dt < since_utc:
                        continue
                    rows.append((msg.get("model") or "unknown", dt, float(cost)))
        except OSError:
            continue
    return rows


def collect(since_utc):
    """
    扫描全部会话，返回 [(model, ts, costUsd)]，只保留 ts >= since_utc 的。

    两个来源合并：Reasonix（~/.reasonix）与 pi（~/.pi）。
    只要任一个在本窗口里有记录，单模型区域就有数据。
    """
    rows = []
    pattern = os.path.expanduser("~/.reasonix/projects/*/sessions/*.jsonl.meta")
    for meta in glob.glob(pattern):
        base = meta[: -len(".jsonl.meta")]
        ev_f, wr_f = base + ".events.jsonl", base + ".wire.jsonl"
        if not (os.path.exists(ev_f) and os.path.exists(wr_f)):
            continue

        # 1) message_index -> created_at
        tmap = {}
        try:
            with open(ev_f, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    if d.get("type") == "append" and d.get("message_index") is not None:
                        tmap[d["message_index"]] = d.get("created_at")
        except OSError:
            continue
        if not tmap:
            continue

        # 2) wire 事件
        try:
            with open(wr_f, encoding="utf-8", errors="replace") as fh:
                evts = [json.loads(l) for l in fh if l.strip()]
        except (OSError, ValueError):
            continue

        # 3) turn 边界（seq, model, ts）
        turns = []
        for e in evts:
            if e.get("kind") == "turn_started":
                ts = tmap.get(e.get("msgIndex"))
                if ts:
                    ref = e.get("modelRef", "")
                    turns.append((e.get("seq", 0), ref.split("/")[-1], ts))
        if not turns:
            continue
        turns.sort(key=lambda t: t[0])

        # 4) usage 归属：按 seq 找最近的已开启 turn
        for e in evts:
            if e.get("kind") != "usage":
                continue
            seq = e.get("seq", 0)
            u = e.get("usage") or {}
            cost = u.get("costUsd") or u.get("cost") or 0
            if not cost:
                continue
            owner = None
            for tseq, model, ts in turns:
                if tseq <= seq:
                    owner = (model, ts)
                else:
                    break
            if not owner:
                continue
            dt = parse_iso(owner[1])
            if dt is None or dt < since_utc:
                continue
            rows.append((owner[0], dt, float(cost)))

    rows.extend(collect_pi(since_utc))
    return rows


def window_start(usage, kind):
    """
    用官方 resetsAt 反推窗口起点。
    rolling: resetsAt - 5h
    weekly : resetsAt - 7d
    monthly: resetsAt - 30d
    """
    d = usage.get(kind) or {}
    reset = parse_iso(d.get("resetsAt"))
    if not reset:
        return None
    span = {"rolling": datetime.timedelta(hours=5),
            "weekly": datetime.timedelta(days=7),
            "monthly": datetime.timedelta(days=30)}[kind]
    return reset - span


def fmt_money(v):
    if v >= 1:
        return f"${v:.2f}"
    if v >= 0.01:
        return f"${v:.3f}"
    return f"${v:.5f}"


def bar(pct, width=10):
    pct = max(0.0, min(100.0, pct))
    filled = int(round(width * pct / 100.0))
    return "█" * filled + "░" * (width - filled)


def main():
    ap = argparse.ArgumentParser(description="按模型统计 OpenCode Go 额度消耗")
    ap.add_argument("--all", action="store_true", help="显示所有模型")
    ap.add_argument("--week", action="store_true", help="本周窗口")
    ap.add_argument("--month", action="store_true", help="本月窗口")
    ap.add_argument("--json", action="store_true", help="JSON 输出")
    ap.add_argument("--reset-at", metavar="ISO8601", default=None,
                    help="已知的窗口重置时间（跳过自身网络请求，由调用方传入）")
    args = ap.parse_args()

    key = load_key()
    if not key:
        print("找不到 OPENCODE_GO_API_KEY", file=sys.stderr)
        return 1

    if args.month:
        kind, share, label = "monthly", SHARE_MONTH, "本月"
    elif args.week:
        kind, share, label = "weekly", SHARE_WEEK, "本周"
    else:
        kind, share, label = "rolling", SHARE_5H, "5小时"

    # 有 --reset-at 就不请求网络（省 1.2 秒）；否则自己拿
    if args.reset_at:
        usage = {kind: {"resetsAt": args.reset_at, "percent": None}}
    else:
        usage = account_usage(key)

    start = window_start(usage, kind)
    if start is None:
        print("无法确定窗口起点（官方未返回 resetsAt）", file=sys.stderr)
        return 1

    rows = collect(start)
    agg = defaultdict(lambda: {"cost": 0.0, "n": 0})
    peak_extra = 0.0
    peak_requests = 0
    for model, ts, cost in rows:
        mult = multiplier_for(model, ts)
        if mult != 1.0:
            peak_extra += cost * (mult - 1.0)
            peak_requests += 1
        agg[model]["cost"] += cost * mult
        agg[model]["n"] += 1

    now = datetime.datetime.now(datetime.timezone.utc)
    reset = parse_iso((usage.get(kind) or {}).get("resetsAt"))
    local_tz = datetime.timezone(datetime.timedelta(hours=8))

    if args.json:
        out = {
            "window": kind,
            "window_start_utc": start.isoformat(),
            "window_reset_utc": reset.isoformat() if reset else None,
            "account": {k: (usage.get(k) or {}).get("percent") for k in ("rolling", "weekly", "monthly")},
            "peak": {"requests": peak_requests, "surcharge_usd": round(peak_extra, 8),
                     "catalog": catalog_source()},
            "models": {},
        }
        for m, a in agg.items():
            p = PLANS.get(m)
            item = {"cost_usd": round(a["cost"], 8), "requests": a["n"]}
            if p:
                allow = a["cost"] * p["k"]
                cap = p["limit"] * share
                item.update({"monthly_limit": p["limit"], "allowance_usd": round(allow, 8),
                             "window_cap_usd": cap, "used_pct": round(allow / cap * 100, 2)})
            out["models"][m] = item
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    # 窗口进度
    total = (reset - start).total_seconds()
    elapsed = (now - start).total_seconds()
    progress = max(0.0, min(100.0, elapsed / total * 100)) if total else 0

    print(f"窗口：{label}    已过 {progress:.0f}%  ({start.astimezone(local_tz):%m-%d %H:%M} → "
          f"{reset.astimezone(local_tz):%m-%d %H:%M} 北京时间)")
    print(f"记录：{len(rows)} 次请求" + (f"（其中 {peak_requests} 次在高峰时段，已按倍数补算 +${peak_extra:.4f}）"
                                   if peak_requests else "") + "\n")

    items = sorted(agg.items(), key=lambda kv: -kv[1]["cost"])
    if not args.all:
        items = items[:5]

    print(f"{'模型':<24}{'请求':>6}  {'5h/周/月用量':<24}{'占该模型额度'}")
    print("-" * 74)
    for m, a in items:
        p = PLANS.get(m)
        if not p:
            print(f"{m:<24}{a['n']:>6}  {fmt_money(a['cost']):<24}(无限额数据)")
            continue
        allow = a["cost"] * p["k"]
        cap = p["limit"] * share
        pct = allow / cap * 100
        color = "" if pct < 50 else ("  ⚠" if pct < 80 else "  🔴")
        print(f"{m:<24}{a['n']:>6}  {fmt_money(allow):>9} / {fmt_money(cap):<9} "
              f"{bar(pct)} {pct:5.1f}%{color}")

    print()
    acc = {k: (usage.get(k) or {}).get("percent", 0) for k in ("rolling", "weekly", "monthly")}
    print(f"官方全站：5小时 {acc['rolling']}%   本周 {acc['weekly']}%   本月 {acc['monthly']}%")
    print("（全站是所有模型合并；上面是单模型自己的额度）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
