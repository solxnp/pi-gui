#!/usr/bin/env python3
"""
ccstats —— 按模型统计 Command Code 在「当前 5 小时窗口」里花了多少

为什么需要它：
  官方只给整池额度（`/alpha/billing/credits` 的 used / cap），没有「按模型」的口径。
  但 pi 的会话日志里每条 assistant 消息都带 provider / model / usage，配上官方
  每个模型的价格（cc-prices.json，从 command-code CLI 的内嵌模型目录里抽出来的），
  就能算出「哪个模型在这个窗口里花了多少」。

数据来源：
  ~/.pi/agent/sessions/**/*.jsonl  →  message.role=assistant 且 provider=commandcode
                                     取 usage.{input,output,cacheRead}（input 已排除缓存部分）
  同目录 cc-prices.json            → 每 1M tokens 的 input / output / cache_read 单价

注意：
  - 只统计「经 pi 调用」的花费。你在 command-code CLI 里直接用掉的部分这里看不到。
  - CC 的 5 小时 / 周限额是**整池**（Go 3/6 credits、GOAT 14/35、Pro 16/40），
    不是每模型独立；所以这里输出的是「某个模型占了这个窗口多少」，
    不是「某个模型自己的上限」。
  - 本脚本输出的 used_usd 是**估算的美元**，而上限是 **credits**，两个单位不能相除。
    面板因此只显示金额、不画进度条。

用法：
  ccstats                         # 主窗口，人类可读
  ccstats --json                  # 机器可读（菜单栏 app 用这个）
  ccstats --reset-at 1794673332584    # 复用已有接口给的窗口重置时间（毫秒），省一次网络
"""
import argparse
import datetime
import glob
import json
import os
import sys

AGENT_DIR = os.path.expanduser("~/.pi/agent")
HERE = os.path.dirname(os.path.abspath(__file__))
PRICES_PATH = os.path.join(HERE, "cc-prices.json")
WINDOW_SECONDS = 5 * 3600


def load_prices():
    with open(PRICES_PATH, encoding="utf-8") as f:
        return json.load(f)


def window_reset_ms_from_api():
    """问一次官方接口要 5 小时窗口的重置时间（毫秒）。"""
    import urllib.request

    auth = os.path.join(AGENT_DIR, "auth.json")
    with open(auth, encoding="utf-8") as f:
        key = json.load(f)["commandcode"]["key"]
    req = urllib.request.Request(
        "https://api.commandcode.ai/alpha/billing/credits",
        headers={
            "Authorization": f"Bearer {key}",
            "User-Agent": "cli",
            "x-command-code-version": "1.89.1",
            "x-cli-surface": "cli",
            "x-cli-environment": "cli",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        root = json.load(r)
    return (root.get("windowLimits") or {}).get("fiveHour", {}).get("resetAt")


def iter_assistant_messages(since_ms):
    """遍历 pi 会话日志里的 commandcode assistant 消息。"""
    pattern = os.path.join(AGENT_DIR, "sessions", "*", "*.jsonl")
    for path in glob.glob(pattern):
        try:
            fh = open(path, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                # 便宜的预筛：99% 的行不含这个串，省掉 json.loads
                if '"commandcode"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                msg = entry.get("message")
                if not isinstance(msg, dict) or msg.get("role") != "assistant":
                    continue
                if msg.get("provider") != "commandcode":
                    continue
                ts = entry.get("timestamp") or ""
                ms = parse_iso_ms(ts)
                if ms is None or ms < since_ms:
                    continue
                yield ms, msg


def parse_iso_ms(value):
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        return int(datetime.datetime.fromisoformat(text).timestamp() * 1000)
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    ap.add_argument("--reset-at", type=float, default=None,
                    help="5 小时窗口的重置时间（毫秒），省掉一次网络请求")
    args = ap.parse_args()

    prices = load_prices()

    reset_ms = args.reset_at
    if not reset_ms:
        try:
            reset_ms = window_reset_ms_from_api()
        except Exception as exc:  # 拿不到就用「现在往前 5 小时」兜底
            print(f"警告：取窗口失败（{exc}），按当前时间往前 5 小时计算", file=sys.stderr)
            reset_ms = None

    if reset_ms:
        start_ms = reset_ms - WINDOW_SECONDS * 1000
    else:
        start_ms = int(datetime.datetime.now().timestamp() * 1000) - WINDOW_SECONDS * 1000

    per_model = {}
    for _ts, msg in iter_assistant_messages(start_ms):
        model = str(msg.get("model") or "")
        usage = msg.get("usage") or {}
        price = prices.get(model)
        if not price:
            continue
        tokens_in = float(usage.get("input") or 0)
        tokens_out = float(usage.get("output") or 0)
        tokens_cache = float(usage.get("cacheRead") or 0)
        cost = (
            tokens_in / 1_000_000 * price["in"]
            + tokens_out / 1_000_000 * price["out"]
            + tokens_cache / 1_000_000 * price["cache_read"]
        )
        slot = per_model.setdefault(model, {"used_usd": 0.0, "calls": 0,
                                            "tokens_in": 0.0, "tokens_out": 0.0,
                                            "tokens_cache": 0.0})
        slot["used_usd"] += cost
        slot["calls"] += 1
        slot["tokens_in"] += tokens_in
        slot["tokens_out"] += tokens_out
        slot["tokens_cache"] += tokens_cache

    for slot in per_model.values():
        for k in ("used_usd", "tokens_in", "tokens_out", "tokens_cache"):
            slot[k] = round(slot[k], 6)

    payload = {
        "window_start_utc": iso(int(start_ms)),
        "window_reset_utc": iso(int(reset_ms)) if reset_ms else "",
        "models": per_model,
        "source": "pi session log + cc-prices.json（只统计经 pi 的调用）",
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    if not per_model:
        print("当前 5 小时窗口内没有经 pi 的 Command Code 调用")
        return 0
    print(f"窗口 {payload['window_start_utc']} → {payload['window_reset_utc']}")
    print(f"{'模型':28s} {'花费':>10s} {'调用':>5s}")
    for model, slot in sorted(per_model.items(), key=lambda kv: -kv[1]["used_usd"]):
        print(f"{model:28s} {'$%.4f' % slot['used_usd']:>10s} {slot['calls']:>5d}")
    return 0


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    sys.exit(main())
