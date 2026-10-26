import Foundation
import RoomPlan
import simd

/// Upload body for POST /api/interior/properties/:id/rooms.
/// Coordinates are a top-down plan in meters: [x, z] from RoomPlan world space.
/// The server converts to feet, builds the outline and computes the quantities.
struct RoomUpload: Encodable {
    let name: String
    let floor: String
    let scan: ScanPayload
}

struct ScanPayload: Encodable {
    struct Segment: Encodable { let start: [Float]; let end: [Float]; let height: Float; let bottom: Float }
    struct Item: Encodable {
        let category: String
        let width: Float, depth: Float, height: Float
        let center: [Float]
        let yawDeg: Float
    }

    var units = "m"
    let walls: [Segment]
    let doors: [Segment]
    let windows: [Segment]
    let openings: [Segment]
    let objects: [Item]
    let floorPolygon: [[Float]]?
}

enum RoomExport {
    static func payload(from room: CapturedRoom) -> ScanPayload {
        // Floor level = lowest wall bottom, so door/window sill heights are relative to the floor.
        let floorY = room.walls.map { $0.transform.columns.3.y - $0.dimensions.y / 2 }.min() ?? 0

        func segment(_ s: CapturedRoom.Surface) -> ScanPayload.Segment {
            let c = s.transform.columns.3
            let axis = simd_normalize(simd_float2(s.transform.columns.0.x, s.transform.columns.0.z))
            let half = s.dimensions.x / 2
            let start = simd_float2(c.x, c.z) - axis * half
            let end = simd_float2(c.x, c.z) + axis * half
            return .init(start: [start.x, start.y], end: [end.x, end.y],
                         height: s.dimensions.y,
                         bottom: max(0, (c.y - s.dimensions.y / 2) - floorY))
        }

        let objects = room.objects.map { o -> ScanPayload.Item in
            let c = o.transform.columns.3
            let yaw = atan2(o.transform.columns.0.z, o.transform.columns.0.x) * 180 / .pi
            return .init(category: categoryName(o.category),
                         width: o.dimensions.x, depth: o.dimensions.z, height: o.dimensions.y,
                         center: [c.x, c.z], yawDeg: yaw)
        }

        // iOS 17 floor outline — only used by the server if the walls don't close into a loop.
        var floorPolygon: [[Float]]? = nil
        if let floor = room.floors.first, floor.polygonCorners.count >= 3 {
            floorPolygon = floor.polygonCorners.map { p in
                let w = floor.transform * simd_float4(p.x, p.y, p.z, 1)
                return [w.x, w.z]
            }
        }

        return ScanPayload(
            walls: room.walls.map(segment),
            doors: room.doors.map(segment),
            windows: room.windows.map(segment),
            openings: room.openings.map(segment),
            objects: objects,
            floorPolygon: floorPolygon
        )
    }

    /// "washerDryer" → "washer / dryer", "storage" → "cabinets / storage"
    static func categoryName(_ c: CapturedRoom.Object.Category) -> String {
        let raw = String(describing: c)
        switch raw {
        case "storage": return "cabinets / storage"
        case "washerDryer": return "washer / dryer"
        default: return raw
        }
    }
}
