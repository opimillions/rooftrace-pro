import UIKit
import Capacitor

/// Capacitor bridge with RoofTrace Pro's own native plugins registered.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomScanPlugin())
    }
}
