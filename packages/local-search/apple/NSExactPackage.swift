// An ExactPackage implemented by the package's apple/native.ts. `nsx.mjs package` writes this file
// into the package with its class and package names filled in.
//
// Exact compiles each package as a Swift module of its own, which cannot import the bridge's
// C header, so the entry points are declared here. Every parameter is a pointer, an integer
// or a C function pointer, which Swift passes as C does.
import ExactPackage
import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

private typealias Text = UnsafePointer<CChar>?
private typealias ErrorOut = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?

@_silgen_name("nsx_attach_flat")
private func nsxAttach(_ module: UnsafePointer<CChar>, _ ctx: UnsafeMutableRawPointer?,
                       _ log: @convention(c) (UnsafeMutableRawPointer?, Text) -> Void,
                       _ changed: @convention(c) (UnsafeMutableRawPointer?, Text) -> Void,
                       _ now: @convention(c) (UnsafeMutableRawPointer?) -> Double,
                       _ frames: @convention(c) (UnsafeMutableRawPointer?, UInt64, Int32) -> Void,
                       _ after: @convention(c) (UnsafeMutableRawPointer?, UInt64, Double) -> Void,
                       _ cancel: @convention(c) (UnsafeMutableRawPointer?, UInt64) -> Void,
                       _ reply: @convention(c) (UnsafeMutableRawPointer?, UInt64, Int32, Text) -> Void,
                       _ event: @convention(c) (UnsafeMutableRawPointer?, UInt64, UInt32, Text) -> Void,
                       _ act: @convention(c) (UnsafeMutableRawPointer?, UInt64, Text, Text) -> Void,
                       _ agent: UInt32,
                       _ error: ErrorOut) -> UInt64
@_silgen_name("nsx_detach") private func nsxDetach(_ client: UInt64)
@_silgen_name("nsx_free") private func nsxFree(_ text: UnsafeMutablePointer<CChar>?)
@_silgen_name("nsx_call") private func nsxCall(_ client: UInt64, _ request: UnsafePointer<CChar>, _ error: ErrorOut) -> UnsafeMutablePointer<CChar>?
@_silgen_name("nsx_later") private func nsxLater(_ client: UInt64, _ request: UnsafePointer<CChar>, _ token: UInt64)
@_silgen_name("nsx_view_create") private func nsxViewCreate(_ client: UInt64, _ view: UInt64, _ tag: UnsafePointer<CChar>, _ props: UnsafePointer<CChar>, _ error: ErrorOut) -> UnsafeMutableRawPointer?
@_silgen_name("nsx_view_set_props") private func nsxViewSetProps(_ client: UInt64, _ view: UInt64, _ props: UnsafePointer<CChar>)
@_silgen_name("nsx_view_destroy") private func nsxViewDestroy(_ client: UInt64, _ view: UInt64)
@_silgen_name("nsx_fire_after") private func nsxFireAfter(_ client: UInt64, _ token: UInt64)
@_silgen_name("nsx_reload_if_changed") private func nsxReloadIfChanged() -> Int32
@_silgen_name("nsx_dev_bytecode_path") private func nsxDevBytecodePath() -> UnsafePointer<CChar>

private func jsonText(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
}

private func jsonObject(_ text: String) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? ["error": "OperationError"]
}

private func taken(_ pointer: UnsafeMutablePointer<CChar>?) -> String {
    guard let pointer else { return "" }
    defer { nsxFree(pointer) }
    return String(cString: pointer)
}

private func string(_ text: Text) -> String { text.map { String(cString: $0) } ?? "" }

public final class LocalSearchPackage: ExactPackage {
    private static let name = "@ns-exact/local-search"
    let context: ExactPackageContext
    fileprivate var client: UInt64 = 0
    private var replies: [UInt64: ([String: Any]) -> Void] = [:]
    fileprivate var events: [UInt64: ExactPackageEvents] = [:]
    private var waits: [UInt64: () -> Void] = [:]
    private var nextToken: UInt64 = 1
    private var watcher: DispatchSourceTimer?
    private var startError = ""

