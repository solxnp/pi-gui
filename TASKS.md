# TASKS · pi-gui 二开

> **约定（2026-11-11 定）**
>
> 1. 所有活先写进这份台账，再动手。没写进台账的活不开工。
> 2. 每个 task 收尾 = review → test → commit → push → **回写本表状态 + 提交号**。
> 3. 嘴里取消了某个 task，立刻把它标 `取消`，不要留在表里。
> 4. 状态格只写下面五个取值之一；阻塞原因写进同一行的括号里，别另起一行。
>
> | 取值   | 含义                                       |
> | ------ | ------------------------------------------ |
> | 待做   | 还没开始                                   |
> | 进行中 | 正在做，同一时间最多两条                   |
> | 待验证 | 代码完事，等人或 e2e 确认                  |
> | 已完成 | 已 commit + push，且 `提交` 行有 commit 号 |
> | 取消   | 决定不做，理由写在括号里                   |
>
> 面板规则：`已完成` 没有 commit 号的会标 ⚠️；`进行中` / `待做` 展开，`已完成` 折叠。

---

## 一、进行中与待做

### P0-01 侧栏台账：跨项目总览 + 三态

| 项   | 内容                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                               |
| 提交 | `e48731f`                                                                                            |
| 验收 | 台账顶部能切换项目并显示每个项目的 `进行中/待做` 计数；已完成章节折叠成一行；`取消` 的条目不混进待做 |

- [x] 解析器支持 `已完成` / `取消` 两态与「已完成」章节下的表格行
- [x] 项目选择器（原生 select，只列根工作区，读取上限 12 个）
- [x] 四态分节渲染：进行中 / 待做 展开，已完成 / 已取消 折叠
- [x] core 用例覆盖：跨项目计数、已完成折叠、取消不入待做
- [x] commit + push + 回写本表

### P0-02 面板里自己添加待做条目

| 项   | 内容                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                            |
| 提交 | `7db402b`                                                                                                         |
| 验收 | 面板输入标题 → 写进工作区台账（没有就建 `TASKS.md`），插入点在「已完成」章节之前，标题去 markdown 记号并截 120 字 |

- [x] main 侧窄接口 `createTasksBoardTask`（只写 `TASKS.md` / `docs/TASKS.md`，原子写，不接受渲染端字节）
- [x] 面板新增输入行 + 失败提示
- [x] 单测 7 例（插入位置、去记号、截长、建文件、追加到 docs/、空标题拒绝）
- [x] core 用例：面板加一条 → 磁盘上出现在「已完成」之前
- [x] commit + push + 回写本表

### P0-03 「AI 维护状态」工具 `tasks_update`

| 项   | 内容                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                                                          |
| 提交 | `6abbfd4`                                                                                                                                       |
| 验收 | 工具只接受五个状态；`已完成` 必须带仓库里真实存在的 commit（`git rev-parse --verify`），否则拒绝且不写文件；`取消` 没写阻塞原因时给警告；原子写 |

- [x] `~/.pi/agent/lib/tasks-ledger.ts`：纯逻辑（找 task / 改状态行 / 维护提交行 / 歧义与未知 task 报错 / git 校验）+ 原子写
- [x] `~/.pi/agent/extensions/task-ledger.ts`：注册 `tasks_update({ task, status, commit?, workspace? })`，已确认 pi 能加载并出现在工具列表
- [x] 面板对「已完成 + 有状态格 + 没提交号」的条目打 ⚠️（`## 已完成` 章节的旧表格不算）
- [x] 验证：core 流程 11 项断言全过（含假 sha 被拒、拒绝后文件不变、docs/TASKS.md 也支持）
- [x] commit + push + 回写本表（扩展与 lib 在用户目录，不进本仓库）

---

### P0-04 面板里直接改状态 + 写入乐观锁

| 项   | 内容                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态 | 已完成                                                                                                                                                                   |
| 提交 | `8f6512a`                                                                                                                                                                |
| 验收 | 面板每个 task 右侧有状态下拉（五个取值）；`已完成` 在没有提交号时禁用（要用 `tasks_update` 让 agent 带 sha 标完成）；写入前比对 `modifiedAtMs`，别人改过就拒绝且不动文件 |

