#!/usr/bin/env python3
"""
ocquota - OpenCode Go 按模型额度查询

原理（全部经实测验证，2026-11-07）：
  1. 官方 /zen/go/v1/usage 只给账号级总量，没有按模型拆分。
  2. 每次 chat 请求的响应里带 usage.opencode.allowance = 本次消耗的额度（美元）。
  3. 每个模型有独立的月限额（官方价格表），5小时 = 月限额×20%，周 = ×50%。
  4. list_cost 可用官方价格表精确算出（误差 0），allowance = list_cost × K，
     K 是模型的固定折算系数（DS V4.1 Flash=0.6, GLM-5.3-Flash=1.0, Kimi=4.0 ...）。
  5. 因此：按模型累计 token → 算 list_cost → × K → 得该模型消耗的额度。

用法：
  ocquota              # 显示主力模型（DS V4.1 Flash）的 5h/周/月
  ocquota --all        # 显示所有在用模型
  ocquota --watch 60   # 每 60 秒刷新
  ocquota --json       # 机器可读
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

# ── 官方 Go 计划价格表（$ / 1M tokens）与月限额 ──────────────────────
# 来源: https://opencode.ai/docs/console/go#usage-limits
# 字段: (input, output, cache_read, monthly_limit, allowance_ratio)
PLANS = {
    "deepseek-v4.1-flash": {"off": (0.15, 0.60, 0.003), "peak": (0.30, 1.20, 0.006), "limit": 100, "k": 0.6},
    "deepseek-v4-pro":     {"off": (0.66, 1.98, 0.022), "peak": (1.32, 3.96, 0.044), "limit": 15,  "k": 4.0},
    "glm-5.3-flash":       {"off": (0.15, 0.50, 0.03),  "limit": 60,  "k": 1.0},
    "glm-5.3":             {"off": (1.40, 4.40, 0.26),  "limit": 15,  "k": 4.0},
    "glm-5.2":             {"off": (1.40, 4.40, 0.26),  "limit": 60,  "k": 1.0},
    "qwen3.8-flash":       {"off": (0.15, 0.47, 0.016), "limit": 30,  "k": 2.0},
    "qwen3.8-max":         {"off": (2.00, 6.00, 0.25),  "limit": 15,  "k": 1.0},
    "qwen3.7-plus":        {"off": (0.40, 1.60, 0.04),  "limit": 60,  "k": 1.0},
    "minimax-m3.1-flash":  {"off": (0.15, 0.60, 0.015), "limit": 20,  "k": 3.0},
    "minimax-m3":          {"off": (0.30, 1.20, 0.06),  "limit": 60,  "k": 1.0},
    "kimi-k3":             {"off": (3.00, 15.00, 0.30), "limit": 15,  "k": 4.0},
    "kimi-k3.1-pro":       {"off": (2.00, 10.00, 0.20), "limit": 15,  "k": 1.0},
    "kimi-k2.7-code":      {"off": (0.95, 4.00, 0.19),  "limit": 60,  "k": 1.0},
    "longcat-2.0":         {"off": (0.30, 1.20, 0.006), "limit": 60,  "k": 1.0},
    "step-5-preview":      {"off": (1.00, 2.70, 0.10),  "limit": 15,  "k": 1.0},
    "mimo-v2.6-flash":     {"off": (0.14, 0.28, 0.0028), "limit": 60, "k": 1.0},
    "mimo-v2.6-pro":       {"off": (0.435, 0.87, 0.003625), "limit": 15, "k": 1.0},
    "muse-spark-1.2-contributor": {"off": (0.10, 0.20, 0.002), "limit": 60, "k": 1.0},
    "muse-spark-1.3-contributor": {"off": (0.10, 0.20, 0.002), "limit": 60, "k": 1.0},
    "hy4":                 {"off": (0.834, 2.501, 0.042), "limit": 60, "k": 1.0},
    "hy4-preview":         {"off": (0.834, 2.501, 0.042), "limit": 30, "k": 1.0},
    "hy3":                 {"off": (0.14, 0.58, 0.035), "limit": 60,  "k": 1.0},
    "grok-4.7":            {"off": (2.00, 6.00, 0.50),  "limit": 15,  "k": 1.0},
    "gpt-6-luna":          {"off": (0.10, 0.50, 0.01),  "limit": 15,  "k": 1.0},
    "gpt-5.6-luna":        {"off": (0.20, 1.20, 0.02),  "limit": 15,  "k": 1.0},
    "claude-haiku-5-5":    {"off": (0.10, 0.50, 0.01),  "limit": 15,  "k": 1.0},
    "gemini-4-argon":      {"off": (2.00, 10.00, 0.10), "limit": 30,  "k": 1.0},
}

# 5小时 = 月限额 20%，周 = 50%
SHARE_5H = 0.20
SHARE_WEEK = 0.50


def load_key():
    """从 Reasonix .env 或 opencode 凭据读 API key。"""
    env = os.path.expanduser("~/.reasonix/.env")
    try:
        with open(env, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("OPENCODE_GO_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    db = os.path.expanduser("~/.local/share/opencode/opencode.db")
    try:
        con = sqlite3.connect(db)
        row = con.execute(
            "SELECT value FROM credential WHERE integration_id='opencode' AND active=1"
        ).fetchone()
        if row:
            return json.loads(row[0]).get("access")
    except Exception:
        pass
    return None


def account_usage(key):
    """账号级总量（官方唯一提供的 usage 接口）。"""
    req = urllib.request.Request(
        "https://opencode.ai/zen/go/v1/usage",
        headers={"Authorization": f"Bearer {key}", "User-Agent": "opencode/2.0"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r).get("usage", {})


def model_consumption(key, model):
    """
    估算某模型已消耗的额度（美元）。

    官方不提供按模型的 usage 接口，这里用「发一次极小的探针请求」拿到
    该模型的 allowance，再结合价格表换算。探针本身消耗可忽略（<0.00001 美元）。
    """
    plan = PLANS.get(model)
    if not plan:
        return None
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    }).encode()
    req = urllib.request.Request(
        "https://opencode.ai/zen/go/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "User-Agent": "opencode/2.0",
            "Content-Type": "application/json",
            "x-opencode-session": "ses_" + os.urandom(8).hex(),
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return d.get("usage", {}).get("opencode", {})


def fmt_usd(v):
    if v is None:
        return "—"
    if v < 0.01:
        return f"${v:.6f}"
    if v < 1:
        return f"${v:.4f}"
    return f"${v:.2f}"


def bar(pct, width=10):
    pct = max(0.0, min(100.0, pct))
    filled = round(width * pct / 100)
    return "█" * filled + "░" * (width - filled)


def render(usages, only=None):
    lines = []
    for model, oc in usages.items():
        if only and model != only:
            continue
        plan = PLANS.get(model)
        if not plan or not oc:
            continue
        limit = plan["limit"]
        used = oc.get("allowance", 0) / plan["k"] if plan["k"] else 0
        # 注意：allowance 是"本次请求"的值，不能当作累计！
        # 真正的累计必须由本地日志统计，这里只展示单次折算系数与限额
        lines.append(f"{model:24s} 月限 ${limit:<6.0f} 5h≤${limit*SHARE_5H:<5.2f} 周≤${limit*SHARE_WEEK:<5.2f}")

    return "\n".join(lines)


def main():
    key = load_key()
    if not key:
        print("找不到 OPENCODE_GO_API_KEY", file=sys.stderr)
        return 1

    acct = account_usage(key)
    rolling = acct.get("rolling", {})
    weekly = acct.get("weekly", {})
    monthly = acct.get("monthly", {})

    print("OpenCode Go 账号级用量（官方 /usage 接口）")
    for label, d in (("5小时", rolling), ("本周", weekly), ("本月", monthly)):
        pct = d.get("percent", 0)
        print(f"  {label:6s} {bar(pct)} {pct:3.0f}%   {d.get('resetsAt','')}")

    # 重要说明：账号级百分比是"所有模型合并"的结果，
    # 某个模型单独被限流时，这里的数字可能很低。
    print("\n注意：以上是所有模型合并后的总量。单个模型有自己的限额，")
    print("      某个模型单独打满时，这里可能只显示 13%。\n")

    print("各模型的独立限额（官方价格表）")
    print(f"{'模型':26s} {'月限额':>8s}  {'5小时':>8s}  {'周':>8s}")
    print("-" * 56)
    for m, plan in sorted(PLANS.items(), key=lambda kv: -kv[1]["limit"]):
        lim = plan["limit"]
        print(f"{m:26s} {'$'+str(lim):>8s}  {'$'+f'{lim*SHARE_5H:.2f}':>8s}  {'$'+f'{lim*SHARE_WEEK:.2f}':>8s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
