import Cocoa
import Carbon

func log(_ msg: String) {
    let path = NSString(string: "~/Library/Logs/OCQuota.log").expandingTildeInPath
    let line = "[\(Date())] \(msg)\n"
    if let h = FileHandle(forWritingAtPath: path) {
        h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); h.closeFile()
    } else {
        try? line.write(toFile: path, atomically: true, encoding: .utf8)
    }
}

// MARK: - 数据模型

struct AccountUsage {
    var rollingPct = 0
    var weeklyPct = 0
    var monthlyPct = 0
    var resetText = ""
    /// 原始 resetsAt（ISO8601），传给 ocstats 以省掉重复网络请求
    var resetAtRaw = ""
}

struct ModelUsage {
    var model: String
    var usedUSD: Double
    var capUSD: Double
    var pct: Double
    /// 右侧文案，留空时画百分比
    var valueText: String = ""
}

/// Command Code 的额度（全部是美元 credit 单位）
struct CCUsage {
    var fiveUsed: Double = 0
    var fiveCap: Double = 0
    var weekUsed: Double = 0
    var weekCap: Double = 0
    var monthUsed: Double = 0
    var monthCap: Double = 0
    var fiveReset: String = ""
    /// 5 小时窗口重置时间（毫秒），传给 ccstats 以省一次网络请求
    var fiveResetMs: Double = 0
    /// 套餐标识，用来定月度总额（individual-go-v1 等）
    var planId: String = ""
}

/// Command Code 单模型在 5 小时窗口里的花费
struct CCModelSpend {
    var model: String
    var usd: Double
    var calls: Int
}

/// 一行进度条：百分比 + 右侧说明（比如 `$0.13 / $3`）
struct QuotaRow {
    var label: String
    var pct: Double
    var valueText: String
}

/// 一个提供商的一整块：标题 + 若干行 + 可选的单模型明细
struct ProviderBlock {
    var title: String
    var rows: [QuotaRow]
    /// 单模型明细（目前只有 OpenCode Go 能拿到）
    var models: [ModelUsage] = []
    var modelsTitle: String = ""
    var footnotes: [String] = []
}

// MARK: - 绘制

final class QuotaView: NSView {
    /// 顺序就是面板里的显示顺序：Command Code 在前（当前优先用它），OpenCode Go 在后
    var providers: [ProviderBlock] = []
    var errorText: String?
    var resetText: String = ""

    override var isFlipped: Bool { true }

