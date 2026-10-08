import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // A Bluetooth relaunch may connect no scene, so the restored managers must exist before UIKit decides.
        _ = BeaconEngine.shared
        return true
    }

}
