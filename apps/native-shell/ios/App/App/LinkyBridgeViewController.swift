import Capacitor

final class LinkyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LinkyBluetoothPlugin())
        bridge?.registerPluginInstance(LinkyNfcPlugin())
        bridge?.registerPluginInstance(LinkySecretStoragePlugin())
        bridge?.registerPluginInstance(LinkyScannerPlugin())
    }
}