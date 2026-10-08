import Capacitor

final class LinkyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LinkyNfcPlugin())
        bridge?.registerPluginInstance(LinkySecretStoragePlugin())
        bridge?.registerPluginInstance(LinkyScannerPlugin())
        bridge?.registerPluginInstance(LinkyBeaconPlugin())
    }
}