- [x] 主进程 `updateTasksBoardTaskStatus`：只改状态行，未知/歧义 task 报错，stale read 抛 `ledger-changed`
- [x] `WorkspaceFilePreview.modifiedAtMs` + 新增/改状态两个写接口都带 `expectedModifiedAtMs`
- [x] 面板下拉 + 错误提示；改完自动重读
- [x] 单测 5 例（只改目标行/未知与歧义/stale 拒绝且文件不变/当前读写入/其余字节不变）
- [x] core 用例：下拉从 待做 → 进行中，磁盘与分节同步变化，`已完成` 选项禁用
- [x] commit + push + 回写本表

### P0-05 台账文件变化时自动重读

| 项   | 内容                                                              |
| ---- | ----------------------------------------------------------------- |
| 状态 | 已完成                                                            |
| 提交 | `6ddb0e0`                                                         |
| 验收 | 窗口重新获得焦点时重读台账，外部编辑（agent、编辑器）不用手点刷新 |

- [x] `useTasksLedger` 监听 `focus` 重新读文件（不做文件系统监听，只针对这一个路径）
- [x] typecheck / eslint / build / core 用例全过
- [x] commit + push + 回写本表

### P0-06 右栏中文化 + 项目文件/任务管理快捷键

| 项   | 内容                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态 | 已完成                                                                                                                                                       |
| 提交 | `aacf7ac`                                                                                                                                                    |
| 验收 | zh-CN 下右栏全中文（工具选择器、标签页、文件树、Review、终端面板），英文界面文案不变；⌘⇧O 打开「项目文件」、⌘⇧T 打开「任务管理」，选择器与设置页显示对应键位 |

- [x] 右栏 9 个组件的英文文案接进 i18n，`en.ts` + `zh-CN.ts` 各补一份
- [x] 工具名：Files → 项目文件、Tasks → 任务管理（英文侧保持 Files / Tasks）
- [x] `contracts/ipc.ts` 新增 `toggle-files`（⌘⇧O）与 `toggle-tasks`（⌘⇧T），退役未公开的 ⌘⇧O 新会话别名
- [x] 选择器键位、命令面板提示、设置页快捷键表同步
- [x] `renderer-copy.spec.ts` 把右栏目录纳入已翻译面
- [x] e2e 默认固定英文界面语言（`--lang=en-US`），`settings-language` 用 `locale: "system"` 退出
- [x] 验证：typecheck / eslint / prettier / 单测 528 条 / core 用例（changed-files、close-focused-surface、side-panel-picker / side-panel-tab-shortcuts、workbench-tabs、tasks-board、review-scopes / review-ux / review-layout、integrated-terminal、command-palette）
- [x] 真机截图确认：选择器「打开工具／任务管理⇧⌘T／项目文件⇧⌘O／审阅⌘R／终端⌘J」、项目文件面板「筛选文件…」、任务面板「任务管理／项目／添加」、终端「新建终端／重启终端」
- [x] commit + push + 回写本表

### 网络恢复：`terminated` / `Request timed out.` 也算断网

| 项   | 内容                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | 待验证                                                                                                                                                               |
| 提交 | `4a2e3c5`                                                                                                                                                            |
| 验收 | 失败文案为 `terminated`、`Request timed out.`、`The operation was aborted due to timeout` 的 run 会进入等待列表并自动补「继续」；401／429／quota／用户中止仍然不重发 |

- [x] 复核真实失败文案：一天内 251 次 `Connection error.`、59 次 `terminated`、9 次 `Request timed out.`、2 次 429
- [x] `network-error.ts` 按 pi-ai 自己的可重试传输错误补齐（terminated／timed out／connection lost／ended without／reset before headers…），超时判定放在 abort 之前
- [x] 单测补 5 条正例 + 3 条负例（usage limit、Run aborted、AbortError）
- [x] 决策日志：`<userData>/logs/network-resume.log` 记判定／探测／投递／放弃（`4a2e3c5`）
- [ ] 真机确认：断网 → 失败文案 `terminated` 的会话在恢复后自己收到「继续」；日志里能看到 `failure … network=true` → `probe streak=2` → `continue attempt=1`

