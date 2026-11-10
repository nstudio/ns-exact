import Foundation
import NaturalLanguage

final class Reader: ExactModule {
    override func call(_ request: [String: Any]) throws -> [String: Any] {
        guard request["op"] as? String == "read" else {
            throw ExactNativeRefusal("reader answers read")
        }
        let text = request["text"] as? String ?? ""
        return ["language": language(of: text), "score": score(of: text)]
    }

    private func language(of text: String) -> String {
        guard let code = NLLanguageRecognizer.dominantLanguage(for: text)?.rawValue else { return "" }
        return Locale.current.localizedString(forLanguageCode: code) ?? code
    }

    private func score(of text: String) -> Double {
        guard !text.isEmpty else { return 0 }
        let tagger = NLTagger(tagSchemes: [.sentimentScore])
        tagger.string = text
        let (tag, _) = tagger.tag(at: text.startIndex, unit: .paragraph, scheme: .sentimentScore)
        let score = tag.flatMap { Double($0.rawValue) } ?? 0
        return (score * 10).rounded() / 10
    }
}
let exactModule: ExactModule.Type = Reader.self
