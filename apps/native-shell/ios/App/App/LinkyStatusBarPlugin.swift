import Capacitor

@objc(LinkyStatusBarPlugin)
final class LinkyStatusBarPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "LinkyStatusBarPlugin"
    let jsName = "LinkyStatusBar"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setColorMode", returnType: CAPPluginReturnPromise)
    ]

    @objc func setColorMode(_ call: CAPPluginCall) {
        bridge?.statusBarStyle = call.getString("mode") == "light" ? .darkContent : .lightContent
        call.resolve()
    }
}