### 网络恢复：探测节奏改成设置项（改完立即生效）

| 项   | 内容                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | 待验证                                                                                                                                                |
| 提交 | `99948ce`                                                                                                                                             |
| 验收 | 设置 → 网络恢复 能改「探测间隔 / 连续成功几次算恢复 / 失败几次后放弃 / 每个对话最多续跑」，改完下一次探测就按新值跑；启动页、恢复失败页、崩溃页全中文 |

- [x] `probeIntervalMs`（15s/30s/1min/2min，默认 1 分钟）、`consecutiveSuccesses`（1/2/5/10，默认 10）、`giveUpAfterFailedProbes`（10/20/60/一直等，默认 10）进 contracts + 持久化白名单 + IPC 校验
- [x] service 不再用构造函数常量：间隔/连续次数/放弃阈值每次探测现读；`preferencesChanged()` 先清旧定时器再按新间隔重排
- [x] 失败计数：每个条目记 `failedProbes`，一次成功就清零；到达阈值写 `gave-up` 日志并从等待列表移除
- [x] 单测 14 条（设置校验、连续次数即时生效、放弃与清零、日志行）；core 用例 2 条（四个下拉的取值与重启后保持）
- [x] `app/desktop-recovery.tsx` 四段文案进语言包，并加入 `renderer-copy.spec.ts` 的「必须走语言包」清单
- [x] 真机截图（zh-CN）：设置页全中文、崩溃页「出了点问题 / 重试 / 重新打开 pi-gui」
- [ ] 真机确认：真断网一晚 → 日志里 `failure network=true` → `probe streak=10` → `continue attempt=1`

### P0-07 会话改成顶部多行 tab（IDE 式工作集）

| 项   | 内容                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                                                                                                                                                                                                                         |
| 提交 | `2ab556a`（实现）、`a62aa6c`（e2e）                                                                                                                                                                                                                                                                            |
| 验收 | 左侧不再占列：顶栏一行放「新会话/全部会话/定时任务/技能/扩展/设置」，第二行是会话 tab；点「全部会话」浮层里的一条 → 顶部开 tab；tab 最多 3 行、溢出横向滚动、当前 tab 滚入可见；⌘W 关当前 tab、⌘1–9 按 tab 顺序、重启后顺序与当前 tab 不变                                                                     |
| 阻塞 | 仅剩 6 条测试侧问题（应用行为已验证）：`sidebar-recency` 5 条的时间种子被启动重算覆盖（ui-state 与文件 mtime 都试过）、`side-panel-picker` 1 条按旧 ⌘R 语义断言。其余 core 用例（workbench-tabs 6、sidebar-toggle、terminal-diff-layout、integrated-terminal 4、thread-tabs 2、close-focused-surface 2）已全绿 |

### P0-08 终端停靠窗口底部（横跨整宽、高度可拖）

| 项   | 内容                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 状态 | 待验证                                                                                                        |
| 提交 | `0dde783`                                                                                                     |
| 验收 | ⌘J 开合底部终端；终端横跨整个窗口宽度、右栏在它上方结束；拖动上边缘改高度，重启后保持；多开沿用终端标签栏     |
| 阻塞 | `integrated-terminal` / `side-panel-picker` / `workbench-tabs` 等用例仍按「终端是右栏一张 tab」写断言，未迁移 |

### P0-09 终端可见入口 + 面板「收起」

| 项   | 内容                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                                                                |
| 提交 | `50eac2f`                                                                                                                                             |
| 验收 | 不记快捷键也能开终端：顶栏终端按钮（tooltip 显示 ⌘J）、⌘K 命令面板「切换终端」；终端工具栏「收起」隐藏整块面板但不关 shell，再打开时 tab 数与输出都在 |

