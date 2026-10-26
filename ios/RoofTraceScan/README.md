# RoofTrace Scan (iPhone / iPad)

Companion app that measures interior rooms with the LiDAR scanner and sends them
to RoofTrace Pro. Each scan becomes a room under the property at `/interior`,
with a 2D floor plan, wall lengths, and floor / wall / ceiling SF.

Uses Apple's **RoomPlan** framework, so it captures walls, doors, windows,
openings, ceiling height, cabinets and appliances automatically.

## Requirements

- A Mac with **Xcode 15 or later**
- **XcodeGen** to create the Xcode project: `brew install xcodegen`
- An Apple Developer account ($99/yr) to install on devices other than your own
  test phone, or to ship through TestFlight / the App Store
- A LiDAR device to scan: iPhone 12 Pro or later Pro models, iPad Pro (2020+).
  RoomPlan requires **iOS 17+** for this app.

## Build and run

```bash
cd ios/RoofTraceScan
xcodegen                 # creates RoofTraceScan.xcodeproj
open RoofTraceScan.xcodeproj
```

In Xcode: select the **RoofTraceScan** target → *Signing & Capabilities* → pick
your team. Plug in your iPhone, choose it as the run destination, and press ▶.

## How it works

1. Sign in with the same email and password as the RoofTrace Pro website.
2. Pick or create a property (or tap **Scan Room (LiDAR)** on the website's
   Interior page — it opens the app straight to that property).
3. Tap **Scan a Room**, walk the room, tap **Done**, then **Save Room**.
4. Name the room and floor, tap **Upload**. It appears on the website right away.

## Files

| File | What it does |
|---|---|
| `RoofTraceScanApp.swift` | App entry, deep link `rooftracescan://scan?property=…` |
| `API.swift` | Server calls, token in Keychain, session state |
| `Screens.swift` | Sign in, property list, property rooms |
| `ScanView.swift` | RoomPlan capture screen and the save/upload sheet |
| `RoomExport.swift` | Converts RoomPlan's `CapturedRoom` into the upload JSON |

## Upload format

`POST /api/interior/properties/:id/rooms` with a Bearer token from
`POST /api/auth/token`:

```json
{
  "name": "Kitchen",
  "floor": "Entrance Floor",
  "scan": {
    "units": "m",
    "walls":    [{ "start": [x, z], "end": [x, z], "height": 2.44, "bottom": 0 }],
    "doors":    [{ "start": [x, z], "end": [x, z], "height": 2.03, "bottom": 0 }],
    "windows":  [ ... ], "openings": [ ... ],
    "objects":  [{ "category": "refrigerator", "width": 0.9, "depth": 0.8, "height": 1.8, "center": [x, z], "yawDeg": 30 }],
    "floorPolygon": [[x, z], ...]
  }
}
```

The server (`lib/roomGeometry.js`) chains the walls into the room outline,
converts to feet, and computes the quantities.