    // 版式常量（画和算高度共用一份，避免两处漂移）
    private let pad: CGFloat = 14
    private let titleFont = NSFont.systemFont(ofSize: 9, weight: .semibold)
    private let labelFont = NSFont.systemFont(ofSize: 11.5, weight: .regular)
    private let smallFont = NSFont.systemFont(ofSize: 10, weight: .medium)
    private let valueFont = NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .semibold)
    private let footFont = NSFont.systemFont(ofSize: 9.5)
    private let rowHeight: CGFloat = 22
    private let modelRowHeight: CGFloat = 27

    /// 内容需要的高度，让面板跟着内容伸缩，避免写死高度后被裁掉
    var preferredHeight: CGFloat {
        var h: CGFloat = pad + 12          // 顶部内边距
        if errorText != nil { return h + 20 + pad }
        for (index, block) in providers.enumerated() {
            if index > 0 { h += 11 }       // 分隔线占位
            h += 15                        // 区块标题
            h += CGFloat(block.rows.count) * rowHeight
            if !block.models.isEmpty {
                h += 4 + 15 + 1            // 间隔 + 小标题
                h += CGFloat(min(block.models.count, 3)) * modelRowHeight
            }
            h += CGFloat(block.footnotes.count) * 13
        }
        if !resetText.isEmpty { h += 15 }
        return h + pad
    }

    override func draw(_ dirtyRect: NSRect) {
        let bg = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        NSColor(calibratedWhite: 0.10, alpha: 0.98).setFill()
        bg.fill()
        NSColor(calibratedWhite: 1.0, alpha: 0.13).setStroke()
        bg.lineWidth = 1
        bg.stroke()

        let faint = NSColor(calibratedWhite: 1, alpha: 0.40)
        let labelColor = NSColor(calibratedWhite: 1, alpha: 0.82)
        let subColor = NSColor(calibratedWhite: 1, alpha: 0.42)

        var y: CGFloat = pad + 4

        if let e = errorText {
            e.draw(at: NSPoint(x: pad, y: y),
                   withAttributes: [.font: labelFont, .foregroundColor: NSColor.systemRed])
            return
        }

        if providers.isEmpty {
            "加载中…".draw(at: NSPoint(x: pad, y: y),
                          withAttributes: [.font: labelFont,
                                           .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.5)])
            return
        }

        for (index, block) in providers.enumerated() {
            if index > 0 {
                NSColor(calibratedWhite: 1, alpha: 0.09).setFill()
                NSRect(x: pad, y: y + 4, width: bounds.width - pad * 2, height: 1).fill()
                y += 11
            }

            block.title.draw(at: NSPoint(x: pad, y: y),
                             withAttributes: [.font: titleFont, .foregroundColor: faint])
            y += 15

            for row in block.rows {
                drawRow(row, y: &y, labelColor: labelColor)
            }

            if !block.models.isEmpty {
                y += 4
                block.modelsTitle.draw(at: NSPoint(x: pad, y: y),
                                       withAttributes: [.font: smallFont, .foregroundColor: subColor])
                y += 15
                for m in block.models.prefix(3) {
                    drawModelRow(m, y: &y, labelColor: labelColor)
                }
            }

            for note in block.footnotes {
                note.draw(at: NSPoint(x: pad, y: y),
                          withAttributes: [.font: footFont,
                                           .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.36)])
                y += 13
            }
        }

        if !resetText.isEmpty {
            resetText.draw(at: NSPoint(x: pad, y: y + 2),
                           withAttributes: [.font: footFont,
                                            .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.36)])
        }
    }

    static func prettyName(_ raw: String) -> String {
        let map = [
            "deepseek-v4.1-flash": "DS V4.1 Flash",
            "deepseek-v4-pro": "DS V4 Pro",
            "glm-5.3-flash": "GLM-5.3-Flash",
            "glm-5.3": "GLM-5.3",
            "glm-5.2": "GLM-5.2",
            "longcat-2.0": "LongCat-2.0",
            "kimi-k3": "Kimi K3",
            "kimi-k3.1-pro": "Kimi K3.1 Pro",
            "kimi-k2.7-code": "Kimi K2.7 Code",
            "minimax-m3.1-flash": "MiniMax M3.1F",
            "minimax-m3": "MiniMax M3",
            "qwen3.8-flash": "Qwen3.8 Flash",
            "qwen3.8-max": "Qwen3.8 Max",
            "qwen3.7-plus": "Qwen3.7 Plus",
            "mimo-v2.6-flash": "MiMo V2.6F",
            "mimo-v2.6-pro": "MiMo V2.6 Pro",
            "gpt-6-luna": "GPT 6 Luna",
            "gpt-5.6-luna": "GPT 5.6 Luna",
            "claude-haiku-5-5": "Claude Haiku 5.5",
            "gemini-4-argon": "Gemini 4 Argon",
            "grok-4.7": "Grok 4.7",
            "hy4": "Hy4",
            "hy4-preview": "Hy4 preview",
            "hy3": "Hy3",
            "step-5-preview": "Step 5 Preview",
        ]
        if let pretty = map[raw] { return pretty }
        return prettyCommandCodeName(raw)
    }

    /// `deepseek-deepseek-v4-flash` → `DS V4 Flash`，`zai-org-glm-5.3` → `GLM-5.3`
    static func prettyCommandCodeName(_ raw: String) -> String {
        let prefixes = ["thinkingmachines-", "inclusionai-", "moonshotai-", "minimaxai-",
                        "stepfun-", "tencent-", "meituan-", "mistral-", "nvidia-",
                        "ornith-", "xiaomi-", "zai-org-", "z-ai-", "qwen-", "xai-",
                        "meta-", "stealth-", "deepseek-", "gpt-"]
        var name = raw
        for prefix in prefixes where name.hasPrefix(prefix) {
            name = String(name.dropFirst(prefix.count))
            break
        }
        let display: [String: String] = [
            "deepseek-v4.1-flash": "DS V4.1 Flash",
            "deepseek-v4.1-flash-fast": "DS V4.1 Flash Fast",
            "deepseek-v4-flash": "DS V4 Flash",
            "deepseek-v4-flash-fast": "DS V4 Flash Fast",
            "deepseek-v4-pro": "DS V4 Pro",
            "glm-5.3": "GLM-5.3",
            "glm-5.3-flash": "GLM-5.3 Flash",
            "glm-5.3-flashx": "GLM-5.3 FlashX",
            "glm-5.2": "GLM-5.2",
            "glm-5.2-fast": "GLM-5.2 Fast",
            "qwen3.8-flash": "Qwen3.8 Flash",
            "qwen3.8-max": "Qwen3.8 Max",
            "qwen3.8-max-0902": "Qwen3.8 Max 0902",
            "kimi-k2.7-code": "Kimi K2.7 Code",
            "kimi-k3": "Kimi K3",
            "kimi-k3.1-pro": "Kimi K3.1 Pro",
            "minimax-m3.1-flash": "MiniMax M3.1 Flash",
            "minimax-m3": "MiniMax M3",
            "mimo-v2.6-flash": "MiMo V2.6 Flash",
            "mimo-v2.6-pro": "MiMo V2.6 Pro",
            "step-5-preview": "Step 5 Preview",
            "step-3.7-flash": "Step 3.7 Flash",
            "longcat-2.0": "LongCat 2.0",
            "ling-3.1-flash": "Ling 3.1 Flash",
            "hy4-preview": "Hy4 Preview",
            "hy3-paid": "Hy3",
            "grok-4.5": "Grok 4.5",
            "muse-spark-open": "Muse Spark Open",
            "5.6-luna": "GPT-5.6 Luna",
            "6-luna": "GPT-6 Luna",
        ]
        return display[name] ?? name
    }

    /// 参考条 + 百分比 + 右侧金额
    private func drawRow(_ row: QuotaRow, y: inout CGFloat, labelColor: NSColor) {
        let pct = Int(row.pct.rounded())
        let color = Self.waterColor(pct)

        row.label.draw(at: NSPoint(x: pad, y: y),
                       withAttributes: [.font: labelFont, .foregroundColor: labelColor])

        let barX: CGFloat = pad + 54
        let barW: CGFloat = 86
        let barY = y + 6
        NSColor(calibratedWhite: 1, alpha: 0.13).setFill()
        NSBezierPath(roundedRect: NSRect(x: barX, y: barY, width: barW, height: 5),
                     xRadius: 2.5, yRadius: 2.5).fill()
        let filled = max(2, barW * CGFloat(min(max(row.pct, 0), 100)) / 100.0)
        color.setFill()
        NSBezierPath(roundedRect: NSRect(x: barX, y: barY, width: filled, height: 5),
                     xRadius: 2.5, yRadius: 2.5).fill()

        let right = row.valueText.isEmpty ? Self.pctText(row.pct) : row.valueText
        let size = right.size(withAttributes: [.font: valueFont])
        right.draw(at: NSPoint(x: bounds.width - pad - size.width, y: y - 1),
                   withAttributes: [.font: valueFont, .foregroundColor: color])
        y += rowHeight
    }

    private func drawModelRow(_ m: ModelUsage, y: inout CGFloat, labelColor: NSColor) {
        let color = Self.waterColor(Int(m.pct.rounded()))
        Self.prettyName(m.model).draw(at: NSPoint(x: pad, y: y),
                                      withAttributes: [.font: labelFont, .foregroundColor: labelColor])

        let txt = m.valueText.isEmpty ? Self.pctText(m.pct) : m.valueText
        let sz = txt.size(withAttributes: [.font: valueFont])
        txt.draw(at: NSPoint(x: bounds.width - pad - sz.width, y: y - 1),
                 withAttributes: [.font: valueFont, .foregroundColor: color])

        let barW: CGFloat = bounds.width - pad * 2
        let barY = y + 16
        NSColor(calibratedWhite: 1, alpha: 0.10).setFill()
        NSBezierPath(roundedRect: NSRect(x: pad, y: barY, width: barW, height: 3),
                     xRadius: 1.5, yRadius: 1.5).fill()
        let filled = max(1, barW * CGFloat(min(max(m.pct, 0), 100)) / 100.0)
        color.setFill()
        NSBezierPath(roundedRect: NSRect(x: pad, y: barY, width: filled, height: 3),
                     xRadius: 1.5, yRadius: 1.5).fill()
        y += modelRowHeight
    }

    /// 百分比文案：小于 10% 保留一位小数，其余取整（和 OpenCode 那几行的观感对齐）
    static func pctText(_ value: Double) -> String {
        if value < 10 { return String(format: "%.1f%%", value) }
        return String(format: "%.0f%%", value)
    }

    /// 水位配色：<50 绿 / <80 橙 / ≥80 红
    static func waterColor(_ pct: Int) -> NSColor {
        pct >= 80 ? .systemRed : (pct >= 50 ? .systemOrange : .systemGreen)
    }
}

