import Foundation

final class Greeter: ExactModule {
    override func call(_ request: [String: Any]) throws -> [String: Any] {
        guard request["op"] as? String == "hello" else { throw ExactNativeRefusal("Greeter answers hello") }
        return ["text": "Hello from the app's Swift module"]
    }
}
let exactModule: ExactModule.Type = Greeter.self
