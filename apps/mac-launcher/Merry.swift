import AppKit
import CoreImage
import WebKit

final class MerryDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "설정 화면을 열 준비가 됐습니다.")
    let start = NSButton(title: "Maricode 화면 시작", target: nil, action: nil)
    let open = NSButton(title: "브라우저에서 열기", target: nil, action: nil)
    let stop = NSButton(title: "작업 서버 종료", target: nil, action: nil)
    let configure = NSButton(title: "이 Mac의 AI 작업 설정", target: nil, action: nil)
    let changeProject = NSButton(title: "기본 작업 폴더 변경", target: nil, action: nil)
    let addAgent = NSButton(title: "다른 AI 추가", target: nil, action: nil)
    let remoteStart = NSButton(title: "HTTPS 전달 시작", target: nil, action: nil)
    let remoteStop = NSButton(title: "HTTPS 전달 종료", target: nil, action: nil)
    let remoteSettings = NSButton(title: "원격 주소 설정", target: nil, action: nil)
    let connect = NSButton(title: "작업 화면 연결", target: nil, action: nil)
    var process: Process?
    var input: Pipe?
    var output: Pipe?
    var url: URL?
    var runtimeExitIsSafe = true
    let updateInstall = UpdateInstallFlow()
    var quitting = false
    var quitReviewNonce: String?
    var stopping = false
    var received = ""
    var webView: WKWebView!
    let updateNotice = NSButton(title: "새 업데이트", target: nil, action: nil)
    let machineLabel = NSTextField(labelWithString: "이 Mac")
    let connectionIndicator = NSImageView()
    var connectionTimer: Timer?
    var productTitle: String { ["Maricode", Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
    let pageTitle = NSTextField(labelWithString: "")
    let backButton = NSButton()
    var utilityTrail = DesktopUtilityTrail()
    let browserContainer = NSView()
    let hostButton = NSButton()
    let leftPanelButton = NSButton()
    let rightPanelButton = NSButton()
    var utilityViews: [String: WKWebView] = [:]
    var pairingRequestID: String?
    var remoteConfirmed = false
    var selectedAgent: String?
    lazy var appUpdater = AppUpdateController(version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0")

    var pendingConfiguration: String?
    var authenticating = false
    // The local view stays hidden until a real page loads so the empty WebView and one-use grant page never flash white.
    var localPageReady = false
    // Set when the runtime reports an app reset; this app's WebKit store is cleared once before the first page.
    var appResetPending = false
    var connectFile: URL { URL(fileURLWithPath: dataDirectory()).appendingPathComponent("connect.private.html") }


    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconPath = Bundle.main.path(forResource: "AppIcon", ofType: "icns") { NSApp.applicationIconImage = NSImage(contentsOfFile: iconPath) }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = productTitle; window.minSize = NSSize(width: 820, height: 600); window.delegate = self
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "maricode")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self; webView.uiDelegate = self
        window.appearance = NSAppearance(named: .darkAqua)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(srgbRed: 0.075, green: 0.075, blue: 0.086, alpha: 1)
        status.font = .systemFont(ofSize: 11); status.textColor = .secondaryLabelColor
        status.maximumNumberOfLines = 1; status.lineBreakMode = .byTruncatingTail
        status.translatesAutoresizingMaskIntoConstraints = false
        status.widthAnchor.constraint(lessThanOrEqualToConstant: 210).isActive = true
        for (button, symbol, label, action) in [(backButton, "chevron.left", "뒤로가기", #selector(goBack)), (leftPanelButton, "sidebar.left", "프로젝트 사이드바 보이기/숨기기", #selector(toggleLeftPanel)), (rightPanelButton, "sidebar.right", "상세 사이드바 보이기/숨기기", #selector(toggleRightPanel))] {
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
            button.isBordered = false; button.bezelStyle = .recessed; button.contentTintColor = .secondaryLabelColor
            button.target = self; button.action = action; button.toolTip = label; button.setAccessibilityLabel(label)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.widthAnchor.constraint(equalToConstant: 32).isActive = true; button.heightAnchor.constraint(equalToConstant: 32).isActive = true
        }
        machineLabel.font = .systemFont(ofSize: 12, weight: .medium)
        machineLabel.textColor = .secondaryLabelColor; machineLabel.lineBreakMode = .byTruncatingMiddle
        machineLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 240).isActive = true
        pageTitle.font = .systemFont(ofSize: 13, weight: .medium)
        pageTitle.lineBreakMode = .byTruncatingTail; pageTitle.maximumNumberOfLines = 1
        connectionIndicator.image = NSImage(systemSymbolName: "circle.fill", accessibilityDescription: "연결 상태")
        connectionIndicator.translatesAutoresizingMaskIntoConstraints = false
        connectionIndicator.widthAnchor.constraint(equalToConstant: 7).isActive = true
        connectionIndicator.heightAnchor.constraint(equalToConstant: 7).isActive = true
        let computer = NSStackView(views: [connectionIndicator, machineLabel]); computer.spacing = 6; computer.alignment = .centerY
        updateNotice.isHidden = true; updateNotice.bezelStyle = .recessed; updateNotice.target = self; updateNotice.action = #selector(showAppUpdates)
        appUpdater.onInstall = { [weak self] image, release in
            guard let self, !self.quitting, !self.stopping, self.quitReviewNonce == nil, self.pendingConfiguration == nil,
                  self.updateInstall.begin(file: image, size: release.size, sha256: release.sha256) else { return false }
            DispatchQueue.main.async { NSApp.terminate(nil) }; return true
        }
        appUpdater.onAvailable = { [weak self] version in self?.updateNotice.isHidden = version == nil; self?.updateNotice.title = version.map { "업데이트 \($0)" } ?? "새 업데이트" }
        let controls = NSStackView(views: [updateNotice, status, computer, rightPanelButton]); controls.spacing = 12
        let chrome = NSView(); chrome.wantsLayer = true
        chrome.layer?.backgroundColor = NSColor(srgbRed: 0.075, green: 0.075, blue: 0.086, alpha: 1).cgColor
        for view in [chrome, browserContainer] { view.translatesAutoresizingMaskIntoConstraints = false; window.contentView!.addSubview(view) }
        let baseline = NSView(); baseline.wantsLayer = true; baseline.layer?.backgroundColor = NSColor(srgbRed: 0.16, green: 0.16, blue: 0.18, alpha: 1).cgColor
        for view in [baseline, controls, leftPanelButton, backButton, pageTitle] { view.translatesAutoresizingMaskIntoConstraints = false; chrome.addSubview(view) }
        let content = window.contentView!
        NSLayoutConstraint.activate([
            chrome.topAnchor.constraint(equalTo: content.topAnchor), chrome.leadingAnchor.constraint(equalTo: content.leadingAnchor), chrome.trailingAnchor.constraint(equalTo: content.trailingAnchor), chrome.heightAnchor.constraint(equalToConstant: 44),
            backButton.leadingAnchor.constraint(equalTo: leftPanelButton.leadingAnchor), backButton.centerYAnchor.constraint(equalTo: chrome.centerYAnchor),
            pageTitle.leadingAnchor.constraint(equalTo: backButton.trailingAnchor, constant: 8), pageTitle.centerYAnchor.constraint(equalTo: chrome.centerYAnchor), pageTitle.trailingAnchor.constraint(lessThanOrEqualTo: controls.leadingAnchor, constant: -12),
            baseline.heightAnchor.constraint(equalToConstant: 1), baseline.leadingAnchor.constraint(equalTo: chrome.leadingAnchor), baseline.trailingAnchor.constraint(equalTo: chrome.trailingAnchor), baseline.bottomAnchor.constraint(equalTo: chrome.bottomAnchor),
            leftPanelButton.leadingAnchor.constraint(equalTo: chrome.leadingAnchor, constant: 80), leftPanelButton.centerYAnchor.constraint(equalTo: chrome.centerYAnchor),
            controls.centerYAnchor.constraint(equalTo: chrome.centerYAnchor), controls.trailingAnchor.constraint(equalTo: chrome.trailingAnchor, constant: -12),
            browserContainer.topAnchor.constraint(equalTo: chrome.bottomAnchor), browserContainer.leadingAnchor.constraint(equalTo: content.leadingAnchor), browserContainer.trailingAnchor.constraint(equalTo: content.trailingAnchor), browserContainer.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        installLocalView()
        hostButton.image = NSImage(systemSymbolName: "server.rack", accessibilityDescription: "호스트")
        hostButton.title = ""; hostButton.imagePosition = .imageLeading
        hostButton.target = self; hostButton.action = #selector(showHostMenu)
        hostButton.isBordered = false; hostButton.bezelStyle = .recessed
        hostButton.font = .systemFont(ofSize: 12); hostButton.contentTintColor = .secondaryLabelColor
        hostButton.setAccessibilityLabel("이 Mac 관리"); hostButton.toolTip = "이 Mac의 설정과 다른 기기 연결"
        hostButton.translatesAutoresizingMaskIntoConstraints = false
        browserContainer.addSubview(hostButton)
        NSLayoutConstraint.activate([hostButton.leadingAnchor.constraint(equalTo: browserContainer.leadingAnchor, constant: 12), hostButton.bottomAnchor.constraint(equalTo: browserContainer.bottomAnchor, constant: -2), hostButton.widthAnchor.constraint(equalToConstant: 28), hostButton.heightAnchor.constraint(equalToConstant: 28)])
        let menu = NSMenu(); let item = NSMenuItem(); menu.addItem(item)
        let appMenu = NSMenu(); let updates = appMenu.addItem(withTitle: "업데이트 확인…", action: #selector(showAppUpdates), keyEquivalent: ""); updates.target = self; appMenu.addItem(.separator()); appMenu.addItem(withTitle: "Maricode 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); item.submenu = appMenu; NSApp.mainMenu = menu
        let setupItem = NSMenuItem(); let setupMenu = NSMenu(title: "설정")
        setupMenu.delegate = self
        setupItem.submenu = setupMenu; menu.addItem(setupItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "편집")
        editMenu.addItem(withTitle: "잘라내기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu; menu.addItem(editItem)
        let helpItem = NSMenuItem(); let help = NSMenu(title: "도움말")
        let accessItem = help.addItem(withTitle: "파일·폴더 접근 안내", action: #selector(showFileAccessHelp), keyEquivalent: ""); accessItem.target = self
        let guideItem = help.addItem(withTitle: "설치·사용 안내", action: #selector(openUserGuide), keyEquivalent: ""); guideItem.target = self
        let licenseItem = help.addItem(withTitle: "라이선스·소스 안내", action: #selector(openNotices), keyEquivalent: ""); licenseItem.target = self
        helpItem.submenu = help; menu.addItem(helpItem)
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        connectionTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshConnectionIndicator() }
        startWeb()
        if Bundle.main.object(forInfoDictionaryKey: "MARICODERelease") as? Bool == true { appUpdater.checkSilently() }
    }
    func updateLocalLabel() { machineLabel.stringValue = "이 Mac"; machineLabel.toolTip = "현재 컴퓨터 · 이 Mac" }
    func installLocalView() {
        webView.configuration.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('maricode-desktop', 'maricode-local')", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView.translatesAutoresizingMaskIntoConstraints = false
        browserContainer.addSubview(webView)
        NSLayoutConstraint.activate([webView.topAnchor.constraint(equalTo: browserContainer.topAnchor), webView.leadingAnchor.constraint(equalTo: browserContainer.leadingAnchor), webView.trailingAnchor.constraint(equalTo: browserContainer.trailingAnchor), webView.bottomAnchor.constraint(equalTo: browserContainer.bottomAnchor)])
        updateLocalLabel(); showLocal()
    }
    func showLocal() {
        status.stringValue = ""
        utilityTrail.clear(); renderScreen()
        paintConnectionIndicator(nil); refreshConnectionIndicator()
    }
    func renderScreen() {
        let current = utilityTrail.current
        webView.isHidden = current != nil || !localPageReady
        for (id, view) in utilityViews { view.isHidden = id != current }
        backButton.isHidden = current == nil
        let section = current == "settings" ? "컴퓨터 설정" : nil
        pageTitle.stringValue = productTitle + (section.map { " · " + $0 } ?? "")
        pageTitle.toolTip = pageTitle.stringValue
        leftPanelButton.isHidden = current != nil; rightPanelButton.isHidden = current != nil
        // Lifecycle and failure messages remain visible beside the computer name.
        refreshPanelControls()
    }
    @objc func goBack() { utilityTrail.back(); renderScreen() }
    func paintConnectionIndicator(_ state: String?) {
        let tone = desktopConnectionTone(state)
        connectionIndicator.contentTintColor = tone == "green" ? .systemGreen : tone == "amber" ? .systemOrange : tone == "red" ? .systemRed : .secondaryLabelColor
        let labels = ["live": "실시간 연결됨", "empty": "연결됨 · 작업 세션 없음", "restoring": "연결 복원 중", "connecting": "연결 확인 중", "paused": "실시간 연결 중지", "outdated": "화면 업데이트 필요", "unavailable": "서버 연결 실패", "expired": "인증 만료", "denied": "접근 불가", "login-needed": "로그인 필요"]
        let label = labels[state ?? ""] ?? "연결 상태 확인 전"
        connectionIndicator.toolTip = label; connectionIndicator.setAccessibilityLabel(label)
        machineLabel.toolTip = "이 Mac · " + label
    }
    func refreshConnectionIndicator() {
        if webView.isLoading { paintConnectionIndicator("connecting"); return }
        webView.evaluateJavaScript("document.getElementById('connection')?.dataset.connectionState ?? null") { [weak self] result, error in
            self?.paintConnectionIndicator(error == nil ? result as? String : nil)
        }
    }
    @objc func toggleLeftPanel() { togglePanel("open-nav") }
    @objc func toggleRightPanel() { togglePanel("info-tab") }
    func togglePanel(_ id: String) {
        guard utilityTrail.current == nil, ["open-nav", "info-tab"].contains(id), desktopWorkspacePath(webView.url?.path) else { return }
        webView.evaluateJavaScript("document.getElementById('\(id)')?.click()") { [weak self] _, _ in self?.refreshPanelControls() }
    }
    func refreshPanelControls() {
        let workspace = desktopWorkspacePath(webView.url?.path)
        leftPanelButton.isEnabled = workspace; rightPanelButton.isEnabled = workspace
        hostButton.isHidden = utilityTrail.current != nil
        guard utilityTrail.current == nil, workspace else { return }
        webView.evaluateJavaScript("document.body.classList.contains('sidebar-collapsed')") { [weak self] result, _ in
            guard let self, self.utilityTrail.current == nil else { return }
            self.hostButton.isHidden = result as? Bool == true
        }
    }
    // After the server address changes the app restarts its web server, then reopens the device dialog.
    var reopenDevicesAfterRestart = false
    // Per-launch key for the local setup page, read from the launcher's stdout only.
    var setupKey: String?
    func loadDesktop(_ path: String) {
        guard process != nil, !stopping, let target = desktopLocalURL(path: path, setupKey: setupKey) else { return }
        showLocal(); webView.load(URLRequest(url: target))
    }
    func restoreDesktop() {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: dataDirectory() + "/environment.json")),
              let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let roles = saved["roles"] as? [String: Bool] else { loadDesktop("/setup"); return }
        if roles["local"] == true && FileManager.default.fileExists(atPath: dataDirectory() + "/backend.json") { connectWorkspace() }
        else if roles["local"] == true { requestConfiguration("initialize") }
        else { loadDesktop("/setup") }
    }
    func restoreAfterReleaseTransition() {
        let key = "MaricodeCleanStart110WebData"
        let releaseTransition = Bundle.main.object(forInfoDictionaryKey: "MARICODERelease") as? Bool == true &&
            Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == "1.1.0" &&
            !UserDefaults.standard.bool(forKey: key)
        if releaseTransition || appResetPending {
            // This app's WebKit store only. Other browsers and external CLI authentication are untouched.
            webView.configuration.websiteDataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
                DispatchQueue.main.async {
                    guard let self, self.process != nil, !self.stopping else { return }
                    if releaseTransition { UserDefaults.standard.set(true, forKey: key) }; self.appResetPending = false
                    self.removeComputerTabs(); self.restoreDesktop()
                }
            }
        } else { removeComputerTabs(); restoreDesktop() }
    }
    // Computer tabs were removed (other computers open in a browser or PWA); their saved list goes once.
    func removeComputerTabs() { try? FileManager.default.removeItem(atPath: dataDirectory() + "/machine-tabs.json") }
    func showUtility(_ key: String, title: String, path: String) {
        let freshVisit = utilityTrail.current == nil
        utilityTrail.open(key)
        if utilityViews[key] == nil {
            let config = WKWebViewConfiguration(); config.websiteDataStore = .default()
            config.userContentController.add(self, name: "maricode")
            config.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('maricode-management')", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            let view = WKWebView(frame: .zero, configuration: config); view.navigationDelegate = self; view.uiDelegate = self
            view.translatesAutoresizingMaskIntoConstraints = false
            browserContainer.addSubview(view)
            NSLayoutConstraint.activate([view.topAnchor.constraint(equalTo: browserContainer.topAnchor), view.bottomAnchor.constraint(equalTo: browserContainer.bottomAnchor), view.leadingAnchor.constraint(equalTo: browserContainer.leadingAnchor), view.trailingAnchor.constraint(equalTo: browserContainer.trailingAnchor)])
            utilityViews[key] = view
        }
        if freshVisit || utilityViews[key]!.url == nil, let target = desktopLocalURL(path: path, setupKey: setupKey) {
            utilityViews[key]!.load(URLRequest(url: target))
        }
        renderScreen()
    }
    func savedRoles() -> [String: Bool] {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: dataDirectory() + "/environment.json")), let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return saved["roles"] as? [String: Bool] ?? [:]
    }
    func addHostActions(to menu: NSMenu) {
        let actions = desktopHostActions(server: savedRoles()["server"] == true)
        let entries: [(String, String, Selector)] = [
            ("settings", "이 Mac의 설정…", #selector(showSettings)),
            ("agent", "이 Mac의 AI 연결…", #selector(requestAgentConfiguration)),
            ("devices", "다른 기기 연결…", #selector(showDeviceConnection)),
            ("reconnect", "작업 화면 다시 연결", #selector(retryDesktop))
        ]
        for (key, title, action) in entries where actions.contains(key) {
            let entry = menu.addItem(withTitle: title, action: action, keyEquivalent: ""); entry.target = self
        }
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems(); addHostActions(to: menu)
    }
    @objc func showHostMenu() {
        let menu = NSMenu(title: "이 Mac"); addHostActions(to: menu)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: hostButton.bounds.maxY + 4), in: hostButton)
    }
    // One place for letting other devices in: the web dialog shows the address, forwarding, code, QR and devices.
    @objc func showDeviceConnection() {
        if utilityTrail.current != nil { utilityTrail.clear(); renderScreen() }
        guard desktopWorkspacePath(webView.url?.path) else {
            status.stringValue = "작업 화면이 열린 뒤 다시 시도하세요."; return
        }
        // Return a Boolean, not the async handler's Promise (unsupported by evaluateJavaScript).
        webView.evaluateJavaScript("(() => { if (typeof window.maricodeOpenPairing !== 'function') return false; void window.maricodeOpenPairing(); return true; })()") { [weak self] result, error in
            guard let self else { return }
            if error != nil || result as? Bool != true {
                self.status.stringValue = "연결 창을 열지 못했습니다. 작업 화면 다시 연결 후 시도하세요."; return
            }
            self.status.stringValue = ""; self.pushRemoteState()
        }
    }
    func pushRemoteState() {
        let info = try? RemoteConnection.read(directory: dataDirectory())
        let state: [String: Any] = ["address": info?.address ?? NSNull(), "forwarding": remoteConfirmed, "canStart": remoteStart.isEnabled]
        guard let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.maricodeRemoteState?.(\(json))", completionHandler: nil)
    }
    @objc func showWorkspace() { if webView.url?.path == "/workspace" { showLocal() } else { restoreDesktop() } }
    @objc func showSettings() { showUtility("settings", title: "컴퓨터 설정", path: "/setup") }
    @objc func retryDesktop() { if process == nil { startWeb() } else if !stopping { restoreDesktop() } }
    @objc func requestLocalConfiguration() { requestConfiguration("configure") }
    @objc func requestAgentConfiguration() { requestConfiguration("add-agent") }
    @objc func requestProjectConfiguration() { requestConfiguration("change-project") }
    @objc func requestRemoteConfiguration() { requestConfiguration("remote-settings") }
    func requestConfiguration(_ action: String) {
        guard pendingConfiguration == nil, !stopping, !quitting else { return }
        if process == nil { performConfiguration(action); return }
        pendingConfiguration = action
        stopWeb() // Existing shutdown protection also guards native settings changes.
    }
    func performConfiguration(_ action: String) {
        switch action {
        case "initialize": initializeLocal()
        case "configure": configureLocal()
        case "add-agent": addLocalAgent()
        case "change-project": changeLocalProject()
        case "remote-settings": configureRemote()
        default: return
        }
        reopenDevicesAfterRestart = action == "remote-settings"; startWeb()
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard (message.webView === webView || message.webView === utilityViews["settings"]), let rawAction = message.body as? String else { return }
        let action = rawAction.hasPrefix("pairing-prepare:") ? "pairing-prepare" : rawAction.hasPrefix("pairing-cancel:") ? "pairing-cancel" : rawAction.hasPrefix("quit-cancelled:") ? "quit-cancelled" : rawAction.hasPrefix("pairing-qr:") ? "pairing-qr" : rawAction.hasPrefix("quit-ready:") ? "quit-ready" : rawAction.hasPrefix("choose-claude-source:") ? "choose-claude-source" : rawAction
        guard desktopCommandAllowed(scheme: origin.protocol, host: origin.host, port: origin.port, mainFrame: message.frameInfo.isMainFrame, action: action) else { return }
        if action == "quit-cancelled" {
            guard message.webView === webView, let nonce = quitReviewNonce, rawAction == "quit-cancelled:" + nonce else { return }
            quitReviewNonce = nil; cancelUpdateInstallation(); return
        }
        if action == "quit-ready" {
            guard message.webView === webView, let nonce = quitReviewNonce, rawAction == "quit-ready:" + nonce else { return }
            quitReviewNonce = nil; NSApp.terminate(nil); return
        }
        if action == "add-project" { addProjectFolder(); return }
        if action == "pairing-prepare" || action == "pairing-cancel" {
            guard message.webView === webView, desktopWorkspacePath(webView.url?.path),
                  let request = rawAction.split(separator: ":").last.map(String.init), UUID(uuidString: request) != nil else { return }
            if action == "pairing-cancel" { if pairingRequestID == request { pairingRequestID = nil }; return }
            guard process != nil, !stopping, savedRoles()["server"] == true else { reportPairing(request, ready: false); return }
            if let pending = pairingRequestID { if pending != request { reportPairing(request, ready: false) }; return }
            pairingRequestID = request; status.stringValue = "주소와 HTTPS 전달 준비 중…"
            remoteStart.isEnabled = false
            do {
                guard let input else { throw RemoteConnection.Failure.unavailable }
                try input.fileHandleForWriting.write(contentsOf: Data(("remote-prepare " + request + "\n").utf8))
            } catch { reportPairing(request, ready: false); pairingRequestID = nil; remoteConfirmed = false; remoteStop.isEnabled = true; status.stringValue = "준비 요청 결과가 불확실합니다. 전달 종료로 상태를 확인하세요."; pushRemoteState() }
            return
        }
        if action == "pairing-qr" {
            guard message.webView === webView, desktopWorkspacePath(webView.url?.path) else { return }
            guard remoteConfirmed else { return }
            showPairingQR(String(rawAction.dropFirst("pairing-qr:".count))); return
        }
        if action == "choose-claude-source" {
            guard message.webView === webView, desktopWorkspacePath(webView.url?.path),
                  let requestId = rawAction.split(separator: ":").last.map(String.init), UUID(uuidString: requestId) != nil else { return }
            chooseClaudeSource(requestId); return
        }
        if action == "connect" { if webView.url?.path == "/workspace" { showLocal() } else { restoreDesktop() }; return }
        if ["remote-start", "remote-stop", "remote-state"].contains(action) {
            guard message.webView === webView, desktopWorkspacePath(webView.url?.path) else { return }
            if action == "remote-start" { startRemote() } else if action == "remote-stop" { stopRemote() } else { pushRemoteState() }; return
        }
        if action == "codex" || action == "claude" { selectedAgent = action; requestConfiguration("add-agent"); return }
        requestConfiguration(action)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
        if target.isFileURL {
            decisionHandler(webView === self.webView && authenticating && target.standardizedFileURL == connectFile.standardizedFileURL ? .allow : .cancel); return
        }
        let local = target.scheme == "http" && target.host == "127.0.0.1" && target.port == 61192
        let owned = webView === self.webView || utilityViews.values.contains { $0 === webView }
        if owned && local && navigationAction.navigationType == .linkActivated && navigationAction.targetFrame?.isMainFrame == true && target.path == "/setup" {
            decisionHandler(.cancel); showSettings(); return
        }
        if owned && desktopSetupNeedsKey(target, setupKey: setupKey), navigationAction.targetFrame?.isMainFrame == true, let keyed = desktopLocalURL(path: "/setup", setupKey: setupKey) {
            decisionHandler(.cancel); webView.load(URLRequest(url: keyed)); return
        }
        if webView !== self.webView && local && target.path == "/workspace" { decisionHandler(.cancel); if self.webView.url?.path == "/workspace" { showLocal() } else { restoreDesktop() }; return }
        if webView === self.webView && local && target.path == "/workspace" && navigationAction.targetFrame?.isMainFrame == true && !authenticating {
            decisionHandler(.cancel); restoreDesktop(); return
        }
        switch desktopNavigation(target, mainFrame: navigationAction.targetFrame?.isMainFrame == true, linkActivated: navigationAction.navigationType == .linkActivated) {
        case .allow: decisionHandler(.allow)
        case .openExternally: decisionHandler(.cancel); NSWorkspace.shared.open(target)
        case .cancel: decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateLocalLabel(); refreshPanelControls()
        guard webView === self.webView else { return }
        if authenticating && webView.url?.isFileURL == true {
            // Only the exact app-generated one-use grant file is ever loaded as file:.
            webView.evaluateJavaScript("document.forms[0].submit()") { [weak self] _, error in
                if error != nil { self?.authenticating = false; self?.localPageReady = true; self?.renderScreen(); self?.status.stringValue = "작업 연결 실패 · 다시 연결을 눌러 주세요." }
            }
        } else {
            authenticating = false; localPageReady = true; renderScreen(); status.stringValue = ""
            if reopenDevicesAfterRestart && webView.url?.path == "/workspace" { reopenDevicesAfterRestart = false; showDeviceConnection() }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === self.webView { authenticating = false }
        if webView === self.webView { status.stringValue = "작업 화면 연결 실패 · 다시 연결해 주세요." }
        // Static local explanation only. Never include a failed URL, credential or server error body.
        webView.loadHTMLString("<html lang='ko'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><body style='background:#191e17;color:#e7e9e3;font:16px system-ui;padding:15vh 10vw'><span id='connection' data-connection-state='unavailable' hidden></span><h1>작업 화면을 열 수 없습니다</h1><p>이 Mac의 Maricode 작업 서버가 아직 준비되지 않았거나 멈췄습니다.</p><p>왼쪽 하단 메뉴에서 ‘작업 화면 다시 연결’을 눌러 주세요.</p></body></html>", baseURL: nil)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let target = navigationAction.request.url,
           target.scheme == "https" || (target.scheme == "http" && target.host == "127.0.0.1" && target.port == 61192) {
            // Outside links, including other Maricode servers, open in the browser instead of replacing the app view.
            if target.scheme == "https" { NSWorkspace.shared.open(target) }
            else { webView.load(navigationAction.request) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = "작업 확인"; alert.informativeText = message
        alert.addButton(withTitle: "확인"); alert.addButton(withTitle: "취소")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = "Maricode"; alert.informativeText = message
        alert.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { answer in completionHandler(answer == .OK ? panel.urls : nil) }
    }

    @objc func showAppUpdates() { appUpdater.showFromMenu() }
    @objc func openUserGuide() {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("USER-GUIDE.txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let dialog = NSAlert(); dialog.messageText = "Maricode 설치·사용 안내"
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 540, height: 380))
        scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        let view = NSTextView(frame: scroll.bounds); view.string = text; view.isEditable = false
        view.font = .systemFont(ofSize: 14); view.isVerticallyResizable = true
        view.textContainer?.widthTracksTextView = true
        scroll.documentView = view; dialog.accessoryView = scroll
        dialog.addButton(withTitle: "닫기"); dialog.runModal()
    }
    @objc func openNotices() {
        if let url = Bundle.main.resourceURL?.appendingPathComponent("NOTICES.txt") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }
    func dataDirectory() -> String {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--data-directory"), args.count > i + 1 { return args[i+1] }
        return defaultDataDirectory(support: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0], release: Bundle.main.object(forInfoDictionaryKey: "MARICODERelease") as? Bool == true)
    }
    @objc func showFileAccessHelp() {
        let guide = NSAlert(); guide.messageText = "파일·폴더 접근 허용 확인"
        guide.informativeText = "macOS 접근 요청이 뜨면 요청한 앱과 폴더를 확인하고 필요한 범위만 허용하세요.\n\n이미 거절했다면 시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더에서 요청한 앱의 해당 항목을 확인하세요. 실행 방식에 따라 Maricode 또는 실행 도구 이름으로 나타날 수 있습니다.\n\n목록에 없다면 작업 폴더를 다시 선택하세요. Finder의 정보 가져오기 → 공유 및 사용 권한, 외장 디스크 연결 상태도 확인하세요. 전체 디스크 접근 권한을 기본으로 요구하지 않습니다.\n\n허용 후 이 앱으로 돌아와 이전 작업의 저장·접수 상태를 먼저 확인하고 필요한 작업만 다시 시도하세요. 자동 재실행하지 않습니다. AI 도구 승인과 서버의 허용 경로는 별도이며 macOS 허용으로 해제되지 않습니다. 원격 접속 중이라면 파일이 있는 서버 Mac에서 확인하세요."
        guide.addButton(withTitle: "확인"); guide.addButton(withTitle: "시스템 설정 열기")
        if guide.runModal() == .alertSecondButtonReturn {
            NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
        }
    }
    func chooseAgentBinary(_ agent: String) -> String? {
        let home = NSHomeDirectory()
        let candidates = installedAgentCandidates(agent, directories: [home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", home + "/.npm-global/bin"])
        if !candidates.isEmpty {
            let dialog = NSAlert(); dialog.messageText = "설치된 \(agent) 후보를 찾았습니다"
            dialog.informativeText = "사용할 경로를 확인하세요. 아직 실행하거나 로그인하지 않습니다. 다른 위치에 설치했다면 직접 선택할 수 있습니다."
            let paths = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 430, height: 28))
            paths.addItems(withTitles: candidates); dialog.accessoryView = paths
            dialog.addButton(withTitle: "이 경로 사용"); dialog.addButton(withTitle: "직접 찾기"); dialog.addButton(withTitle: "취소")
            let answer = dialog.runModal()
            if answer == .alertFirstButtonReturn { return paths.titleOfSelectedItem }
            if answer != .alertSecondButtonReturn { return nil }
        }
        let panel = NSOpenPanel(); panel.title = "설치된 \(agent) 실행 파일 선택"
        panel.message = "실행 파일을 선택하세요. 설치되지 않았다면 취소 후 공식 설치를 먼저 완료하세요. 자동 설치는 하지 않습니다."
        panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.allowsMultipleSelection = false; panel.showsHiddenFiles = true; panel.prompt = "선택"
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
    func writeConfiguration(_ values: [String: String]) -> Bool {
        guard let resources = Bundle.main.resourceURL else { return false }
        let p = Process(), pipe = Pipe()
        p.executableURL = resources.appendingPathComponent("node")
        p.arguments = [resources.appendingPathComponent("source/apps/mac-launcher/configure.mjs").path]
        p.environment = ["PATH":"/usr/bin:/bin", "HOME":NSHomeDirectory(), "LANG":"en_US.UTF-8"]
        p.standardInput = pipe; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do {
            let payload = try JSONSerialization.data(withJSONObject: values)
            try p.run(); try pipe.fileHandleForWriting.write(contentsOf: payload); try pipe.fileHandleForWriting.close(); p.waitUntilExit()
            if p.terminationStatus == 13 { showFileAccessHelp() }
            return p.terminationStatus == 0
        } catch { return false }
    }
    func initializeLocal() {
        guard process == nil else { return }
        if !writeConfiguration(["action":"initialize", "directory":dataDirectory(), "binary":"bundled:hapi"]) {
            status.stringValue = "로컬 작업 공간을 준비하지 못했습니다. 기존 설정은 유지됩니다."
        }
    }
    func chooseClaudeSource(_ requestId: String) {
        let target = webView!, address = webView.url
        var selected: String? = nil
        if !stopping && !quitting {
            let panel = NSOpenPanel(); panel.title = "Claude 기록 저장 폴더 선택"
            panel.message = "projects 폴더가 들어 있는 Claude 설정 폴더를 선택하세요. 숨김 폴더도 표시됩니다. 기록을 검색할 뿐 계정이나 설정을 변경하지 않습니다."
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.showsHiddenFiles = true; panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser; panel.prompt = "이 폴더에서 찾기"
            if panel.runModal() == .OK { selected = panel.url?.path }
        }
        guard target === webView, target.url == address else { return }
        let payload: [String: Any] = ["requestId":requestId, "path":selected as Any? ?? NSNull()]
        if let data = try? JSONSerialization.data(withJSONObject: payload), let detail = String(data:data, encoding:.utf8) {
            target.evaluateJavaScript("window.dispatchEvent(new CustomEvent('maricode-claude-source-selected',{detail:\(detail)}))", completionHandler: nil)
        }
    }
    func addProjectFolder() {
        guard !stopping else { return }
        let panel = NSOpenPanel(); panel.title = "프로젝트 폴더 추가"
        panel.message = "이 Mac의 기존 폴더를 프로젝트로 등록합니다. Git 브랜치나 AI 세션은 만들지 않습니다."
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false; panel.prompt = "프로젝트 추가"
        guard panel.runModal() == .OK, let folder = panel.url?.resolvingSymlinksInPath().path else { return }
        if writeConfiguration(["action":"add-project", "directory":dataDirectory(), "project":folder]) {
            if let data = try? JSONSerialization.data(withJSONObject: ["path":folder]), let detail = String(data:data, encoding:.utf8) {
                webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('maricode-projects-changed',{detail:\(detail)}))", completionHandler: nil)
            }
            status.stringValue = ""
        } else { status.stringValue = "프로젝트를 추가하지 못했습니다. 폴더 접근 권한과 저장 상태를 확인하세요." }
    }

    @objc func configureLocal() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let directory = dataDirectory()
        if FileManager.default.fileExists(atPath: directory + "/backend.json") {
            status.stringValue = "이 Mac의 실행 설정이 이미 있습니다. 기존 설정을 보존합니다. Maricode 화면을 시작하세요."; return
        }
        let choice = NSAlert()
        choice.messageText = "처음 사용할 AI를 선택하세요"
        choice.informativeText = "HAPI가 앱에 포함되어 있으면 자동 사용합니다. 설치된 AI 실행 파일과 작업 폴더를 선택하고, HAPI 미포함 개발 빌드만 HAPI 파일을 추가 선택합니다. Maricode 전용 계정 폴더를 만들며 기존 로그인은 복사하지 않습니다. 저장 뒤 웹 설정에서 공식 로그인을 진행하세요. 새 설치나 작업 실행은 하지 않습니다. 원격으로만 사용할 경우 취소 후 Maricode 화면을 시작하세요."
        choice.addButton(withTitle: "Codex"); choice.addButton(withTitle: "Claude"); choice.addButton(withTitle: "취소")
        let answer = choice.runModal()
        guard answer == .alertFirstButtonReturn || answer == .alertSecondButtonReturn else { return }
        let agent = answer == .alertFirstButtonReturn ? "codex" : "claude"
        func choose(_ title: String, folder: Bool) -> String? {
            let panel = NSOpenPanel(); panel.title = title; panel.message = title
            panel.canChooseDirectories = folder; panel.canChooseFiles = !folder; panel.allowsMultipleSelection = false
            panel.prompt = "선택"; panel.showsHiddenFiles = true
            return panel.runModal() == .OK ? panel.url?.path : nil
        }
        let includedHapi = resources.appendingPathComponent("hapi/hapi").path
        let hapiSelection: String? = FileManager.default.isExecutableFile(atPath: includedHapi) ? "bundled:hapi" : choose("설치된 HAPI 실행 파일 선택", folder: false)
        guard let binary = hapiSelection,
              let agentBinary = chooseAgentBinary(agent),
              let project = choose("AI가 작업할 프로젝트 폴더 선택", folder: true) else { return }
        let confirm = NSAlert(); confirm.messageText = "이 구성으로 저장할까요?"
        let hapiLabel = binary == "bundled:hapi" ? "앱에 포함된 HAPI" : binary
        confirm.informativeText = "HAPI: \(hapiLabel)\nAI: \(agentBinary)\n프로젝트: \(project)\n\n파일 선택만으로 설치·로그인·작업을 시작하지 않습니다."
        confirm.addButton(withTitle: "저장"); confirm.addButton(withTitle: "취소")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        let p = Process(), pipe = Pipe()
        p.executableURL = resources.appendingPathComponent("node")
        p.arguments = [resources.appendingPathComponent("source/apps/mac-launcher/configure.mjs").path]
        p.environment = ["PATH":"/usr/bin:/bin", "HOME":NSHomeDirectory(), "LANG":"en_US.UTF-8"]
        p.standardInput = pipe; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do {
            let data = try JSONSerialization.data(withJSONObject: ["directory":directory,"binary":binary,"agent":agent,"agentBinary":agentBinary,"project":project])
            try p.run(); try pipe.fileHandleForWriting.write(contentsOf: data); try pipe.fileHandleForWriting.close(); p.waitUntilExit()
            if p.terminationStatus == 13 { status.stringValue = "파일·폴더 또는 실행 파일의 접근이 거부됐습니다. 권한 안내를 확인하세요."; showFileAccessHelp(); return }
            status.stringValue = p.terminationStatus == 0 ? "설정 저장 완료 · Maricode 화면 시작 → AI 연결 상태 확인 → 공식 로그인 → Runner 준비 순서로 진행하세요." : "설정 저장 실패 · 실행 파일, 작업 폴더와 기존 실행/설정을 확인하세요. 기존 설정은 교체하지 않았습니다."
        } catch { status.stringValue = "설정 저장 결과를 확인하지 못했습니다. 실행 폴더를 확인하세요." }
    }
    @objc func addLocalAgent() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let directory = dataDirectory()
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: directory + "/local-setup/accounts.json")),
              let config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let binaries = config["binaries"] as? [String: String] else {
            status.stringValue = "먼저 이 Mac의 AI 작업 설정을 저장하세요. 외부에서 구성한 기존 설정은 변경하지 않습니다."; return
        }
        let missing = ["codex", "claude"].filter { binaries[$0] == nil }
        let requested = selectedAgent; selectedAgent = nil
        guard let agent = requested ?? missing.first, missing.contains(agent) else { status.stringValue = "선택한 AI가 이미 등록되어 있습니다."; return }
        guard let binary = chooseAgentBinary(agent) else { return }
        let confirm = NSAlert(); confirm.messageText = "\(agent)를 추가할까요?"
        confirm.informativeText = "실행 파일: \(binary)\n\n기존 AI 계정·프로젝트·세션을 유지합니다. 추가 후 AI 계정 연결에서 공식 로그인을 확인하고 새 세션을 만드세요. 지금 로그인하거나 실행하지 않습니다."
        confirm.addButton(withTitle: "추가"); confirm.addButton(withTitle: "취소")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        let p = Process(), pipe = Pipe()
        p.executableURL = resources.appendingPathComponent("node")
        p.arguments = [resources.appendingPathComponent("source/apps/mac-launcher/configure.mjs").path]
        p.environment = ["PATH":"/usr/bin:/bin", "HOME":NSHomeDirectory(), "LANG":"en_US.UTF-8"]
        p.standardInput = pipe; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do {
            let payload = try JSONSerialization.data(withJSONObject: ["action":"add-agent","directory":directory,"agent":agent,"agentBinary":binary])
            try p.run(); try pipe.fileHandleForWriting.write(contentsOf: payload); try pipe.fileHandleForWriting.close(); p.waitUntilExit()
            if p.terminationStatus == 13 { status.stringValue = "파일·폴더 또는 실행 파일의 접근이 거부됐습니다. 권한 안내를 확인하세요."; showFileAccessHelp(); return }
            status.stringValue = p.terminationStatus == 0 ? "\(agent) 추가 완료 · AI 계정 연결에서 로그인 상태를 확인하고 새 세션을 만드세요." : "AI 추가 실패 · 실행 중인지, 이미 등록됐는지, 실행 파일과 기존 설정을 확인하세요."
        } catch { status.stringValue = "AI 추가 결과를 확인하지 못했습니다. 다시 실행하기 전에 설정을 확인하세요." }
    }
    @objc func changeLocalProject() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let directory = dataDirectory()
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: directory + "/local-setup/accounts.json")),
              let config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let oldProject = config["cwd"] as? String else {
            status.stringValue = "먼저 이 Mac의 AI 작업 설정을 저장하세요."; return
        }
        let panel = NSOpenPanel(); panel.title = "새 기본 작업 폴더 선택"
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: oldProject); panel.prompt = "선택"
        guard panel.runModal() == .OK, let project = panel.url?.path else { return }
        if project == oldProject { status.stringValue = "같은 작업 폴더입니다. 설정을 변경하지 않았습니다."; return }
        let confirm = NSAlert(); confirm.messageText = "기본 작업 폴더를 변경할까요?"
        confirm.informativeText = "현재: \(oldProject)\n변경: \(project)\n\n기존 파일·대화·계정은 옮기거나 삭제하지 않습니다. 새 폴더는 다음 Runner 준비에 적용됩니다. 저장 후 웹 설정에서 Runner를 다시 준비하세요."
        confirm.addButton(withTitle: "변경"); confirm.addButton(withTitle: "취소")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        let p = Process(), pipe = Pipe()
        p.executableURL = resources.appendingPathComponent("node")
        p.arguments = [resources.appendingPathComponent("source/apps/mac-launcher/configure.mjs").path]
        p.environment = ["PATH":"/usr/bin:/bin", "HOME":NSHomeDirectory(), "LANG":"en_US.UTF-8"]
        p.standardInput = pipe; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do {
            let payload = try JSONSerialization.data(withJSONObject: ["action":"change-project","directory":directory,"project":project,"expectedProject":oldProject])
            try p.run(); try pipe.fileHandleForWriting.write(contentsOf: payload); try pipe.fileHandleForWriting.close(); p.waitUntilExit()
            if p.terminationStatus == 13 { status.stringValue = "파일·폴더 또는 실행 파일의 접근이 거부됐습니다. 권한 안내를 확인하세요."; showFileAccessHelp(); return }
            status.stringValue = p.terminationStatus == 0 ? "기본 작업 폴더 변경 완료 · 웹 설정에서 Runner를 다시 준비하세요. 기존 대화는 원래 폴더에 남습니다." : "폴더 변경 실패 · 실행/로그인 중인지, 설정이 바뀌었는지, 폴더가 있는지 확인하세요."
        } catch { status.stringValue = "폴더 변경 결과를 확인하지 못했습니다. 다시 실행하기 전에 설정을 확인하세요." }
    }
    @objc func configureRemote() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let directory = dataDirectory(), path = dataDirectory() + "/remote.json"
        var previous: String? = nil
        if FileManager.default.fileExists(atPath: path) {
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
                  let config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  config["version"] as? Int == 1 else { status.stringValue = "기존 원격 설정을 읽을 수 없습니다. 원본을 보존해 점검하세요."; return }
            previous = config["origin"] as? String
        }
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 26))
        field.stringValue = previous ?? tailscaleSelfAddress() ?? ""; field.placeholderString = "https://기기.사설망.ts.net:포트"
        let prompt = NSAlert(); prompt.messageText = "Tailscale HTTPS 주소"
        prompt.informativeText = "이 Maricode 실행기에 사용할 주소를 등록합니다. 주소 등록만으로 연결되지는 않습니다. 서버 역할과 이 앱의 127.0.0.1:61192로 전달하는 HTTPS 설정이 별도로 필요합니다. 기존 Serve 설정은 변경하지 않습니다."
        prompt.accessoryView = field
        prompt.addButton(withTitle: "주소 등록"); prompt.addButton(withTitle: "등록 해제"); prompt.addButton(withTitle: "취소")
        let answer = prompt.runModal()
        guard answer == .alertFirstButtonReturn || answer == .alertSecondButtonReturn else { return }
        let next: String? = answer == .alertFirstButtonReturn ? field.stringValue : nil
        let confirm = NSAlert(); confirm.messageText = next == nil ? "원격 주소 등록을 해제할까요?" : "이 주소에서 Maricode 접속을 허용할까요?"
        confirm.informativeText = "현재: \(previous ?? "미등록")\n변경: \(next ?? "미등록")\n\n다음 실행부터 적용됩니다. 서버 역할이 켜져 있어야 원격 작업을 사용할 수 있으며 HAPI 인증은 계속 필요합니다. 주소 해제는 Tailscale의 포트 전달 설정을 삭제하지 않습니다."
        confirm.addButton(withTitle: "저장"); confirm.addButton(withTitle: "취소")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        let p = Process(), pipe = Pipe()
        p.executableURL = resources.appendingPathComponent("node")
        p.arguments = [resources.appendingPathComponent("source/apps/mac-launcher/configure.mjs").path]
        p.environment = ["PATH":"/usr/bin:/bin", "HOME":NSHomeDirectory(), "LANG":"en_US.UTF-8"]
        p.standardInput = pipe; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do {
            let payload: [String: Any] = ["action":"remote-origin", "directory":directory, "origin":next as Any? ?? NSNull(), "expected":previous as Any? ?? NSNull()]
            try p.run(); try pipe.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: payload)); try pipe.fileHandleForWriting.close(); p.waitUntilExit()
            if p.terminationStatus == 13 { status.stringValue = "파일·폴더 또는 실행 파일의 접근이 거부됐습니다. 권한 안내를 확인하세요."; showFileAccessHelp(); return }
            status.stringValue = p.terminationStatus == 0 ? "원격 주소 설정 저장 완료 · 다음 실행부터 적용됩니다. 실제 HTTPS 연결은 별도 확인이 필요합니다." : "주소 저장 실패 · 경로·인증정보 없는 Tailscale HTTPS 주소인지, 실행 중이거나 설정이 변경됐는지 확인하세요."
        } catch { status.stringValue = "주소 저장 결과를 확인하지 못했습니다. 다시 시도하기 전에 설정을 확인하세요." }
    }
    // Pre-fills the address prompt only; the user still confirms it.
    func tailscaleSelfAddress() -> String? {
        let tool = Process(), out = Pipe()
        tool.executableURL = URL(fileURLWithPath: "/Applications/Tailscale.app/Contents/MacOS/Tailscale")
        tool.arguments = ["status", "--json"]; tool.standardOutput = out; tool.standardError = FileHandle.nullDevice
        guard (try? tool.run()) != nil else { return nil }
        let deadline = Date().addingTimeInterval(3)
        while tool.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if tool.isRunning { tool.terminate(); return nil }
        return tailscaleSelfOrigin(out.fileHandleForReading.readDataToEndOfFile())
    }
    func reportPairing(_ request: String, ready: Bool) {
        guard UUID(uuidString: request) != nil else { return }
        webView.evaluateJavaScript("void window.maricodePairingReady?.('\(request)', \(ready ? "true" : "false"))", completionHandler: nil)
    }
    func showPairingQR(_ code: String) {
        guard let info = try? RemoteConnection.read(directory: dataDirectory()) else {
            status.stringValue = "QR을 만들려면 먼저 ‘다른 기기 연결’ 창에서 Tailscale 주소를 등록하세요."; return
        }
        guard let link = pairingInstallURL(origin: info.address, code: code), let filter = CIFilter(name: "CIQRCodeGenerator") else { return }
        filter.setValue(Data(link.utf8), forKey: "inputMessage"); filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return }
        let rep = NSCIImageRep(ciImage: output), image = NSImage(size: NSSize(width: 240, height: 240)); image.addRepresentation(rep)
        let view = NSImageView(frame: NSRect(x: 0, y: 0, width: 240, height: 240)); view.image = image; view.imageScaling = .scaleProportionallyUpOrDown
        view.setAccessibilityLabel("다른 기기 연결 QR 코드")
        let prompt = NSAlert(); prompt.messageText = "휴대폰 카메라로 찍어 연결하세요"
        prompt.informativeText = "\(link)\n\n설치 안내가 열리고 이 코드로 로그인합니다. 코드는 5분 동안 한 번만 쓸 수 있습니다. 같은 Tailscale에 연결된 기기에서만 열립니다."
        prompt.accessoryView = view
        prompt.addButton(withTitle: "닫기"); prompt.addButton(withTitle: "링크 복사")
        if prompt.runModal() == .alertSecondButtonReturn {
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(link, forType: .string)
            status.stringValue = "연결 링크를 복사했습니다. 코드가 들어 있으니 신뢰하는 기기에만 보내세요."
        }
    }
    func applicationWillTerminate(_ notification: Notification) { connectionTimer?.invalidate() }
    @objc func startRemote() {
        guard process != nil, !stopping, let info = try? RemoteConnection.read(directory: dataDirectory()) else {
            status.stringValue = "먼저 Maricode 화면을 시작하고 서버 역할·원격 주소를 설정하세요."; return
        }
        let prompt = NSAlert(); prompt.messageText = "사설망 HTTPS 전달을 시작할까요?"
        prompt.informativeText = "\(info.address) → 이 앱의 로컬 웹 화면\n\n같은 Tailscale 사설망에서 접근할 수 있게 됩니다. HAPI 인증은 계속 필요합니다. 기존 Serve 설정이 있으면 시작하지 않습니다. Tailscale 설치·가입·HTTPS 승인이 필요하면 직접 완료해야 합니다."
        prompt.addButton(withTitle: "시작"); prompt.addButton(withTitle: "취소")
        guard prompt.runModal() == .alertFirstButtonReturn else { return }
        remoteStart.isEnabled = false; remoteStop.isEnabled = false
        do { try input?.fileHandleForWriting.write(contentsOf: Data(("remote-start " + info.address + "\n").utf8)) }
        catch { remoteStop.isEnabled = true; status.stringValue = "전달 시작 요청 결과가 불확실합니다. 전달 종료로 상태를 확인하세요." }
    }
    @objc func stopRemote() {
        guard process != nil, !stopping else { return }
        let prompt = NSAlert(); prompt.messageText = "이 앱의 HTTPS 전달을 종료할까요?"
        prompt.informativeText = "원격 화면의 연결이 끊어집니다. AI 작업 자체는 종료하지 않습니다. 다른 앱이 설정한 전달은 변경하지 않습니다."
        prompt.addButton(withTitle: "전달 종료"); prompt.addButton(withTitle: "취소")
        guard prompt.runModal() == .alertFirstButtonReturn else { return }
        remoteStart.isEnabled = false; remoteStop.isEnabled = false
        do { try input?.fileHandleForWriting.write(contentsOf: Data("remote-stop\n".utf8)) }
        catch { remoteStop.isEnabled = true; status.stringValue = "전달 종료 요청 결과가 불확실합니다. 다시 상태를 확인하세요." }
    }
    @objc func startWeb() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let directory = dataDirectory()
        guard directory.hasPrefix("/") else { status.stringValue = "실행 자료 폴더는 절대 경로여야 합니다."; return }
        let p = Process(); let stdin = Pipe(); let stdout = Pipe()
        p.executableURL = resources.appendingPathComponent("node")
        p.arguments = [resources.appendingPathComponent("source/apps/mac-launcher/runtime.mjs").path, directory, "61192"]
        if Bundle.main.object(forInfoDictionaryKey: "MARICODERelease") as? Bool == true,
           Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == "1.1.0" {
            p.arguments?.append("--clean-start-1.1.0")
        }
        // Do not inherit credentials or Node startup hooks from the launching shell.
        p.environment = ["PATH":"/usr/bin:/bin:/usr/sbin:/sbin", "HOME":NSHomeDirectory(), "LANG":"en_US.UTF-8"]
        // External CLI discovery only; AI execution keeps its isolated profile.
        for key in ["CLAUDE_CONFIG_DIR", "ZDOTDIR"] {
            if let value = ProcessInfo.processInfo.environment[key], value.hasPrefix("/") || value.hasPrefix("~/") { p.environment?[key] = value }
        }
        p.standardInput = stdin; p.standardOutput = stdout; p.standardError = FileHandle.nullDevice
        pairingRequestID = nil; remoteConfirmed = false
        received = ""; input = stdin; output = stdout; process = p; stopping = false
        configure.isEnabled = false; addAgent.isEnabled = false; changeProject.isEnabled = false; remoteSettings.isEnabled = false; start.isEnabled = false; status.stringValue = "작업 화면 시작 중…"
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                guard let self, self.process === p else { return }
                self.received += text
                while let end = self.received.firstIndex(of: "\n") {
                    let line = String(self.received[..<end])
                    self.received.removeSubrange(...end)
                if let key = desktopSetupKey(line: line) {
                    // A restarted launcher has a new key: an open settings page is reopened with it.
                    let changed = self.setupKey != nil && self.setupKey != key
                    self.setupKey = key
                    if changed, let settings = self.utilityViews["settings"], settings.url?.path == "/setup", let target = desktopLocalURL(path: "/setup", setupKey: key) { settings.load(URLRequest(url: target)) }
                }
                if line == "APP_RESET" { self.appResetPending = true }
                if line == "READY http://127.0.0.1:61192" && !self.stopping {
                    self.url = URL(string: "http://127.0.0.1:61192/setup")
                    self.status.stringValue = "실행 중 · 이 Mac의 127.0.0.1:61192"
                    self.open.isEnabled = true; self.stop.isEnabled = true; self.connect.isEnabled = true; self.remoteStart.isEnabled = true
                    self.restoreAfterReleaseTransition()
                }
                if line == "REMOTE_STARTING" { self.remoteConfirmed = false; self.remoteStart.isEnabled = false; self.remoteStop.isEnabled = false; self.status.stringValue = "저장된 주소의 HTTPS 전달을 복원하고 있습니다… 로컬 작업은 계속할 수 있습니다."; self.pushRemoteState() }
                if line == "REMOTE_ON" { self.remoteConfirmed = true; self.remoteStart.isEnabled = false; self.remoteStop.isEnabled = true; self.status.stringValue = "HTTPS 전달 실행 중 · 등록 주소로 접속하세요. 원격 로그인은 별도로 필요합니다."; self.pushRemoteState() }
                if line == "REMOTE_OFF" { self.remoteConfirmed = false; self.remoteStart.isEnabled = true; self.remoteStop.isEnabled = false; self.status.stringValue = "이 앱의 HTTPS 전달을 종료했습니다. 로컬 작업은 유지됩니다."; self.pushRemoteState() }
                if line == "REMOTE_FAILED" { self.remoteConfirmed = false; self.remoteStart.isEnabled = true; self.remoteStop.isEnabled = false; self.status.stringValue = "전달을 시작하지 못했습니다. Tailscale 연결·기기 주소·서버 역할·기존 Serve 설정을 확인하세요. 기존 설정은 변경하지 않았습니다."; self.pushRemoteState() }
                if line == "REMOTE_UNKNOWN" { self.remoteConfirmed = false; self.remoteStart.isEnabled = false; self.remoteStop.isEnabled = true; self.status.stringValue = "HTTPS 전달 상태를 확인하지 못했습니다. 전달 종료로 소유 프로세스 정리를 확인하세요. 자동 재시작하지 않습니다."; self.pushRemoteState() }
                if line.hasPrefix("PAIRING_READY ") || line.hasPrefix("PAIRING_FAILED ") {
                    let request = String(line.split(separator: " ").last ?? "")
                    if self.pairingRequestID == request {
                        self.pairingRequestID = nil
                        self.reportPairing(request, ready: line.hasPrefix("PAIRING_READY ") && self.remoteConfirmed && self.savedRoles()["server"] == true)
                    }
                }
                if line == "CONNECT_READY" && !self.stopping {
                    self.connect.isEnabled = true
                    self.authenticating = true; self.localPageReady = false; self.renderScreen()
                    self.webView.loadFileURL(self.connectFile, allowingReadAccessTo: self.connectFile)
                }
                if line == "CONNECT_FAILED" { self.authenticating = false; self.loadDesktop("/setup"); self.connect.isEnabled = true; self.status.stringValue = "로컬 연결을 준비하지 못했습니다. 이 Mac의 AI 작업 설정을 확인하세요." }
                if line == "STOP_BLOCKED" {
                    self.stopping = false; self.pendingConfiguration = nil; self.connect.isEnabled = true
                    self.open.isEnabled = self.url != nil; self.stop.isEnabled = true
                    self.status.stringValue = "종료할 수 없습니다. 작업·승인·미확인 요청과 실행 상태를 웹 화면에서 확인한 뒤 다시 종료하세요."
                    if self.quitting {
                        self.quitting = false
                        if self.webView.url?.path == "/workspace" {
                            self.showLocal()
                            let nonce = UUID().uuidString; self.quitReviewNonce = nonce
                            self.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('maricode-close-request',{detail:'\(nonce)'}))", completionHandler: nil)
                        } else {
                            self.cancelUpdateInstallation()
                            let alert = NSAlert(); alert.messageText = "작업 화면에서 종료 상태를 확인해 주세요"
                            alert.informativeText = "이 Mac의 작업 화면에 연결한 뒤 다시 앱을 닫으면 종료할 세션을 확인할 수 있습니다. 미확인 작업이나 연결 오류가 있으면 강제로 종료하지 않습니다."
                            alert.addButton(withTitle: "작업 화면 열기"); alert.addButton(withTitle: "돌아가기")
                            if alert.runModal() == .alertFirstButtonReturn { self.showWorkspace() }
                        }
                    }
                    self.window.makeKeyAndOrderFront(nil)
                }
                }
            }
        }
        p.terminationHandler = { [weak self] p in DispatchQueue.main.async {
            guard let self else { return }
            self.output?.fileHandleForReading.readabilityHandler = nil
            self.runtimeExitIsSafe = p.terminationStatus == 0
            self.process = nil; self.input = nil; self.output = nil; self.url = nil
            self.remoteConfirmed = false
            if let request = self.pairingRequestID { self.reportPairing(request, ready: false); self.pairingRequestID = nil }
            self.remoteStart.isEnabled = false; self.remoteStop.isEnabled = false; self.open.isEnabled = false; self.stop.isEnabled = false; self.connect.isEnabled = false; self.start.isEnabled = true; self.configure.isEnabled = true; self.addAgent.isEnabled = true; self.changeProject.isEnabled = true; self.remoteSettings.isEnabled = true
            switch p.terminationStatus {
            case 0: self.status.stringValue = "작업 서버를 종료했습니다."
            case 21: self.status.stringValue = "기존 실행이나 미확인 작업이 남아 있어 시작을 보류했습니다. 이미 열린 Maricode 창에서 작업·종료 상태를 확인하세요. 안전을 확인한 이전 잠금은 자동 복구하며, 확인할 수 없는 기록은 보존합니다. 잠금을 임의로 지우지 마세요."
            case 22: self.status.stringValue = "Maricode에 필요한 포트를 다른 프로그램이 사용 중입니다. 이미 열린 Maricode 창을 확인하세요. 다른 프로그램을 자동 종료하지 않았습니다."
            case 23: self.status.stringValue = "이 앱으로 읽을 수 없는 데이터 형식입니다. 이 데이터를 마지막으로 사용한 버전으로 실행하세요. 문제가 계속되면 원본을 보존한 채 점검이 필요합니다."
            case 24: self.status.stringValue = "실행 설정을 읽을 수 없습니다. 기존 설정은 보존했습니다. 설정 파일을 삭제하거나 최초 설정을 반복하지 말고 점검해 주세요."
            case 25: self.status.stringValue = "시작 실패 후 전용 실행 환경의 종료를 확인하지 못했습니다. 진행 중 작업과 프로세스를 확인해야 합니다. 재시도하거나 잠금을 지우지 마세요."
            case 26: self.status.stringValue = "전용 HAPI를 시작하지 못했습니다. 등록한 HAPI 실행 파일과 전용 데이터의 접근 권한을 확인하세요. 기존 설정과 인증은 유지했습니다."
            case 27: self.status.stringValue = "실행 자료 폴더에 접근할 수 없습니다. 폴더와 접근 권한을 확인하세요."; self.showFileAccessHelp()
            case 28: self.status.stringValue = "1.1.0 초기 정리를 완료하지 못했습니다. 이전 Maricode와 공식 CLI·로그인 창을 정상 종료하고 폴더 접근 권한을 확인한 뒤 다시 실행하세요. 이미 시작한 정리는 기록을 이어 처리합니다. 외부 CLI와 작업 폴더는 삭제하지 않습니다."
            default: self.status.stringValue = "실행하지 못했습니다. 기존 데이터를 보존하고 실행 파일·폴더와 포트 상태를 확인하세요."
            }
            if self.quitting {
                let ready = self.finishUpdateInstallation(normalShutdown: p.terminationStatus == 0)
                if !ready { self.quitting = false; self.stopping = false }
                if ready { NSApp.terminate(nil) }
            }
            else if self.updateInstall.pending { self.quitReviewNonce = nil; self.cancelUpdateInstallation() }
            else if p.terminationStatus == 0, let action = self.pendingConfiguration {
                self.pendingConfiguration = nil; self.performConfiguration(action)
            }
        }}
        runtimeExitIsSafe = false
        do { try p.run() } catch {
            stdout.fileHandleForReading.readabilityHandler = nil; process = nil; input = nil; output = nil
            configure.isEnabled = true; addAgent.isEnabled = true; changeProject.isEnabled = true; remoteSettings.isEnabled = true; start.isEnabled = true; status.stringValue = "포함된 Node 실행 파일을 시작하지 못했습니다."
        }
    }
    @objc func connectWorkspace() {
        guard process != nil, !stopping, !authenticating else { return }
        authenticating = true; connect.isEnabled = false
        do { try input?.fileHandleForWriting.write(contentsOf: Data("connect\n".utf8)) }
        catch { authenticating = false; connect.isEnabled = true; status.stringValue = "연결 요청 전달 실패 · 다시 확인하세요." }
    }
    @objc func openWeb() { loadDesktop("/setup") }
    @objc func stopWeb() {
        guard process != nil, !stopping else { return }
        stopping = true; connect.isEnabled = false; stop.isEnabled = false; open.isEnabled = false; status.stringValue = "이 앱의 작업 서버 종료 중…"
        do { try input?.fileHandleForWriting.write(contentsOf: Data("quit\n".utf8)) } catch {
            stopping = false; stop.isEnabled = true; open.isEnabled = url != nil
            status.stringValue = "종료 요청 전달 실패 · 강제로 다른 프로세스를 종료하지 않습니다."
            if quitting { quitting = false; cancelUpdateInstallation() }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if process != nil { NSApp.terminate(nil); return false }
        return true
    }
    func cancelUpdateInstallation() {
        guard updateInstall.pending else { return }
        updateInstall.cancel(); appUpdater.installationCancelled("종료를 취소하여 설치하지 않았습니다. 준비된 설치 파일은 유지됩니다.")
    }
    func finishUpdateInstallation(normalShutdown: Bool) -> Bool {
        let ready = updateInstall.finish(normalShutdown: normalShutdown) { NSWorkspace.shared.open($0) }
        if !ready {
            appUpdater.installationCancelled("정상 종료 또는 설치 파일 열기를 확인하지 못했습니다. 앱을 열어 두었습니다.")
            appUpdater.show()
        }
        return ready
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard quitReviewNonce == nil else { return .terminateCancel }
        guard process != nil else { return finishUpdateInstallation(normalShutdown: runtimeExitIsSafe) ? .terminateNow : .terminateCancel }
        // terminateLater enters AppKit's termination loop, which can starve the
        // main-queue pipe/process callbacks needed to finish this shutdown.
        // Decline this attempt, keep the normal event loop alive, then terminate
        // again only after the owned runtime has actually exited.
        guard !quitting else { return .terminateCancel }
        quitting = true; stopWeb(); return .terminateCancel
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
@main
struct MerryApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate = MerryDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
