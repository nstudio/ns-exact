import Foundation
import MapKit
import UIKit

final class ControlTarget: NSObject {
    let handler: (UIControl) -> Void
    init(_ handler: @escaping (UIControl) -> Void) { self.handler = handler }
    @objc func fire(_ sender: UIControl) { handler(sender) }
}

final class Native: ExactModule {
    override class var views: [String: ExactNativeFactory] {
        [
            "ns-slider": ExactNativeFactory(for: Native.self) { _, props, events in Slider(props, events) },
            "date-field": ExactNativeFactory(for: Native.self) { _, props, events in try DateField(props, events) },
        ]
    }

    private var buzzes = 0
    private var brightnessObserver: NSObjectProtocol?

    required init(context: ExactModuleContext) {
        super.init(context: context)
        brightnessObserver = NotificationCenter.default.addObserver(
            forName: UIScreen.brightnessDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.context.changed("brightness") }
    }

    deinit {
        if let brightnessObserver { NotificationCenter.default.removeObserver(brightnessObserver) }
    }

    override func call(_ request: [String: Any]) throws -> [String: Any] {
        switch request["op"] as? String {
        case "device":
            let device = UIDevice.current
            device.isBatteryMonitoringEnabled = true
            return ["name": device.name, "system": "\(device.systemName) \(device.systemVersion)", "battery": device.batteryLevel]
        case "brightness":
            let screens = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.screen }
            guard let screen = screens.first else { throw ExactNativeRefusal("no screen yet") }
            return ["percent": Int((screen.brightness * 100).rounded())]
        default:
            throw ExactNativeRefusal("no such call")
        }
    }

    override func later(_ request: [String: Any], reply: ExactReply) {
        if request["op"] as? String == "buzz" {
            DispatchQueue.main.async {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                self.buzzes += 1
                reply.send(["count": self.buzzes])
            }
            return
        }
        guard request["op"] as? String == "geocode", let address = request["address"] as? String,
              let search = MKGeocodingRequest(addressString: address) else { return reply.fail("no such call") }
        search.getMapItems { items, error in
            if let error { return reply.fail(error.localizedDescription) }
            let names = items?.first?.addressRepresentations
            reply.send(["city": names?.cityName ?? "", "country": names?.regionName ?? ""])
        }
    }

    override func element(_ element: ExactElement) {
        guard element.hatch == .card, element.isNew, let view = element.view else { return }
        let bar = UIView(frame: CGRect(x: 0, y: 0, width: 6, height: view.bounds.height))
        bar.backgroundColor = .systemPink
        bar.autoresizingMask = .flexibleHeight
        view.addSubview(bar)
        element.diagnostics.log("card hatch ready at \(context.now())")
    }
}

final class Slider: ExactNativeInstance {
    private let slider = UISlider()
    private var action: ControlTarget?

    init(_ props: [String: String], _ events: ExactNativeEvents) {
        super.init(events: events)
        slider.minimumValue = 0
        slider.maximumValue = 100
        slider.minimumTrackTintColor = .systemPink
        slider.value = Float(props["level"] ?? "") ?? 0
        let action = ControlTarget { control in
            guard let moved = control as? UISlider else { return }
            events.message(String(Int(moved.value.rounded())))
        }
        self.action = action
        slider.addTarget(action, action: #selector(ControlTarget.fire), for: .valueChanged)
        events.intrinsicSize(CGSize(width: 240, height: 44))
    }

    override var view: ExactNativeView { slider }

    override func setProps(_ props: [String: String]) throws {
        if !slider.isTracking { slider.value = Float(props["level"] ?? "") ?? 0 }
    }
}

final class DateField: ExactNativeInstance {
    // The picker and this formatter must share a fixed zone: yyyy-MM-dd has no time,
    // so the local zone would move the day whenever midnight there falls on another UTC day.
    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private let picker = UIDatePicker()
    private var action: ControlTarget?

    init(_ props: [String: String], _ events: ExactNativeEvents) throws {
        super.init(events: events)
        picker.datePickerMode = .date
        picker.preferredDatePickerStyle = .compact
        picker.timeZone = Self.day.timeZone
        try setProps(props)
        let action = ControlTarget { [weak self] _ in self?.report() }
        self.action = action
        picker.addTarget(action, action: #selector(ControlTarget.fire), for: .valueChanged)
        report()
    }

    override var view: ExactNativeView { picker }

    override func setProps(_ props: [String: String]) throws {
        guard let text = props["date"], let date = Self.day.date(from: text) else {
            throw ExactNativeRefusal("date-field needs date as yyyy-MM-dd")
        }
        if Self.day.string(from: picker.date) != text { picker.date = date }
    }

    private func report() {
        events.message(Self.day.string(from: picker.date))
        events.intrinsicSize(picker.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize))
    }
}

let exactModule: ExactModule.Type = Native.self
