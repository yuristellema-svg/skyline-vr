import SwiftUI
import WebKit
import Security

@MainActor
final class BrowserModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    @Published var address = "https://m.youtube.com"
    @Published var loading = false
    @Published var backAvailable = false
    @Published var forwardAvailable = false
    @Published var progress: Double = 0
    @Published var errorText: String?

    let webView: WKWebView
    private static let bridgeName = "focusBridge"
    private var progressObservation: NSKeyValueObservation?

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        // Isolated content world: webpages cannot read the API key or call our native bridge.
        let world = WKContentWorld.defaultClient
        let controller = WKUserContentController()
        let bootstrap = Self.bridgeJavaScript
        controller.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart,
                                             forMainFrameOnly: true, in: world))
        if let url = Bundle.main.url(forResource: "QuietSearch", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source,
                                                 injectionTime: .atDocumentStart,
                                                 forMainFrameOnly: true, in: world))
        }
        config.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        controller.addScriptMessageHandler(self, contentWorld: world, name: Self.bridgeName)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
            DispatchQueue.main.async { self?.progress = view.estimatedProgress }
        }
        goHome()
    }

    private static let bridgeJavaScript = #"""
    (() => {
      const bridge = data => window.webkit.messageHandlers.focusBridge.postMessage(data);
      globalThis.GM = {
        getValue: (key, defaultValue) => bridge({kind:'get',key:String(key),fallback: defaultValue ?? null})
          .then(r => r?.value === null || r?.value === undefined ? defaultValue : r.value),
        setValue: (key, value) => bridge({kind:'set',key:String(key),value:value}).then(() => undefined),
        xmlHttpRequest: (opts) => bridge({kind:'request',url:opts.url,method:opts.method,
             headers:opts.headers||{},data:opts.data||'',timeout:opts.timeout||7000})
          .then(r => ({status:r.status||0,responseText:r.responseText||'',response:r.responseText||''}))
      };
    })();
    """#

    func goHome() { navigate("https://m.youtube.com") }

    func navigate(_ raw: String) {
        errorText = nil
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        let urlText: String
        if s.hasPrefix("https://") || s.hasPrefix("http://") {
            urlText = s
        } else if s.contains(".") && !s.contains(" ") {
            urlText = "https://" + s
        } else {
            let q = s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            urlText = "https://www.google.com/search?q=" + q
        }
        guard let url = URL(string: urlText), ["http", "https"].contains(url.scheme ?? "") else { return }
        webView.load(URLRequest(url: url))
    }

    func goBack() { if webView.canGoBack { webView.goBack() } }
    func goForward() { if webView.canGoForward { webView.goForward() } }
    func reload() { webView.reload() }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true
        progress = 0.05
        errorText = nil
        updateState(webView)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        updateState(webView)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(webView, error: error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(webView, error: error)
    }
    private func handleNavigationFailure(_ webView: WKWebView, error: Error) {
        loading = false
        let e = error as NSError
        if e.code != NSURLErrorCancelled { errorText = error.localizedDescription }
        updateState(webView)
    }
    private func updateState(_ view: WKWebView) {
        backAvailable = view.canGoBack
        forwardAvailable = view.canGoForward
        if let s = view.url?.absoluteString, s != "about:blank" { address = s }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(), !["http", "https", "about"].contains(scheme) {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    // Deliberately no in-app disable, pause or allowlist switch.
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let payload = message.body as? [String: Any], let kind = payload["kind"] as? String else {
            replyHandler(nil, "Invalid bridge request")
            return
        }
        let key = payload["key"] as? String ?? ""
        switch kind {
        case "get":
            if key == "focus_guard_ct_ai_v3_key" {
                replyHandler(["value": Keychain.get(key) ?? ""], nil)
            } else {
                replyHandler(["value": UserDefaults.standard.object(forKey: "qs." + key) ?? NSNull()], nil)
            }
        case "set":
            if key == "focus_guard_ct_ai_v3_key" {
                Keychain.put(payload["value"] as? String ?? "", for: key)
            } else if let value = payload["value"], !(value is NSNull) {
                UserDefaults.standard.set(value, forKey: "qs." + key)
            }
            replyHandler(["ok": true], nil)
        case "request":
            // Hard-coded endpoint; no third-party endpoint can be called from webpages.
            guard (payload["url"] as? String) == "https://api.openai.com/v1/responses",
                  (payload["method"] as? String)?.uppercased() == "POST" else {
                replyHandler(["status": 403, "responseText": ""], nil)
                return
            }
            var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
            request.httpMethod = "POST"
            request.timeoutInterval = min(max(Double(payload["timeout"] as? Int ?? 7000) / 1000, 2), 10)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let headers = payload["headers"] as? [String: String],
               let authorization = headers["Authorization"], authorization.hasPrefix("Bearer sk-") {
                request.setValue(authorization, forHTTPHeaderField: "Authorization")
            }
            request.httpBody = (payload["data"] as? String ?? "").data(using: .utf8)
            URLSession.shared.dataTask(with: request) { data, response, error in
                // The userscript's own API fail-open behavior remains unchanged.
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let result: [String: Any] = ["status": status,
                    "responseText": data.flatMap { String(data: $0, encoding: .utf8) } ?? ""]
                replyHandler(result, nil)
            }.resume()
        default:
            replyHandler(nil, "Unknown bridge operation")
        }
    }
}

private enum Keychain {
    static func get(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
             kSecAttrService as String: "nl.focusbrowser.app",
             kSecAttrAccount as String: key,
             kSecReturnData as String: true,
             kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func put(_ value: String, for key: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
             kSecAttrService as String: "nl.focusbrowser.app",
             kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        if !value.isEmpty {
            var record = query
            record[kSecValueData as String] = Data(value.utf8)
            record[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(record as CFDictionary, nil)
        }
    }
}

struct WebContent: UIViewRepresentable {
    @ObservedObject var model: BrowserModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct BrowserView: View {
    @StateObject private var model = BrowserModel()
    @FocusState private var editingAddress: Bool
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button(action: model.goBack) { Image(systemName: "chevron.left") }
                    .disabled(!model.backAvailable)
                Button(action: model.goForward) { Image(systemName: "chevron.right") }
                    .disabled(!model.forwardAvailable)
                TextField("Adres of zoekopdracht", text: $model.address)
                    .focused($editingAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.webSearch)
                    .submitLabel(.go)
                    .onSubmit { model.navigate(model.address); editingAddress = false }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                Button(action: model.reload) { Image(systemName: "arrow.clockwise") }
                Button(action: model.goHome) { Image(systemName: "house") }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .buttonStyle(.plain)
            if model.loading { ProgressView(value: model.progress).frame(height: 2) }
            if let error = model.errorText {
                Text(error).font(.footnote).foregroundColor(.secondary).padding(6)
            }
            WebContent(model: model)
        }
    }
}
