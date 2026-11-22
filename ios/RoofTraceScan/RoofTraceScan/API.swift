import Foundation
import Security

// MARK: - Models (match /api/interior on the RoofTrace Pro server)

struct PropertyRef: Hashable, Identifiable {
    let id: String
    let address: String
}

struct PropertySummary: Decodable, Identifiable {
    let _id: String
    let address: String
    let claimNumber: String?
    let roomCount: Int?
    let floorSF: Double?
    var id: String { _id }
}

struct RoomMetrics: Decodable {
    let floorSF: Double
    let wallSF: Double
    let ceilingHeightFt: Double
}

struct RoomSummary: Decodable, Identifiable {
    let _id: String
    let name: String
    let floor: String
    let source: String
    let metrics: RoomMetrics
    var id: String { _id }
}

struct PropertyDetail: Decodable {
    let _id: String
    let address: String
    let floors: [String]
    let rooms: [RoomSummary]
}

struct APIErrorBody: Decodable { let error: String }

enum APIError: LocalizedError {
    case server(String), unauthorized, badURL
    var errorDescription: String? {
        switch self {
        case .server(let m): return m
        case .unauthorized: return "Your session expired. Sign in again."
        case .badURL: return "Check the server address."
        }
    }
}

// MARK: - Client

struct API {
    var server: String
    var token: String?

    private func request(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> Data {
        guard let url = URL(string: server.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)
        else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 60
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(status) else {
            let msg = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error ?? "Server error (\(status))"
            throw APIError.server(msg)
        }
        return data
    }

    func login(email: String, password: String) async throws -> String {
        struct Body: Encodable { let email: String; let password: String }
        struct Resp: Decodable { let token: String }
        let data = try await request("/api/auth/token", method: "POST", body: Body(email: email, password: password))
        return try JSONDecoder().decode(Resp.self, from: data).token
    }

    func properties() async throws -> [PropertySummary] {
        try JSONDecoder().decode([PropertySummary].self, from: await request("/api/interior/properties"))
    }

    func createProperty(address: String) async throws -> PropertySummary {
        struct Body: Encodable { let address: String }
        return try JSONDecoder().decode(PropertySummary.self,
            from: await request("/api/interior/properties", method: "POST", body: Body(address: address)))
    }

    func property(_ id: String) async throws -> PropertyDetail {
        try JSONDecoder().decode(PropertyDetail.self, from: await request("/api/interior/properties/\(id)"))
    }

    func uploadRoom(propertyId: String, upload: RoomUpload) async throws {
        _ = try await request("/api/interior/properties/\(propertyId)/rooms", method: "POST", body: upload)
    }
}

// MARK: - Keychain (token + login)

enum Keychain {
    static func set(_ value: String?, for key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
}

// MARK: - Session

@MainActor
final class SessionStore: ObservableObject {
    static let defaultServer = "https://rooftracepro.thepublicadjustertx.com"

    @Published var token: String? = Keychain.get("token")
    @Published var server: String = UserDefaults.standard.string(forKey: "server") ?? SessionStore.defaultServer
    @Published var path: [PropertyRef] = []
    /// Set by a deep link from the web app; PropertyView opens the scanner when it appears.
    @Published var autoScanPropertyId: String?

    var api: API { API(server: server, token: token) }

    func signIn(email: String, password: String) async throws {
        let t = try await API(server: server, token: nil).login(email: email, password: password)
        UserDefaults.standard.set(server, forKey: "server")
        Keychain.set(t, for: "token")
        token = t
    }

    func signOut() {
        Keychain.set(nil, for: "token")
        token = nil
        path = []
    }

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "rooftracescan",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        let q = Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        // A link pointing at a different server never receives the saved token:
        // switch servers and require a fresh sign-in there.
        if let s = q["server"], s.hasPrefix("https://"), s != server {
            server = s
            UserDefaults.standard.set(s, forKey: "server")
            signOut()
        }
        if let id = q["property"], !id.isEmpty {
            autoScanPropertyId = id
            path = [PropertyRef(id: id, address: q["address"] ?? "Property")]
        }
    }
}
