import ReplayKit
import SwiftUI

// SideStore rewrites bundle ids, so derive the extension id from our own.
private let extensionId = (Bundle.main.bundleIdentifier ?? "app.teslamirror.ios") + ".broadcast"
private let fallbackURL = "http://172.20.10.1:8080"

private struct Health: Decodable {
    let capturing: Bool
}

struct BroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 60, height: 60))
        picker.preferredExtension = extensionId
        picker.showsMicrophoneButton = false
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}

struct ContentView: View {
    @State private var url = fallbackURL
    @State private var streaming = false
    private let timer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Text(url)
                    .font(.system(size: 28, weight: .semibold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.5)

                VStack(spacing: 8) {
                    BroadcastPicker()
                        .frame(width: 60, height: 60)
                    Text("Start broadcast")
                        .font(.headline)
                }

                Text(streaming ? "Streaming" : "Not streaming")
                    .font(.title3)
                    .foregroundStyle(streaming ? Color.green : Color.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Personal Hotspot is on")
                    Text("Auto-Lock is set to Never")
                    Text("Bluetooth is connected to the car")
                }
                .font(.callout)
                .foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .onAppear { refresh() }
        .onReceive(timer) { _ in refresh() }
    }

    private func refresh() {
        url = HotspotAddress.current().map { "http://\($0):8080" } ?? fallbackURL
        Task { streaming = await fetchCapturing() }
    }

    private func fetchCapturing() async -> Bool {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8080/health")!)
        request.timeoutInterval = 1
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let health = try? JSONDecoder().decode(Health.self, from: data)
        else { return false }
        return health.capturing
    }
}
