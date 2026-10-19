public struct DropPolicy: Sendable {
    public enum Decision: Equatable, Sendable { case send, drop, dropAndRequestKey }

    private let limitBytes: Int
    public private(set) var waitingForKey = false

    public init(limitBytes: Int = 1_048_576) {
        self.limitBytes = limitBytes
    }

    public mutating func decide(isKey: Bool, backlogBytes: Int) -> Decision {
        if isKey {
            if backlogBytes > limitBytes {
                waitingForKey = true
                return .drop
            }
            waitingForKey = false
            return .send
        }
        if waitingForKey { return .drop }
        if backlogBytes > limitBytes {
            waitingForKey = true
            return .dropAndRequestKey
        }
        return .send
    }
}
