#!/usr/bin/env bash
# Debug build for a local device under the dev bundle id fit.linky.local; LINKY_IOS_BUNDLE_ID reaches only the App target, so the Pod frameworks keep their own ids.
set -euo pipefail

: "${LINKY_IOS_TEAM:?Set LINKY_IOS_TEAM to your Apple development team id}"
: "${LINKY_IOS_DEVICE:?Set LINKY_IOS_DEVICE to the device UDID (xcrun devicectl list devices)}"

cd "$(dirname "${BASH_SOURCE[0]}")/../ios/App"
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
  -destination "id=$LINKY_IOS_DEVICE" -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration -derivedDataPath /tmp/linky-ios-build \
  DEVELOPMENT_TEAM="$LINKY_IOS_TEAM" LINKY_IOS_BUNDLE_ID=fit.linky.local build