    public init(context: ExactPackageContext) {
        self.context = context
        var error: UnsafeMutablePointer<CChar>?
        client = nsxAttach(Self.name, Unmanaged.passUnretained(self).toOpaque(),
            { ctx, line in LocalSearchPackage.from(ctx).context.log(string(line)) },
            { ctx, topic in LocalSearchPackage.from(ctx).context.changed(string(topic)) },
            { ctx in LocalSearchPackage.from(ctx).context.now() },
            { ctx, _, _ in LocalSearchPackage.from(ctx).context.log("exact.frames is not available to a package") },
            { ctx, token, ms in LocalSearchPackage.from(ctx).after(token, ms) },
            { ctx, token in LocalSearchPackage.from(ctx).waits.removeValue(forKey: token)?() },
            { ctx, token, status, body in LocalSearchPackage.from(ctx).reply(token, status, string(body)) },
            { ctx, view, kind, text in LocalSearchPackage.from(ctx).event(view, kind, string(text)) },
            { _, _, _, _ in },
            context.agent ? 1 : 0,
            &error)
        if client == 0 {
            startError = taken(error)
            context.log("NativeScript package \(Self.name) failed to start: \(startError)")
        }
        watchDevelopmentBytecode()
    }

    private static func from(_ ctx: UnsafeMutableRawPointer?) -> LocalSearchPackage {
        Unmanaged<LocalSearchPackage>.fromOpaque(ctx!).takeUnretainedValue()
    }

    private func watchDevelopmentBytecode() {
        guard client != 0, nsxDevBytecodePath().pointee != 0 else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.05)
        timer.setEventHandler { if nsxReloadIfChanged() != 0 { self.context.log("reloaded native.ts") } }
        timer.resume()
        watcher = timer
    }

    fileprivate func token() -> UInt64 {
        defer { nextToken += 1 }
        return nextToken
    }

    private func after(_ token: UInt64, _ ms: Double) {
        waits[token] = context.after(ms) { [weak self] in
            guard let self, self.client != 0 else { return }
            self.waits[token] = nil
            nsxFireAfter(self.client, token)
        }
    }

    private func reply(_ token: UInt64, _ status: Int32, _ body: String) {
        guard let reply = replies.removeValue(forKey: token) else { return }
        if status == 200 { return reply(jsonObject(body)) }
        reply(["error": body.hasPrefix("TimeoutError") ? "TimeoutError" : "OperationError", "message": body])
    }

    private func event(_ view: UInt64, _ kind: UInt32, _ text: String) {
        guard let events = events[view] else { return }
        switch kind {
        case 0: events.press()
        case 1: events.change(text)
        case 7: events.load()
        case 8: events.message(text)
        case 9:
            let parts = text.split(separator: ",").compactMap { Double($0) }
            events.intrinsicSize(parts.count == 2 ? CGSize(width: parts[0], height: parts[1]) : nil)
        default: context.log("unknown view event \(kind)")
        }
    }

    public func later(_ name: String, _ args: [String: Any], preferred: Any?, reply: @escaping ([String: Any]) -> Void) {
        guard client != 0 else { return reply(["error": "NotSupportedError", "message": startError]) }
        let id = token()
        replies[id] = reply
        nsxLater(client, jsonText(["name": name, "args": args] as [String: Any]), id)
    }

    public func call(_ name: String, _ args: [String: Any]) throws -> [String: Any] {
        guard client != 0 else { return ["error": "NotSupportedError"] }
        var error: UnsafeMutablePointer<CChar>?
        guard let out = nsxCall(client, jsonText(["name": name, "args": args] as [String: Any]), &error) else {
            throw ExactPackageRefusal(taken(error))
        }
        return jsonObject(taken(out))
    }

    public func view(_ tag: String, id: String, props: [String: String], events: ExactPackageEvents) throws -> ExactPackageView {
        try NSExactPackageView(self, tag: tag, props: props, events: events)
    }

    public func destroy(_ done: @escaping () -> Void) {
        watcher?.cancel()
        waits.values.forEach { $0() }
        waits.removeAll()
        nsxDetach(client)
        client = 0
        done()
    }

    fileprivate final class NSExactPackageView: ExactPackageView {
        private let owner: LocalSearchPackage
        private let id: UInt64
        let view: ExactPackagePlatformView

        init(_ owner: LocalSearchPackage, tag: String, props: [String: String], events: ExactPackageEvents) throws {
            guard owner.client != 0 else { throw ExactPackageRefusal("NativeScript package is not running") }
            self.owner = owner
            id = owner.token()
            owner.events[id] = events
            var error: UnsafeMutablePointer<CChar>?
            guard let raw = nsxViewCreate(owner.client, id, tag, jsonText(props), &error) else {
                owner.events[id] = nil
                throw ExactPackageRefusal(taken(error))
            }
            view = Unmanaged<ExactPackagePlatformView>.fromOpaque(raw).takeUnretainedValue()
        }

        func setProps(_ props: [String: String]) throws {
            if owner.client != 0 { nsxViewSetProps(owner.client, id, jsonText(props)) }
        }

        func destroy() {
            if owner.client != 0 { nsxViewDestroy(owner.client, id) }
            owner.events[id] = nil
        }
    }
}
