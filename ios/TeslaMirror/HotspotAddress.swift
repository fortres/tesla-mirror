import Darwin

enum HotspotAddress {
    /// IPv4 address of the Personal Hotspot bridge interface, nil when it is down.
    static func current() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }

        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            defer { cursor = entry.pointee.ifa_next }
            guard let addr = entry.pointee.ifa_addr,
                  addr.pointee.sa_family == sa_family_t(AF_INET),
                  String(cString: entry.pointee.ifa_name).hasPrefix("bridge")
            else { continue }

            var host = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            let sin = UnsafeRawPointer(addr).assumingMemoryBound(to: sockaddr_in.self)
            var inAddr = sin.pointee.sin_addr
            if inet_ntop(AF_INET, &inAddr, &host, socklen_t(INET_ADDRSTRLEN)) != nil {
                return String(decoding: host.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
            }
        }
        return nil
    }
}
