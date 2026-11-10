// The app's one ExactModule, implemented by modules/apple/native.ts.
// scripts/nsx.mjs copies this file into the app and writes `nsxViewTags` beside it.
import CNSExact
import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

private func jsonText(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
}

private func taken(_ pointer: UnsafeMutablePointer<CChar>?) -> String {
    guard let pointer else { return "" }
    defer { nsx_free(pointer) }
    return String(cString: pointer)
}

final class NSExactModule: ExactModule {
    override class var views: [String: ExactNativeFactory] {
        Dictionary(uniqueKeysWithValues: nsxViewTags.map { tag in
            (tag, ExactNativeFactory(for: NSExactModule.self) { module, props, events in
                try NSExactView(module, tag: tag, props: props, events: events)
            })
        })
    }

    fileprivate var client: UInt64 = 0
    fileprivate var replies: [UInt64: ExactReply] = [:]
    fileprivate var events: [UInt64: ExactNativeEvents] = [:]
    fileprivate var elements: [UInt64: ExactElement] = [:]
    private var tickets: [UInt64: ExactTicket] = [:]
    private var spans: [UInt64: ExactSpan] = [:]
    private var elementTokens: [ObjectIdentifier: UInt64] = [:]
    private var nextToken: UInt64 = 1
    private var watcher: DispatchSourceTimer?
    private var startError: String?

    required init(context: ExactModuleContext) {
        super.init(context: context)
        var host = NSXHost(
            ctx: Unmanaged.passUnretained(self).toOpaque(),
            log: { ctx, line in NSExactModule.from(ctx).write(String(cString: line!)) },
            changed: { ctx, topic in NSExactModule.from(ctx).context.changed(String(cString: topic!)) },
            now: { ctx in NSExactModule.from(ctx).context.now() },
            frames: { ctx, token, start in NSExactModule.from(ctx).frames(token, start != 0) },
            after: { ctx, token, ms in NSExactModule.from(ctx).after(token, ms) },
            cancel_after: { ctx, token in NSExactModule.from(ctx).tickets.removeValue(forKey: token)?.stop() },
            reply: { ctx, token, status, body in NSExactModule.from(ctx).reply(token, status, String(cString: body!)) },
            event: { ctx, view, kind, text in NSExactModule.from(ctx).events[view]?.send(kind, String(cString: text!)) },
            act: { ctx, element, action, text in NSExactModule.from(ctx).act(element, String(cString: action!), String(cString: text!)) },
            diag: { ctx, kind, name, value, text in NSExactModule.from(ctx).diag(kind, String(cString: name!), value, String(cString: text!)) },
            agent: context.agent ? 1 : 0)
        var error: UnsafeMutablePointer<CChar>?
        client = nsx_attach("app", &host, &error)
        if client == 0 {
            startError = taken(error)
            write("NativeScript module failed to start: \(startError ?? "")")
        }
        watchDevelopmentBytecode()
    }

    private static func from(_ ctx: UnsafeMutableRawPointer?) -> NSExactModule {
        Unmanaged<NSExactModule>.fromOpaque(ctx!).takeUnretainedValue()
    }

    private func write(_ line: String) {
        print("[ns] \(line)")
        fflush(stdout)
        context.diagnostics.log(line)
    }

