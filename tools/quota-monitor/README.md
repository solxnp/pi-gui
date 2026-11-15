# 额度监测（菜单栏）

macOS 菜单栏小工具，一处看两个订阅的额度水位：**Command Code**（当前优先使用）和 **OpenCode Go**（备用）。

左键点图标 → 弹出面板，右键 → 菜单（立即刷新 / 隐藏图标 / 退出）。图标颜色随更紧的那个 5 小时水位变化：绿 <50%、橙 <80%、红 ≥80%。

## 面板读法

```
COMMAND CODE（先扣这个）
5小时   █▁▁▁▁▁  $0.13 / $3       ← 用完这段时间就切到别处
本周    █▁▁▁▁▁  $0.13 / $6
本月    ▁▁▁▁▁▁  $0.13 / $10
5小时重置 11-15 00:22 北京时间
────────────────────────────────
OPENCODE GO
5小时   5%    本周 97%    本月 83%
单模型 · 5小时
  DS V4.1 Flash            3.2%
  GLM-5.3                  1.1%
```

- **Command Code 是精确值**：直接读官方额度接口，三行分别对应它自己的 5 小时窗口、周窗口、月度 credit。
- **OpenCode Go 是账号合计 + 单模型明细**：合计来自官方 `/usage`，单模型由 `ocstats.py` 扫本地会话日志推算（官方没有按模型的口径）。

## 数据来源

| 提供商       | 接口                                                   | 说明                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command Code | `GET https://api.commandcode.ai/alpha/billing/credits` | `credits.monthlyCredits` 是**剩余** credit；`windowLimits.fiveHour/weekly` 给 `used`/`cap`/`resetAt`（毫秒）                                                                                  |
| Command Code | `GET https://api.commandcode.ai/alpha/usage/summary`   | `totalCost` = 本账期已花；月度上限 = 剩余 + 已花，所以换成 GOAT/Max 也不用改代码                                                                                                              |
| OpenCode Go  | `GET https://opencode.ai/zen/go/v1/usage`              | `rolling` / `weekly` / `monthly` 的 `percent` + `resetsAt`                                                                                                                                    |
| OpenCode Go  | 本地 `ocstats.py`                                      | 扫 Reasonix 的 `events.jsonl` / `wire.jsonl`，按模型归属 `costUsd`，再按 5 小时窗口汇总                                                                                                       |
| Command Code | 本地 `ccstats.py` + `cc-prices.json`                   | 扫 pi 会话日志（`~/.pi/agent/sessions/**/*.jsonl`）里 `provider=commandcode` 的 assistant 记录，token × 官方单价（从 command-code CLI 内嵌模型目录抽出）算出每个模型在当前 5 小时窗口花了多少 |

**Command Code 服务端没有「按模型」的用量接口**，单模型那行是本地估算：pi 会话日志 × 官方单价。两个已知边界：

- 只统计**经 pi** 的调用，你在 command-code CLI 里直接用掉的不在里面
- CC 的 5 小时 / 周限额是**整池**（Go 套餐 $3 / $6），不是每模型独立上限；所以这里显示的是「这个模型占了这个窗口多少」，不是「它自己的上限」

`cc-prices.json` 是从 `command-code` npm 包里内嵌的模型目录抽的（`pricing.inputCost/outputCost/cacheReadCost`，$/1M tokens）。CLI 升级后可以重新抽一次。

### 凭据位置

- Command Code：`~/.pi/agent/auth.json` 的 `commandcode.key`（pi 的凭据文件，已被它的 `.gitignore` 排除）
- OpenCode Go：`~/.reasonix/.env` 的 `OPENCODE_GO_API_KEY`

两个文件都只在本机读，工具不上传任何东西。

## 构建与安装

```bash
cd tools/quota-monitor
./build.sh                     # 产物：build/OCQuota.app
build/OCQuota.app/Contents/MacOS/OCQuota --selftest    # 只打印两家额度，不开窗口
./install.sh                   # 停旧实例 → 备份 → 替换 ~/Applications/OCQuota.app（不自动启动）
```

`ocstats.py` 的位置按以下顺序找，第一个存在的就用：`UserDefaults` 的 `statsScript` → 本目录 → 旧的 `~/.reasonix/global-workspace/`。

开机自启由 launchd 管：`com.solxnp.ocquota.plist` → `~/Library/LaunchAgents/local.ocquota.plist`。

## 从 Reasonix 工作目录搬过来时的差异

- 源码原来散在 `~/.reasonix/global-workspace/`（不是 git 仓库，无版本管理），现集中到本目录
- `main.swift` 重写为「按提供商区块渲染」：加第三个订阅只要往 `renderBlocks()` 里再 append 一块
- 面板高度改成按内容算（`preferredHeight`），不再写死 306pt
- 新增 `--selftest`：不开 UI，直接打印两家解析结果，排障用
- 旧目录里的 `ocquota.py` / `ocstats.py` / 编译产物仍在原处，装好新版确认无误后可自行删除
