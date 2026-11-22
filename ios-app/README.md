# RoofTrace Pro: iPhone app

A Capacitor 8 iPhone app around the live RoofTrace Pro site, plus a native **LiDAR room scanner** built on Apple's RoomPlan.

- **Room scanning:** on the Interior page, **Scan Room (LiDAR)** opens the native scanner (`App/RoomScanPlugin.swift`). It returns the RoomPlan export (`App/RoomExport.swift`, shared with `ios/RoofTraceScan`), and the page then names the room and saves it to `/api/interior/properties/:id/rooms`. iPhones without LiDAR are pointed to Sketch Room.
- **App Store rules:** inside the app (user agent `RoofTraceProApp/`), upgrade links are hidden, `/upgrade` shows a plain plan note, and Stripe checkout is refused. Plans are sold on the website only.
- **Account deletion** is at `/account`, and the privacy policy is at `/privacy`.

Bundle ID: `com.thepublicadjustertx.rooftracepro` · iPhone only · iOS 17+

## Build without a Mac
GitHub → **Actions** → **iOS → TestFlight** → **Run workflow**. A GitHub-hosted Mac creates a temporary App Store certificate and profile through the App Store Connect API, signs the app, uploads it to TestFlight, and then removes the certificate and profile.

The build needs four secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8`.
