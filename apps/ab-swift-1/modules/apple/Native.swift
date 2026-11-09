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
            forName: UIScreen.brightnessDidChangeNotification, object: nil, queue: nil
        ) { [context] _ in context.changed("brightness") }
    }

    override func destroy() {
        if let brightnessObserver { NotificationCenter.default.removeObserver(brightnessObserver) }
    }

    override func call(_ request: [String: Any]) throws -> [String: Any] {
        switch request["op"] as? String {
        case "device":
            let device = UIDevice.current
            device.isBatteryMonitoringEnabled = true
            return ["name": device.name, "system": "\(device.systemName) \(device.systemVersion)", "battery": device.batteryLevel]
        case "brightness":
            guard let scene = UIApplication.shared.connectedScenes.lazy.compactMap({ $0 as? UIWindowScene }).first else {
                throw ExactNativeRefusal("no window scene")
            }
            return ["percent": Int((scene.screen.brightness * 100).rounded())]
        default:
            throw ExactNativeRefusal("no such call")
        }
    }

    override func later(_ request: [String: Any], reply: ExactReply) {
        if request["op"] as? String == "buzz" {
            DispatchQueue.main.async { [self] in
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                buzzes += 1
                reply.send(["count": buzzes])
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
    // UTC on both the picker and the formatter keeps a calendar day the same day in every device time zone.
    private static let days: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
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
        picker.timeZone = Self.days.timeZone
        try setProps(props)
        let action = ControlTarget { control in
            guard let picked = control as? UIDatePicker else { return }
            events.message(Self.days.string(from: picked.date))
        }
        self.action = action
        picker.addTarget(action, action: #selector(ControlTarget.fire), for: .valueChanged)
        events.message(Self.days.string(from: picker.date))
        // The host refuses a compact picker's intrinsicContentSize here and leaves the box 0 tall.
        events.intrinsicSize(picker.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize))
    }

    override var view: ExactNativeView { picker }

    override func setProps(_ props: [String: String]) throws {
        guard let date = props["date"].flatMap(Self.days.date(from:)) else {
            throw ExactNativeRefusal("date must be yyyy-MM-dd")
        }
        if picker.date != date { picker.setDate(date, animated: false) }
    }
}

let exactModule: ExactModule.Type = Native.self