- [x] 顶栏 actions 加终端 toggle（`topbar.tsx`；`aria-pressed` 跟终端开合、无会话时 disabled）
- [x] 终端工具栏加「收起」按钮（`terminal-panel.tsx` → `onHide`，不触发关 tab）
- [x] ⌘K 面板加「切换终端」条目（`palette-actions.tsx`，复用 `workbench.toggleTool` 文案；`builtin-tools.tsx` 导出 `TERMINAL_TOOL_KIND`）
- [x] 语言包 en + zh-CN 各补 4 条：`topbar.toggleTerminal` / `topbar.hideTerminal` / `topbar.showTerminal` / `terminal.hide`
- [x] 新增 core 用例：顶栏按钮开合、「收起」后 shell 仍在跑、重开输出与 tab 数保持、面板条目切换
- [x] 跑 integrated-terminal / command-palette / thread-tabs 用例 + typecheck（command-palette、navigation 2 条在 clean HEAD 上同红，与本单无关）
- [x] commit + push + 回写本表

### P0-10 会话状态区分不出来：颜色/形状/两处不一致

| 项   | 内容                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                                  |
| 提交 | `fa6f02f`                                                                                                               |
| 验收 | 顶部 tab 条与「全部会话」列表用同一套状态语言；running / 待你读 / 失败 / 待确认 在 100% 缩放下不看 tooltip 也能一眼分开 |

- [x] 现状清点：tab 条 unseen=琥珀 `--warning`（`thread-tabs.css:91`），侧栏行 unseen=accent 蓝（`sidebar.css:675`）；running 在 tab 条是 pulse 实心点、在侧栏是旋转环 → 同一状态两处不同色
- [x] 状态色脱离语法主题：`contracts/theme.ts` 新增 `statusSignals()`，暗/亮各一套固定值（running `#22c55e`/`#15803d`、unseen `#f59e0b`/`#b45309`、failed `#f87171`/`#dc2626`、pending `#a78bfa`/`#7c3aed`）；`tokens.css` 不再从 `--success/--error/--warning` 派生
- [x] 形状区分：running = 空心环 + 呼吸（tab 条与列表一致，删掉原来的旋转环）；unseen / failed = 实心点 + 22% 光环；pending = 文字徽章（改紫色）
- [x] 整块底色：tab 条按 `thread-tabs__tab--{running,unseen,failed,input}` 上 12–20% 状态色底，当前 tab 用 `--main` 做底再混色；列表行按 `data-sidebar-indicator` / `data-pending-approval` 上 12–18% 底 + 标题加重
- [x] 两处统一：`sidebar.css` 的 unseen 从 accent 蓝改成同一枚 `--status-attention`
- [x] 新增 core 用例 `thread-state-visuals.spec.ts`：四种状态各自的 class / 点色（对照 computed `--status-*`）/ 四种底色互不相同 / 换 preset 后状态色不变
- [x] 真机截图（nord dark + 默认亮色）：四种状态的 tab 与列表行底色、点、徽章都能分辨
- [x] 验证：typecheck / eslint / prettier / unit 548 条；core `thread-state-visuals`、`thread-tabs` 2、`terminal-entry-points` 全绿
- [x] 已知红（与本单无关，clean HEAD 同红）：`notifications` 5、`stop-running-prompt` 3、`thread-menu` 2 —— 都在断言 `.session-row`，而列表现在只在「全部会话」浮层里 DOM 才存在

### P0-11 tab 条为凑行数丢掉半行空间

| 项   | 内容                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                             |
| 提交 | `4eff5f7`                                                                                          |
| 验收 | 窗口够宽时 tab 一行排满再换行：1480px 窗口 7 个 tab 读作 6 + 1（原为 4 + 3），1900px 读作一行 7 个 |