    private func watchDevelopmentBytecode() {
        guard client != 0, nsx_dev_bytecode_path().pointee != 0 else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.05)
        timer.setEventHandler { [weak self] in
            guard let self, nsx_reload_if_changed() != 0 else { return }
            self.write("reloaded native.ts")
            self.context.changed("nsx:reload")
        }
        timer.resume()
        watcher = timer
    }

    fileprivate func token() -> UInt64 {
        defer { nextToken += 1 }
        return nextToken
    }

    private func frames(_ token: UInt64, _ start: Bool) {
        guard start else { tickets.removeValue(forKey: token)?.stop(); return }
        tickets[token] = context.frames { [weak self] frame in
            guard let self, self.client != 0 else { return }
            nsx_tick(self.client, token, frame.now, Double(frame.seq))
        }
    }

    private func after(_ token: UInt64, _ ms: Double) {
        tickets[token] = context.after(ms) { [weak self] in
            guard let self, self.client != 0 else { return }
            self.tickets[token] = nil
            nsx_fire_after(self.client, token)
        }
    }

    private func reply(_ token: UInt64, _ status: Int32, _ body: String) {
        guard let reply = replies.removeValue(forKey: token) else { return }
        guard status == 200 else { return reply.fail(body) }
        let value = (try? JSONSerialization.jsonObject(with: Data(body.utf8), options: .fragmentsAllowed)) ?? [:]
        if let object = value as? [String: Any] { reply.send(object) } else { reply.send(["exact:answer": value]) }
    }

    private func diag(_ kind: UInt32, _ name: String, _ value: Double, _ text: String) -> UInt64 {
        let diagnostics = context.diagnostics
        switch kind {
        case 1: diagnostics.count(name, by: Int(value))
        case 2: diagnostics.measure(name, ms: value)
        case 3:
            let id = token()
            spans[id] = diagnostics.begin(name)
            return id
        case 4: spans.removeValue(forKey: UInt64(value))?.end()
        case 5: diagnostics.publish(name, (try? JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed)) ?? NSNull())
        default: write("unknown diagnostics kind \(kind)")
        }
        return 0
    }

    private func act(_ token: UInt64, _ action: String, _ text: String) {
        guard let element = elements[token] else { return }
        switch action {
        case "click": element.click()
        case "focus": element.focus()
        case "blur": element.blur()
        case "input": element.input(text)
        default: write("unknown element action \(action)")
        }
    }

    override func call(_ request: [String: Any]) throws -> [String: Any] {
        guard client != 0 else { throw ExactNativeRefusal(startError ?? "NativeScript module is not running") }
        var error: UnsafeMutablePointer<CChar>?
        guard let out = nsx_call(client, jsonText(request), &error) else { throw ExactNativeRefusal(taken(error)) }
        let text = taken(out)
        let value = try JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed)
        return value as? [String: Any] ?? ["exact:answer": value]
    }

    override func later(_ request: [String: Any], reply: ExactReply) {
        guard client != 0 else { return reply.fail(startError ?? "NativeScript module is not running") }
        let id = token()
        replies[id] = reply
        nsx_later(client, jsonText(request), id)
    }

    override func element(_ element: ExactElement) {
        guard client != 0, let word = element.hatch?.name else { return }
        let key = ObjectIdentifier(element)
        let id = elementTokens[key] ?? token()
        elementTokens[key] = id
        elements[id] = element
        send("element", id, word, element)
    }

    override func elementEnded(_ element: ExactElement) {
        let key = ObjectIdentifier(element)
        guard client != 0, let word = element.hatch?.name, let id = elementTokens.removeValue(forKey: key) else { return }
        send("ended", id, word, element)
        elements[id] = nil
    }

    private func send(_ phase: String, _ id: UInt64, _ word: String, _ element: ExactElement) {
        let info = jsonText(["word": word, "id": element.id, "isNew": element.isNew, "data": element.data.words] as [String: Any])
        nsx_element(client, phase, id, info,
                    element.view.map { Unmanaged.passUnretained($0).toOpaque() },
                    element.platform.map { Unmanaged.passUnretained($0).toOpaque() })
    }

    override func destroy() {
        watcher?.cancel()
        tickets.values.forEach { $0.stop() }
        tickets.removeAll()
        spans.removeAll()
        nsx_detach(client)
        client = 0
    }
}

final class NSExactView: ExactNativeInstance {
    private let module: NSExactModule
    private let id: UInt64
    private let native: ExactNativeView

    init(_ module: NSExactModule, tag: String, props: [String: String], events: ExactNativeEvents) throws {
        guard module.client != 0 else { throw ExactNativeRefusal("NativeScript module is not running") }
        self.module = module
        id = module.token()
        module.events[id] = events
        var error: UnsafeMutablePointer<CChar>?
        guard let raw = nsx_view_create(module.client, id, tag, jsonText(props), &error) else {
            module.events[id] = nil
            throw ExactNativeRefusal(taken(error))
        }
        native = Unmanaged<ExactNativeView>.fromOpaque(raw).takeUnretainedValue()
        super.init(events: events)
    }

    override var view: ExactNativeView { native }

    // The Mac driver delivers `type` only to a view that names a focus target.
    override var focusTarget: ExactNativeView? { native }

    override func setProps(_ props: [String: String]) throws {
        guard module.client != 0 else { return }
        nsx_view_set_props(module.client, id, jsonText(props))
    }

    override func agentInput(_ input: ExactNativeInput) throws {
        guard module.client != 0 else { throw ExactNativeRefusal("NativeScript module is not running") }
        let (kind, text, phase): (String, String, String)
        switch input {
        case .text(let value): (kind, text, phase) = ("text", value, "")
        case .key(let name, let at): (kind, text, phase) = ("key", name, at ?? "")
        }
        var error: UnsafeMutablePointer<CChar>?
        guard nsx_view_input(module.client, id, kind, text, phase, &error) != 0 else { throw ExactNativeRefusal(taken(error)) }
    }

    override func destroy() {
        if module.client != 0 { nsx_view_destroy(module.client, id) }
        module.events[id] = nil
    }
}

let exactModule: ExactModule.Type = NSExactModule.self
