import Foundation
import UIKit
import SwiftUI
import Capacitor
import RoomPlan

/// JS: Capacitor.Plugins.RoomScan
///   isSupported() → { supported }
///   scan()        → { cancelled: true } | { scan: {...RoomPlan export...}, counts: {...} }
/// The web page then names the room and POSTs it to /api/interior/properties/:id/rooms.
@objc(RoomScanPlugin)
public class RoomScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomScanPlugin"
    public let jsName = "RoomScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": RoomCaptureSession.isSupported])
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard RoomCaptureSession.isSupported else {
            call.reject("Room scanning needs an iPhone with a LiDAR scanner (iPhone 12 Pro or newer Pro models).")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("Scanner could not open."); return
            }
            var host: UIHostingController<RoomScanScreen>!
            let screen = RoomScanScreen { outcome in
                host.dismiss(animated: true) {
                    switch outcome {
                    case .cancelled:
                        call.resolve(["cancelled": true])
                    case .failed(let message):
                        call.reject(message)
                    case .captured(let room):
                        do {
                            let payload = RoomExport.payload(from: room)
                            let data = try JSONEncoder().encode(payload)
                            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
                            call.resolve([
                                "scan": json,
                                "counts": [
                                    "walls": room.walls.count,
                                    "doors": room.doors.count,
                                    "windows": room.windows.count,
                                    "openings": room.openings.count,
                                    "objects": room.objects.count,
                                ],
                            ])
                        } catch {
                            call.reject("Could not read the scan: \(error.localizedDescription)")
                        }
                    }
                }
            }
            host = UIHostingController(rootView: screen)
            host.modalPresentationStyle = .fullScreen
            presenter.present(host, animated: true)
        }
    }
}

enum ScanOutcome {
    case cancelled
    case failed(String)
    case captured(CapturedRoom)
}

/// RoomPlan's capture view: live coaching while scanning, then the finished 3D model.
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

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        if let error { onError?(error) }
        return true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error { onError?(error); return }
        onResult?(processedResult)
    }
}

final class ScanModel: ObservableObject {
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

struct RoomScanScreen: View {
    let onFinish: (ScanOutcome) -> Void
    @StateObject private var model = ScanModel()
    private let gold = Color(red: 0.96, green: 0.62, blue: 0.04)

    var body: some View {
        ZStack {
            CaptureRepresentable(vc: model.vc).ignoresSafeArea()
            VStack {
                HStack {
                    Button("Cancel") { onFinish(.cancelled) }
                        .buttonStyle(.bordered).tint(.white)
                    Spacer()
                    if let room = model.result {
                        Button { onFinish(.captured(room)) } label: {
                            Label("Use This Scan", systemImage: "checkmark.circle.fill").bold()
                        }
                        .buttonStyle(.borderedProminent).tint(gold)
                    } else {
                        Button {
                            model.finishing = true
                            model.vc.finish()
                        } label: {
                            if model.finishing { ProgressView() } else { Text("Done").bold() }
                        }
                        .buttonStyle(.borderedProminent).tint(gold)
                        .disabled(model.finishing)
                    }
                }
                .padding()
                Spacer()
                if let e = model.errorText {
                    Text(e).font(.footnote).foregroundStyle(.white).padding(10)
                        .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.bottom, 30)
                } else if model.result == nil {
                    Text("Point at the walls and walk the room slowly. Get every corner, door and window, then tap Done.")
                        .font(.footnote).foregroundStyle(.white).multilineTextAlignment(.center).padding(10)
                        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal).padding(.bottom, 30)
                } else {
                    Text("Check the model, then tap Use This Scan to name the room and save it.")
                        .font(.footnote).foregroundStyle(.white).multilineTextAlignment(.center).padding(10)
                        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal).padding(.bottom, 30)
                }
            }
        }
    }
}