// MARK: - 面板

final class QuotaPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: QuotaPanel!
    private var view: QuotaView!
    private var statusItem: NSStatusItem!
    private var hotKeyRef: EventHotKeyRef?
    private var outsideMonitor: Any?
    private var refreshTimer: Timer?

    private let panelW: CGFloat = 262
    /// 初次显示用的高度；真正的尺寸每次都按内容算（见 resizePanelToFit）
    private let panelH: CGFloat = 420

    func applicationDidFinishLaunching(_ n: Notification) {
        if CommandLine.arguments.contains("--selftest") {
            runSelfTest()
            return
        }
        if let idx = CommandLine.arguments.firstIndex(of: "--render"),
           idx + 1 < CommandLine.arguments.count {
            renderToPNG(path: CommandLine.arguments[idx + 1])
            return
        }
        buildPanel()
        // 只在需要显示图标时才创建，避免"先建后删"干扰 MenuBarAgent
        if !iconHidden {
            buildStatusItem()
        } else {
            log("own status icon disabled at launch (Dimble launcher mode)")
        }
        registerHotKey()
        scheduleAutoRefresh()

        // Dimble 启动器会以 `open -a OCQuota` 方式唤起：此时直接弹出面板
        if UserDefaults.standard.bool(forKey: "showPanelOnLaunch") {
            UserDefaults.standard.set(false, forKey: "showPanelOnLaunch")
            log("launched by external open -> showing panel")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                self?.showPanel()
            }
            return
        }

        log("launched (menu bar mode), hideIcon=\(iconHidden)")

        // 应用保存的图标显隐设置（仅在需要恢复显示时）

        // 首次启动右侧提示
        if !UserDefaults.standard.bool(forKey: "menuBarHintShown") {
            UserDefaults.standard.set(true, forKey: "menuBarHintShown")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.showPanel()
                DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) { [weak self] in
                    self?.hidePanel()
                }
            }
        } else {
            refreshAccount { _, _ in }
        }
    }

    /// 被再次打开时（Dock/启动器/open）弹出面板
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPanel()
        return false
    }

    // MARK: 图标显隐

    /// 是否隐藏 OCQuota 自己的菜单栏图标（方案 A：交给 Dimble 启动器代管）
    private var iconHidden: Bool {
        UserDefaults.standard.bool(forKey: "hideOwnStatusIcon")
    }

    private func applyIconVisibility() {
        if iconHidden {
            if let item = statusItem {
                NSStatusBar.system.removeStatusItem(item)
                statusItem = nil
            }
        } else if statusItem == nil {
            buildStatusItem()
            updateStatusIcon()
        }
        // 菜单项文字要跟着变
        rebuildContextMenu()
    }

    @objc private func toggleOwnIcon() {
        UserDefaults.standard.set(!iconHidden, forKey: "hideOwnStatusIcon")
        applyIconVisibility()
        log("hideOwnStatusIcon -> \(iconHidden)")
    }

    // MARK: 菜单栏图标

    /// 固定方形长度 + 纯图标（不用文字）。
    /// 原因：macOS 27 的 MenuBarAgent 拒绝隐藏 variableLength/动态文字类的 status item，
    /// 会被 Dimble 判定为 "Incompatible app"。方形固定宽度可被正常接管。
    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem.button else {
            log("statusItem button unavailable")
            return
        }
        button.imagePosition = .imageOnly
        button.target = self
        button.action = #selector(statusItemClicked(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        updateStatusIcon(pct: nil, source: "额度")
        log("statusItem created (squareLength)")
    }

    /// 菜单栏图标显示「更紧的那个 5 小时水位」：CC 和 OC 谁用得狠就显示谁，
    /// 因为真正会先撞墙的是它。
    private func updateStatusIcon() {
        var ccPct: Int?
        if let cc = cachedCC, cc.fiveCap > 0 {
            ccPct = Int((cc.fiveUsed / cc.fiveCap * 100).rounded())
        }
        let ocPct = cachedAccount?.rollingPct
        let pct = [ccPct, ocPct].compactMap { $0 }.max()
        let source = (ccPct ?? -1) >= (ocPct ?? -1) ? "Command Code" : "OpenCode"
        updateStatusIcon(pct: pct, source: source)
    }

    private func updateStatusIcon(pct: Int?, source: String = "OpenCode") {
        guard let button = statusItem?.button else { return }

        let symbol: String
        let color: NSColor
        var desc: String

        if let pct = pct {
            switch pct {
            case 80...:   symbol = "exclamationmark.triangle.fill"; color = .systemRed
            case 50..<80: symbol = "chart.bar.fill";   color = .systemOrange
            default:      symbol = "chart.bar.fill";   color = .systemGreen
            }
            desc = "\(source) 5小时用量 \(pct)%"
        } else {
            symbol = "chart.bar"
            color = .secondaryLabelColor
            desc = "额度加载中"
        }

        let cfg = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
        let img = NSImage(systemSymbolName: symbol, accessibilityDescription: desc)?
            .withSymbolConfiguration(cfg)
        img?.isTemplate = false          // 保留自定义颜色

        button.image = img
        button.toolTip = desc
        // 关键：不设置任何 title，保持方形宽度固定
        button.title = ""
    }

    @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showContextMenu()
        } else {
            toggle()
        }
    }

    private func showContextMenu() {
        let menu = makeMenu()
        statusItem?.menu = menu
        statusItem?.button?.performClick(nil)
        statusItem?.menu = nil
    }

    /// 右键与面板共用的菜单
    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        let open = NSMenuItem(title: "打开面板", action: #selector(showFromMenu), keyEquivalent: "")
        open.target = self
        menu.addItem(open)

        let refreshItem = NSMenuItem(title: "立即刷新", action: #selector(doRefresh), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        menu.addItem(.separator())

        let hideItem = NSMenuItem(
            title: iconHidden ? "显示我的图标" : "隐藏我的图标（交给 Dimble 启动器）",
            action: #selector(toggleOwnIcon), keyEquivalent: "")
        hideItem.target = self
        menu.addItem(hideItem)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出 OCQuota", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        return menu
    }

    /// 图标隐藏后，菜单还是要在别处能用（面板里）
    private func rebuildContextMenu() {
        view.menu = makeMenu()
    }

    @objc private func showFromMenu() { showPanel() }

    // MARK: 面板

    private func buildPanel() {
        panel = QuotaPanel(contentRect: NSRect(x: 0, y: 0, width: panelW, height: panelH),
                           styleMask: [.borderless, .nonactivatingPanel],
                           backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .popUpMenu          // 浮在菜单栏之上
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .utilityWindow

        view = QuotaView(frame: NSRect(x: 0, y: 0, width: panelW, height: panelH))
        panel.contentView = view
        view.menu = makeMenu()   // 面板内右键也能用同一套菜单
    }

    private func toggle() {
        if panel.isVisible { hidePanel() } else { showPanel() }
    }

    private func showPanel() {
        // 先用已有数据立刻渲染，窗口马上可见（不再清空等待）
        renderBlocks()
        view.errorText = nil
        view.needsDisplay = true
        resizePanelToFit()
        positionPanelUnderStatusItem()
        panel.orderFrontRegardless()

        // 然后后台刷新（不阻塞）
        refresh()

        if let m = outsideMonitor { NSEvent.removeMonitor(m) }
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] event in
            // 点到菜单栏图标时交给 statusItemClicked 处理，避免闪烁
            guard let self = self else { return }
            let loc = NSEvent.mouseLocation
            // 注意：Dimble 启动器模式下 statusItem 为 nil，必须安全解包
            if let item = self.statusItem,
               let button = item.button,
               let win = button.window {
                let bRect = win.convertToScreen(button.convert(button.bounds, to: nil))
                if bRect.insetBy(dx: -4, dy: -4).contains(loc) { return }
            }
            self.hidePanel()
        }
    }

    /// 把面板贴到菜单栏图标正下方。
    ///
    /// 没有自己的 statusItem 时（Dimble 启动器模式：图标被隐藏），退回**屏幕右上角**
    /// ——也就是菜单栏那一排的位置，而不是鼠标位置（鼠标在哪都没关系，
    /// 面板要固定在右上角，像正常的菜单栏弹窗）。
    private func positionPanelUnderStatusItem() {
        if let button = statusItem?.button, let win = button.window {
            let local = button.convert(button.bounds, to: nil)
            let screenRect = win.convertToScreen(local)
            let height = panel.frame.height
            var x = screenRect.midX - panelW / 2
            var y = screenRect.minY - height - 6
            if let screen = win.screen ?? NSScreen.main {
                let vf = screen.visibleFrame
                x = min(max(vf.minX + 8, x), vf.maxX - panelW - 8)
                if y < vf.minY + 8 { y = vf.minY + 8 }
            }
            panel.setFrameOrigin(NSPoint(x: x, y: y))
            log("panel anchor=statusItem frame=\(panel.frame)")
            return
        }

        // 没有 statusItem 时（Dimble 启动器）以鼠标位置为水平中心：
        // 用户点的是菜单栏上那个启动器图标，面板就该在那个图标下面居中
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        guard let screen = screen else { return }
        let vf = screen.visibleFrame
        let height = panel.frame.height
        var x = mouse.x - panelW / 2
        x = min(max(vf.minX + 8, x), vf.maxX - panelW - 8)
        let y = vf.maxY - height - 6
        panel.setFrameOrigin(NSPoint(x: x, y: y))
        log("panel anchor=mouse frame=\(panel.frame) mouse=\(mouse)")
    }

    private func hidePanel() {
        panel.orderOut(nil)
        if let m = outsideMonitor {
            NSEvent.removeMonitor(m)
            outsideMonitor = nil
        }
    }

    // MARK: 自动刷新

    private func scheduleAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if self.panel.isVisible {
                self.refresh()
            } else {
                self.refreshAccount { _, _ in }
            }
        }
    }

    // MARK: 数据

    private func readKey() -> String? {
        let path = NSString(string: "~/.reasonix/.env").expandingTildeInPath
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("OPENCODE_GO_API_KEY=") else { continue }
            var v = String(line.dropFirst("OPENCODE_GO_API_KEY=".count))
            v = v.trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if !v.isEmpty { return v }
        }
        return nil
    }

    /// `OCQuota --selftest`：拉一次两家数据并按面板同样的口径打印，不开窗口。
    private func runSelfTest() {
        cachedCC = nil
        cachedAccount = nil
        var finished = false
        refreshCentral {
            let cc = self.cachedCC
            print("Command Code")
            if let cc = cc {
                print(String(format: "  5小时  $%.4f / $%.2f  = %.1f%%",
                             cc.fiveUsed, cc.fiveCap, cc.fiveCap > 0 ? cc.fiveUsed / cc.fiveCap * 100 : 0))
                print(String(format: "  本周    $%.4f / $%.2f  = %.1f%%",
                             cc.weekUsed, cc.weekCap, cc.weekCap > 0 ? cc.weekUsed / cc.weekCap * 100 : 0))
                print(String(format: "  本月    $%.4f / $%.2f  = %.1f%%",
                             cc.monthUsed, cc.monthCap, cc.monthCap > 0 ? cc.monthUsed / cc.monthCap * 100 : 0))
                if !cc.fiveReset.isEmpty { print("  5小时重置 \(cc.fiveReset)") }
            } else {
                print("  失败：\(self.ccError ?? "未知")")
            }
            print("OpenCode Go")
            if let acc = self.cachedAccount {
                print("  5小时 \(acc.rollingPct)%  本周 \(acc.weeklyPct)%  本月 \(acc.monthlyPct)%")
            } else {
                print("  失败：\(self.ocError ?? "未知")")
            }
            if let script = Self.locateScript("ccstats.py") {
                print("ccstats 脚本：\(script)")
            } else {
                print("ccstats 脚本：未找到")
            }
            if let script = Self.locateStatsScript() {
                print("ocstats 脚本：\(script)")
            } else {
                print("ocstats 脚本：未找到")
            }
            finished = true
        }
        // 主队列要转起来，fetch 完成后的 DispatchQueue.main.async 才会执行
        let deadline = Date().addingTimeInterval(25)
        while !finished && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        }
        exit(finished ? 0 : 2)
    }

    /// `OCQuota --render out.png`：拉数据 → 离屏画一次面板 → 存 PNG，不弹窗口。
    private func renderToPNG(path: String) {
        var finished = false
        refreshCentral { finished = true }
        let deadline = Date().addingTimeInterval(25)
        while !finished && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        }

        // 单模型明细走子进程，等两家都回来再画（截图模式要看到完整版式）
        fetchCCModelStats(force: true)
        fetchModelStats(force: true)
        let statsDeadline = Date().addingTimeInterval(25)
        while Date() < statsDeadline && (lastStatsAt == nil || ccModelsAt == nil) {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        }

        let blocks = buildBlocks()
        let view = QuotaView(frame: NSRect(x: 0, y: 0, width: panelW, height: 420))
        view.providers = blocks
        let size = NSSize(width: panelW, height: max(180, view.preferredHeight))
        view.frame = NSRect(origin: .zero, size: size)

        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
            FileHandle.standardError.write("bitmap rep 创建失败\n".data(using: .utf8)!)
            exit(1)
        }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let data = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write("PNG 编码失败\n".data(using: .utf8)!)
            exit(1)
        }
        let out = NSString(string: path).expandingTildeInPath
        try? data.write(to: URL(fileURLWithPath: out))
        print(out)
        exit(0)
    }

    /// 自检用的串行入口：两家都拉完再回调
    private func refreshCentral(_ completion: @escaping () -> Void) {
        let group = DispatchGroup()
        group.enter()
        refreshCC { group.leave() }
        group.enter()
        refreshAccount { _, _ in group.leave() }
        group.notify(queue: .main) { completion() }
    }

    private func refresh() {
        // 两个提供商各自独立跑，谁先回来谁先渲染，互相不阻塞
        refreshCC()
        refreshAccount { [weak self] acc, err in
            guard let self = self else { return }
            if let acc = acc {
                self.cachedAccount = acc
                self.updateStatusIcon()
                self.renderBlocks()
                // 账号数据到位后再触发（可复用 resetsAt，省一次网络请求）
                self.fetchModelStats()
            } else if let err = err {
                self.ocError = err
                self.renderBlocks()
                // 拿不到账号数据也尝试用缓存时间算单模型
                self.fetchModelStats()
            }
        }
    }

    // MARK: Command Code 用量
    //
    // 数据源（2026-11-14 实测）：
    //   GET https://api.commandcode.ai/alpha/billing/credits
    //     credits.monthlyCredits  = 本月「剩余」credit（美元）
    //     windowLimits.fiveHour   = {used, cap, resetAt(ms)}  → 5 小时窗口（Go 套餐 cap = $3）
    //     windowLimits.weekly     = {used, cap, resetAt(ms)}  → 周窗口（cap = $6）
    //   GET https://api.commandcode.ai/alpha/usage/summary
    //     totalCost = 本账期已花费（credit 单位）
    //   月度上限 = 剩余 + 已花，这样换成 GOAT/Max 套餐也不用改代码。
    //
    // 注意：官方没有「按模型」的用量接口，所以 CC 这块只有 5 小时 / 周 / 月三行，
    // 没有 OC 那种单模型明细。
    private func refreshCC(completion: (() -> Void)? = nil) {
        guard let key = readCCKey() else {
            ccError = "未找到 Command Code key"
            renderBlocks()
            completion?()
            return
        }
        let group = DispatchGroup()
        var credits: [String: Any]?
        var summary: [String: Any]?
        var failure: String?

        group.enter()
        ccRequest(path: "/alpha/billing/credits", key: key) { obj, err in
            if let obj = obj { credits = obj } else { failure = err }
            group.leave()
        }
        var subscription: [String: Any]?
        group.enter()
        ccRequest(path: "/alpha/usage/summary", key: key) { obj, _ in
            summary = obj
            group.leave()
        }
        group.enter()
        ccRequest(path: "/alpha/billing/subscriptions", key: key) { obj, _ in
            subscription = obj
            group.leave()
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            guard let root = credits,
                  let c = root["credits"] as? [String: Any],
                  let windows = root["windowLimits"] as? [String: Any] else {
                self.ccError = failure ?? "请求 /alpha/billing/credits 失败"
                self.renderBlocks()
                completion?()
                return
            }
            var cc = CCUsage()
            let remaining = (c["monthlyCredits"] as? Double) ?? 0
            let spent = (summary?["totalCost"] as? Double) ?? 0
            if let plan = (subscription?["data"] as? [String: Any])?["planId"] as? String {
                cc.planId = plan
            }
            // 月度总额优先按套餐定价取整（Go = $10），因为「剩余 + 已花」会因为
            // 两份统计口径的细微差异漂成 $9.98 这种数字；拿不到套餐就退回推导值
            if let cap = Self.planMonthlyCap(cc.planId) {
                cc.monthCap = cap
                cc.monthUsed = max(0, cap - remaining)
            } else {
                cc.monthCap = remaining + spent
                cc.monthUsed = spent
            }
            if let f = windows["fiveHour"] as? [String: Any] {
                cc.fiveUsed = (f["used"] as? Double) ?? 0
                cc.fiveCap = (f["cap"] as? Double) ?? 0
                cc.fiveReset = Self.localTime(Self.millisToISO(f["resetAt"]))
                cc.fiveResetMs = (f["resetAt"] as? Double) ?? 0
            }
            if let w = windows["weekly"] as? [String: Any] {
                cc.weekUsed = (w["used"] as? Double) ?? 0
                cc.weekCap = (w["cap"] as? Double) ?? 0
            }
            self.cachedCC = cc
            self.ccError = nil
            self.updateStatusIcon()
            self.renderBlocks()
            self.fetchCCModelStats()
            completion?()
        }
    }

    /// 按模型统计当前 5 小时窗口的花费（ccstats.py 扫 pi 会话日志）
    private var ccModels: [CCModelSpend] = []
    private var ccModelsAt: Date?
    private var ccModelsInFlight = false

    private func fetchCCModelStats(force: Bool = false) {
        if !force, let at = ccModelsAt, Date().timeIntervalSince(at) < 60 {
            return
        }
        guard !ccModelsInFlight else { return }
        ccModelsInFlight = true

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            defer { DispatchQueue.main.async { self.ccModelsInFlight = false } }

            guard let script = Self.locateScript("ccstats.py") else {
                log("ccstats.py not found")
                return
            }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            var args = [script, "--json"]
            if let reset = self.cachedCC?.fiveResetMs, reset > 0 {
                args.append("--reset-at")
                args.append(String(format: "%.0f", reset))
            }
            p.arguments = args
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = FileHandle.nullDevice
            do { try p.run() } catch {
                log("ccstats launch failed: \(error)")
                return
            }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()

            guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let models = root["models"] as? [String: Any] else {
                let snippet = String(data: data.prefix(200), encoding: .utf8) ?? "(无输出)"
                log("ccstats parse failed: \(snippet)")
                return
            }
            var out: [CCModelSpend] = []
            for (name, v) in models {
                guard let d = v as? [String: Any],
                      let used = d["used_usd"] as? Double else { continue }
                out.append(CCModelSpend(model: name, usd: used, calls: (d["calls"] as? Int) ?? 0))
            }
            out.sort { $0.usd > $1.usd }

            DispatchQueue.main.async {
                self.ccModels = out
                self.ccModelsAt = Date()
                self.renderBlocks()
            }
        }
    }

    private func ccRequest(path: String, key: String,
                          completion: @escaping ([String: Any]?, String?) -> Void) {
        guard let url = URL(string: "https://api.commandcode.ai" + path) else {
            completion(nil, "URL 不合法"); return
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("cli", forHTTPHeaderField: "User-Agent")
        req.setValue("1.89.1", forHTTPHeaderField: "x-command-code-version")
        req.setValue("cli", forHTTPHeaderField: "x-cli-surface")
        req.setValue("cli", forHTTPHeaderField: "x-cli-environment")
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { data, _, err in
            guard err == nil, let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(nil, "请求 \(path) 失败")
                return
            }
            completion(obj, nil)
        }.resume()
    }

    /// Command Code 的 key 存在 pi 的 auth.json 里（~/.pi/agent/auth.json 的 commandcode.key）
    private func readCCKey() -> String? {
        let path = NSString(string: "~/.pi/agent/auth.json").expandingTildeInPath
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entry = root["commandcode"] as? [String: Any],
              let key = entry["key"] as? String, !key.isEmpty else { return nil }
        return key
    }

    /// ocstats.py 的位置：源码搬进 pi-gui-dev 仓库后优先用仓库里的，
    /// 其次回退到老的 Reasonix 工作目录（装在别处跑的时候仍能工作）。
    private static func locateScript(_ name: String) -> String? {
        var candidates: [String] = []
        if let override = UserDefaults.standard.string(forKey: "statsScript"), !override.isEmpty {
            candidates.append(NSString(string: override).expandingTildeInPath)
        }
        candidates.append(NSString(string: "~/project/github.com/pi-gui-dev/tools/quota-monitor/" + name).expandingTildeInPath)
        candidates.append(NSString(string: "~/.reasonix/global-workspace/" + name).expandingTildeInPath)
        return candidates.first { FileManager.default.fileExists(atPath: $0) }
    }

    private static func locateStatsScript() -> String? { locateScript("ocstats.py") }

    private static func millisToISO(_ value: Any?) -> String? {
        guard let ms = value as? Double, ms > 0 else { return nil }
        let f = ISO8601DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    private func refreshAccount(completion: @escaping (AccountUsage?, String?) -> Void) {
        guard let key = readKey() else {
            completion(nil, "未找到 OPENCODE_GO_API_KEY")
            return
        }
        var req = URLRequest(url: URL(string: "https://opencode.ai/zen/go/v1/usage")!)
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("opencode/2.0", forHTTPHeaderField: "User-Agent")
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req) { data, _, err in
            guard err == nil, let data = data,
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let usage = root["usage"] as? [String: Any] else {
                DispatchQueue.main.async { completion(nil, "请求 /usage 失败") }
                return
            }
            var acc = AccountUsage()
            if let d = usage["rolling"] as? [String: Any] {
                acc.rollingPct = Self.pct(d["percent"])
                acc.resetAtRaw = (d["resetsAt"] as? String) ?? ""
                acc.resetText = Self.localTime(acc.resetAtRaw)
            }
            if let d = usage["weekly"] as? [String: Any] { acc.weeklyPct = Self.pct(d["percent"]) }
            if let d = usage["monthly"] as? [String: Any] { acc.monthlyPct = Self.pct(d["percent"]) }
            DispatchQueue.main.async {
                self.cachedAccount = acc
                completion(acc, nil)
            }
        }.resume()
    }

    /// 上次拿到的单模型数据与时间（避免每次打开都重新扫日志）
    private var lastModels: [ModelUsage] = []
    private var lastWindowText: String = ""
    private var lastStatsAt: Date?
    private var statsInFlight = false
    /// 账号级数据缓存，打开面板时立即渲染
    private var cachedAccount: AccountUsage?
    /// Command Code 用量缓存
    private var cachedCC: CCUsage?
    private var ccError: String?
    private var ocError: String?

    /// 后台执行 ocstats.py，绝不阻塞主线程。
    /// 有缓存（60 秒内）时先用缓存立即渲染，再后台刷新。
    private func fetchModelStats(force: Bool = false) {
        // 1. 有缓存且未过期 → 立即显示，不等待
        if !force, let at = lastStatsAt, Date().timeIntervalSince(at) < 60, !lastModels.isEmpty {
            renderBlocks()
            return
        }

        // 2. 有旧数据 → 先显示旧的（至少不是空白）
        renderBlocks()

        guard !statsInFlight else { return }
        statsInFlight = true

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            defer { DispatchQueue.main.async { self.statsInFlight = false } }

            guard let script = Self.locateStatsScript() else {
                log("ocstats.py not found")
                return
            }

            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            var args = [script, "--json", "--all"]
            // 有缓存的 resetsAt 就传进去，省掉 ocstats 自己的一次网络请求（约 1.2s）
            if let raw = self.cachedAccount?.resetAtRaw, !raw.isEmpty {
                args.append("--reset-at")
                args.append(raw)
            }
            p.arguments = args
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = FileHandle.nullDevice

            do { try p.run() } catch {
                log("ocstats launch failed: \(error)")
                return
            }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()

            guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let models = root["models"] as? [String: Any] else {
                let snippet = String(data: data.prefix(300), encoding: .utf8) ?? "(无输出)"
                log("ocstats parse failed: \(snippet)")
                return
            }

            var out: [ModelUsage] = []
            for (name, v) in models {
                guard let d = v as? [String: Any],
                      let used = d["allowance_usd"] as? Double,
                      let cap = d["window_cap_usd"] as? Double,
                      let pctv = d["used_pct"] as? Double else { continue }
                out.append(ModelUsage(model: name, usedUSD: used, capUSD: cap, pct: pctv))
            }
            out.sort { $0.usedUSD > $1.usedUSD }

            var wtext = ""
            if let ws = root["window_start_utc"] as? String,
               let we = root["window_reset_utc"] as? String {
                wtext = "窗口 \(Self.localTime(ws)) → \(Self.localTime(we))"
            }

            DispatchQueue.main.async {
                self.lastModels = out
                self.lastWindowText = wtext
                self.lastStatsAt = Date()
                self.renderBlocks()
            }
        }
    }

    /// 把缓存拼成面板内容：Command Code 在前，OpenCode Go 在后
    private func renderBlocks() {
        guard view != nil else { return }
        view.providers = buildBlocks()
        view.resetText = ""
        view.needsDisplay = true
        resizePanelToFit()
    }

    /// 只拼数据，不碰 UI（自检 / 截图模式要复用）
    private func buildBlocks() -> [ProviderBlock] {
        var blocks: [ProviderBlock] = []

        // ── Command Code ──
        var ccRows: [QuotaRow] = []
        var ccNotes: [String] = []
        if let cc = cachedCC, cc.fiveCap > 0 || cc.weekCap > 0 || cc.monthCap > 0 {
            ccRows.append(QuotaRow(label: "5小时",
                                   pct: cc.fiveCap > 0 ? cc.fiveUsed / cc.fiveCap * 100 : 0,
                                   valueText: ""))
            ccRows.append(QuotaRow(label: "本周",
                                   pct: cc.weekCap > 0 ? cc.weekUsed / cc.weekCap * 100 : 0,
                                   valueText: ""))
            ccRows.append(QuotaRow(label: "本月",
                                   pct: cc.monthCap > 0 ? cc.monthUsed / cc.monthCap * 100 : 0,
                                   valueText: ""))
            if !cc.fiveReset.isEmpty {
                ccNotes.append("5小时重置 \(cc.fiveReset) 北京时间")
            }
        } else if let err = ccError {
            ccNotes.append(err)
        } else {
            ccNotes.append("加载中…")
        }
        let ccModelRows: [ModelUsage] = ccModels.map { spend in
            let cap = cachedCC?.fiveCap ?? 0
            let pct = cap > 0 ? spend.usd / cap * 100 : 0
            return ModelUsage(model: spend.model, usedUSD: spend.usd,
                              capUSD: cap, pct: pct, valueText: "")
        }
        var ccNoteList = ccNotes
        if !ccModelRows.isEmpty {
            ccNoteList.insert("单模型按 pi 会话日志估算，占整池比例", at: 0)
        }
        blocks.append(ProviderBlock(title: "COMMAND CODE",
                                    rows: ccRows,
                                    models: ccModelRows,
                                    modelsTitle: "单模型 · 5小时",
                                    footnotes: ccNoteList))

        // ── OpenCode Go ──
        var ocRows: [QuotaRow] = []
        var ocNotes: [String] = []
        if let acc = cachedAccount {
            ocRows.append(QuotaRow(label: "5小时", pct: Double(acc.rollingPct), valueText: "\(acc.rollingPct)%"))
            ocRows.append(QuotaRow(label: "本周", pct: Double(acc.weeklyPct), valueText: "\(acc.weeklyPct)%"))
            ocRows.append(QuotaRow(label: "本月", pct: Double(acc.monthlyPct), valueText: "\(acc.monthlyPct)%"))
            if !lastWindowText.isEmpty { ocNotes.append(lastWindowText) }
        } else if let err = ocError {
            ocNotes.append(err)
        } else {
            ocNotes.append("加载中…")
        }
        blocks.append(ProviderBlock(title: "OPENCODE GO",
                                    rows: ocRows,
                                    models: lastModels,
                                    modelsTitle: "单模型 · 5小时",
                                    footnotes: ocNotes))

        return blocks
    }

    /// 面板高度跟着内容走，避免加了一块之后被裁掉
    private func resizePanelToFit() {
        guard let panel = panel, let view = view else { return }
        let h = max(180, view.preferredHeight)
        let frame = NSRect(x: panel.frame.origin.x, y: panel.frame.origin.y,
                           width: panelW, height: h)
        panel.setFrame(frame, display: true)
    }

    /// 各套餐的月度 credit 总额（来源：commandcode.ai/pricing，2026-11-14 复核）。
    /// 认不出套餐时返回 nil，调用方退回「剩余 + 已花」。
    private static func planMonthlyCap(_ planId: String) -> Double? {
        let id = planId.lowercased()
        if id.contains("goat") { return 100 }
        if id.contains("max20") || id.contains("max-20") { return 300 }
        if id.contains("max10") || id.contains("max-10") { return 150 }
        if id.contains("team") { return 40 }
        if id.contains("individual-go") || id == "go" { return 10 }
        if id.contains("pro") { return 110 }
        return nil
    }


    // MARK: 快捷键（保留）

    private func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, userData) -> OSStatus in
            guard let userData = userData else { return OSStatus(eventNotHandledErr) }
            let me = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            me.toggle()
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)

        let hkID = EventHotKeyID(signature: OSType(0x4F435154), id: 1)
        let status = RegisterEventHotKey(UInt32(kVK_ANSI_O),
                                         UInt32(controlKey | optionKey),
                                         hkID, GetApplicationEventTarget(), 0, &hotKeyRef)
        log("hotkey register status=\(status)")
    }

    private static func pct(_ v: Any?) -> Int {
        var raw: Double = 0
        if let d = v as? Double { raw = d }
        else if let i = v as? Int { raw = Double(i) }
        return raw <= 0 ? 0 : max(1, Int(raw.rounded()))
    }

    private static func localTime(_ iso: String?) -> String {
        guard let iso = iso else { return "" }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d = f.date(from: iso)
        if d == nil { f.formatOptions = [.withInternetDateTime]; d = f.date(from: iso) }
        guard let date = d else { return "" }
        let out = DateFormatter()
        out.timeZone = TimeZone(secondsFromGMT: 8 * 3600)
        out.dateFormat = "MM-dd HH:mm"
        return out.string(from: date)
    }

    @objc private func doRefresh() { refresh() }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
