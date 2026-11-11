# TASKS · pi-gui 二开

> **约定（2026-11-11 定）**
>
> 1. 所有活先写进这份台账，再动手。没写进台账的活不开工。
> 2. 每个 task 收尾 = review → test → commit → push → **回写本表状态 + 提交号**。
> 3. 嘴里取消了某个 task，立刻把它标 `取消`，不要留在表里。
> 4. 状态格只写下面五个取值之一；阻塞原因写进同一行的括号里，别另起一行。
>
> | 取值 | 含义 |
> |---|---|
> | 待做 | 还没开始 |
> | 进行中 | 正在做，同一时间最多两条 |
> | 待验证 | 代码完事，等人或 e2e 确认 |
> | 已完成 | 已 commit + push，且 `提交` 行有 commit 号 |
> | 取消 | 决定不做，理由写在括号里 |
>
> 面板规则：`已完成` 没有 commit 号的会标 ⚠️；`进行中` / `待做` 展开，`已完成` 折叠。

---

## 一、进行中与待做

### P0-01 侧栏台账：跨项目总览 + 三态

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | `e48731f` |
| 验收 | 台账顶部能切换项目并显示每个项目的 `进行中/待做` 计数；已完成章节折叠成一行；`取消` 的条目不混进待做 |

- [x] 解析器支持 `已完成` / `取消` 两态与「已完成」章节下的表格行
- [x] 项目选择器（原生 select，只列根工作区，读取上限 12 个）
- [x] 四态分节渲染：进行中 / 待做 展开，已完成 / 已取消 折叠
- [x] core 用例覆盖：跨项目计数、已完成折叠、取消不入待做
- [x] commit + push + 回写本表

### P0-02 面板里自己添加待做条目

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | `7db402b` |
| 验收 | 面板输入标题 → 写进工作区台账（没有就建 `TASKS.md`），插入点在「已完成」章节之前，标题去 markdown 记号并截 120 字 |

- [x] main 侧窄接口 `createTasksBoardTask`（只写 `TASKS.md` / `docs/TASKS.md`，原子写，不接受渲染端字节）
- [x] 面板新增输入行 + 失败提示
- [x] 单测 7 例（插入位置、去记号、截长、建文件、追加到 docs/、空标题拒绝）
- [x] core 用例：面板加一条 → 磁盘上出现在「已完成」之前
- [x] commit + push + 回写本表

### P0-03 「AI 维护状态」工具 `tasks_update`

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | `6abbfd4` |
| 验收 | 工具只接受五个状态；`已完成` 必须带仓库里真实存在的 commit（`git rev-parse --verify`），否则拒绝且不写文件；`取消` 没写阻塞原因时给警告；原子写 |

- [x] `~/.pi/agent/lib/tasks-ledger.ts`：纯逻辑（找 task / 改状态行 / 维护提交行 / 歧义与未知 task 报错 / git 校验）+ 原子写
- [x] `~/.pi/agent/extensions/task-ledger.ts`：注册 `tasks_update({ task, status, commit?, workspace? })`，已确认 pi 能加载并出现在工具列表
- [x] 面板对「已完成 + 有状态格 + 没提交号」的条目打 ⚠️（`## 已完成` 章节的旧表格不算）
- [x] 验证：core 流程 11 项断言全过（含假 sha 被拒、拒绝后文件不变、docs/TASKS.md 也支持）
- [x] commit + push + 回写本表（扩展与 lib 在用户目录，不进本仓库）

---

### P0-04 面板里直接改状态 + 写入乐观锁

| 项 | 内容 |
|---|---|
| 状态 | 待验证 |
| 提交 | — |
| 验收 | 面板每个 task 右侧有状态下拉（五个取值）；`已完成` 在没有提交号时禁用（要用 `tasks_update` 让 agent 带 sha 标完成）；写入前比对 `modifiedAtMs`，别人改过就拒绝且不动文件 |

- [x] 主进程 `updateTasksBoardTaskStatus`：只改状态行，未知/歧义 task 报错，stale read 抛 `ledger-changed`
- [x] `WorkspaceFilePreview.modifiedAtMs` + 新增/改状态两个写接口都带 `expectedModifiedAtMs`
- [x] 面板下拉 + 错误提示；改完自动重读
- [x] 单测 5 例（只改目标行/未知与歧义/stale 拒绝且文件不变/当前读写入/其余字节不变）
- [x] core 用例：下拉从 待做 → 进行中，磁盘与分节同步变化，`已完成` 选项禁用
- [ ] commit + push + 回写本表

## 二、已完成

### P0-00 台账面板 + 输入框上方概况条

| 项 | 内容 |
|---|---|
| 状态 | 已完成 |
| 提交 | `c3e0097`（台账 tab）、`4a07045`（概况条）、`da3b0d6`（用例 + 对齐） |
| 验收 | 右栏 tab 读 `TASKS.md` 并分组；输入框上方显示分支/本轮改动/当前任务；7 条解析单测 + 2 条 core 用例 + 3 条概况条单测全绿 |

| 项 | 结果 |
|---|---|
| 改了什么 | 新增 built-in 工具 `tasks`（`contracts/workbench.ts` 加 kind）；`features/workbench/tasks-board/parse-tasks.ts` 解析台账；`session-overview.tsx` 一行概况；`App.tsx` 抽出 `workbench-tool-panels.tsx`（撞到 1447 行上限） |
| 踩过的坑 | `.gitignore:35` 的 `*-[A-Za-z0-9]{8}.css` 把 `session-overview.css` 吃掉了，改名 `session-strip.css` |
| 已知未修 | `side-panel-picker.spec.ts:11`、`workbench-tabs.spec.ts:187/253` 三条在 clean main 上就红，与本单无关 |
