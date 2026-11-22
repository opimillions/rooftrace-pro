import SwiftUI
import RoomPlan

/// Owns the RoomPlan capture view. Apple's RoomCaptureView shows live coaching
/// ("move closer", "slow down") and then the finished 3D model after `stop()`.
final class RoomCaptureViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    private var captureView: RoomCaptureView!
    private var started = false
    var onResult: ((CapturedRoom) -> Void)?
    var onError: ((Error) -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        captureView.captureSession.delegate = self
        view.addSubview(captureView)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureView.captureSession.stop()
    }

    func finish() { captureView.captureSession.stop() }

    // Let RoomPlan process the raw scan into walls/doors/windows/objects.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error { onError?(error) }
        return true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error { onError?(error); return }
        onResult?(processedResult)
    }
}

final class ScanController: ObservableObject {
    let vc = RoomCaptureViewController()
    @Published var result: CapturedRoom?
    @Published var finishing = false
    @Published var errorText: String?

    init() {
        vc.onResult = { [weak self] room in DispatchQueue.main.async { self?.result = room; self?.finishing = false } }
        vc.onError = { [weak self] err in DispatchQueue.main.async { self?.errorText = err.localizedDescription; self?.finishing = false } }
    }
}

struct CaptureRepresentable: UIViewControllerRepresentable {
    let vc: RoomCaptureViewController
    func makeUIViewController(context: Context) -> RoomCaptureViewController { vc }
    func updateUIViewController(_ uiViewController: RoomCaptureViewController, context: Context) {}
}

/// Full-screen scan → review → name it → upload.
struct ScanView: View {
    let property: PropertyRef
    let floors: [String]
    var onSaved: () -> Void

    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var scan = ScanController()
    @State private var showSave = false

    var body: some View {
        ZStack {
            if RoomCaptureSession.isSupported {
                CaptureRepresentable(vc: scan.vc).ignoresSafeArea()
            } else {
                ContentUnavailableView("LiDAR not available",
                    systemImage: "camera.metering.unknown",
                    description: Text("Room scanning needs an iPhone or iPad Pro with a LiDAR scanner."))
            }
            VStack {
                HStack {
                    Button("Cancel") { dismiss() }
                        .buttonStyle(.bordered)
                    Spacer()
                    if scan.result != nil {
                        Button { showSave = true } label: { Label("Save Room", systemImage: "square.and.arrow.up") }
                            .buttonStyle(.borderedProminent).tint(Brand.green)
                    } else if RoomCaptureSession.isSupported {
                        Button {
                            scan.finishing = true
                            scan.vc.finish()
                        } label: {
                            if scan.finishing { ProgressView() } else { Text("Done") }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(scan.finishing)
                    }
                }
                .padding()
                Spacer()
                if let e = scan.errorText {
                    Text(e).font(.footnote).padding(10)
                        .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.bottom, 30)
                } else if scan.result == nil {
                    Text("Point at the walls and walk the room slowly. Get every corner, door and window, then tap Done.")
                        .font(.footnote).multilineTextAlignment(.center).padding(10)
                        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal).padding(.bottom, 30)
                }
            }
        }
        .sheet(isPresented: $showSave) {
            if let room = scan.result {
                SaveRoomSheet(property: property, floors: floors, room: room) {
                    showSave = false
                    onSaved()
                    dismiss()
                }
                .presentationDetents([.medium, .large])
            }
        }
    }
}

struct SaveRoomSheet: View {
    let property: PropertyRef
    let floors: [String]
    let room: CapturedRoom
    var onDone: () -> Void

    @EnvironmentObject var session: SessionStore
    @State private var name = ""
    @State private var floor = ""
    @State private var newFloor = ""
    @State private var saving = false
    @State private var error: String?

    private let quickNames = ["Kitchen", "Living Room", "Dining Room", "Bed 1", "Bed 2", "Bed 3", "Primary Bath",
                              "Bath 2", "Hallway", "Entry", "Laundry", "Closet", "Garage"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Room") {
                    TextField("Room name", text: $name)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack { ForEach(quickNames, id: \.self) { n in Button(n) { name = n }.buttonStyle(.bordered).font(.caption) } }
                    }
                }
                Section("Floor") {
                    Picker("Floor", selection: $floor) {
                        ForEach(floors, id: \.self) { Text($0).tag($0) }
                        Text("New floor…").tag("__new")
                    }
                    if floor == "__new" { TextField("Floor name (e.g. Second Floor)", text: $newFloor) }
                }
                Section("Captured") {
                    LabeledContent("Walls", value: "\(room.walls.count)")
                    LabeledContent("Doors / Windows", value: "\(room.doors.count) / \(room.windows.count)")
                    LabeledContent("Openings", value: "\(room.openings.count)")
                    LabeledContent("Items", value: "\(room.objects.count)")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Save to \(property.address)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { saving ? AnyView(ProgressView()) : AnyView(Text("Upload").bold()) }
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { if floor.isEmpty { floor = floors.first ?? "Entrance Floor" } }
        }
    }

    private func save() async {
        saving = true; error = nil
        let f = floor == "__new" ? newFloor.trimmingCharacters(in: .whitespaces) : floor
        let upload = RoomUpload(name: name.trimmingCharacters(in: .whitespaces),
                                floor: f.isEmpty ? (floors.first ?? "Entrance Floor") : f,
                                scan: RoomExport.payload(from: room))
        do {
            try await session.api.uploadRoom(propertyId: property.id, upload: upload)
            onDone()
        } catch APIError.unauthorized {
            session.signOut()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