- [x] `threadTabLayout` 不再用 `ceil(count / rows)` 摊平列数，行数 ≤ 3 时列数 = 每行容量
- [x] 超过三行容量（count > 每行容量 × 3）才扩列，让 tab 条横向滚动而不是继续长高
- [x] 新增单测 `thread-tabs-layout.spec.ts`（7 / 12 / 18 / 19 个 tab、窄条、槽位顺序）
- [x] 实测：1480 宽 → 每行 6/1；1900 宽 → 一行 7 个；1100 宽 → 3/3/1

## 二、已完成

### P0-00 台账面板 + 输入框上方概况条

| 项   | 内容                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                                  |
| 提交 | `c3e0097`（台账 tab）、`4a07045`（概况条）、`da3b0d6`（用例 + 对齐）                                                    |
| 验收 | 右栏 tab 读 `TASKS.md` 并分组；输入框上方显示分支/本轮改动/当前任务；7 条解析单测 + 2 条 core 用例 + 3 条概况条单测全绿 |

| 项       | 结果                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 改了什么 | 新增 built-in 工具 `tasks`（`contracts/workbench.ts` 加 kind）；`features/workbench/tasks-board/parse-tasks.ts` 解析台账；`session-overview.tsx` 一行概况；`App.tsx` 抽出 `workbench-tool-panels.tsx`（撞到 1447 行上限） |
| 踩过的坑 | `.gitignore:35` 的 `*-[A-Za-z0-9]{8}.css` 把 `session-overview.css` 吃掉了，改名 `session-strip.css`                                                                                                                      |
| 已知未修 | `side-panel-picker.spec.ts:11`、`workbench-tabs.spec.ts:187/253` 三条在 clean main 上就红，与本单无关                                                                                                                     |

### ask_user 已答卡：去掉重复的「用户的回答」条，备注留在板上

| 项   | 内容                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                       |
| 提交 | `ecb93c3`                                                                                    |
| 验收 | 答完的卡上只留整张题面（选项 + 已选 ● + 备注那栏回显备注），下面不再有 `用户的回答：` 灰色条 |

- [x] `extension-card.tsx`：有 `answeredForm` 时丢掉 `rows`（老条目没有题面才走 rows 兜底），删掉 `extension-card__answers` / `answers-label` 样式与两条 `extensionForm.answerLabel` 文案
- [x] 顺手修掉同文件里已红的用例选择器：`--lang=en-US` 之后「其他」是 `Other — write my own`，改成 `/^(其他|Other)/`
- [x] core 用例 5 条全绿 + typecheck + prettier；真机截图确认（题面 / ● / 备注回显，无重复条）

### 待答卡按对话宽度、不自己滚（ask_user 别再像弹窗）

| 项   | 内容                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态 | 已完成                                                                                                                                                         |
| 提交 | `6bbfd55`（样式 / `alignTop()` / 挂载）、`16ba250`（用例断言）                                                                                                 |
| 验收 | 待答卡宽度等于 transcript 那一列（768px）而不是整个对话区；卡内没有自己的滚动条，指针停在卡上滚轮滚的是对话；卡片比 pane 高时出现即对齐顶边，第 1 个问题先入眼 |

- [x] `.timeline-pending-form` 加 `max-width: var(--transcript-measure, 768px)` + 居中 + 上边距
- [x] `.extension-form` / `__body` 删掉 `max-height`、`overflow`、`overscroll-behavior: contain`（滚动陷阱的来源）
- [x] `use-timeline-viewport.ts` 新增 `alignTop()`：高位卡出现时对齐顶边，且把这次 scrollTop 登记成自己滚的（不翻成阅读态、不弹 New activity）
- [x] 用例第 3 条改成「卡片长在对话里」：无内部滚动、宽度差 < 2px、第 1 个问题在视口、提交按钮滚过去可点
- [x] 验证：extension-form-card 5 条 + timeline-pinning / timeline-viewport / timeline-overflow 共 23 条全绿；真机截图 + 滚轮实测（指针在卡上滚轮，`pane.scrollTop` 变化）
- [!] 踩坑：这几处改动被并行会话的 `6bbfd55`（顶部 tab 条）一起提交了，本单只剩用例断言
