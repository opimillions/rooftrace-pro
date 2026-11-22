import SwiftUI

@main
struct RoofTraceScanApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.dark)
                .tint(Brand.blue)
                // rooftracescan://scan?property=<id>&address=<addr>&server=<origin>
                .onOpenURL { url in session.handleDeepLink(url) }
        }
    }
}

enum Brand {
    static let bg = Color(red: 0.06, green: 0.09, blue: 0.16)      // #0f172a
    static let panel = Color(red: 0.12, green: 0.16, blue: 0.23)   // #1e293b
    static let blue = Color(red: 0.15, green: 0.39, blue: 0.92)    // #2563eb
    static let amber = Color(red: 0.96, green: 0.62, blue: 0.04)   // #f59e0b
    static let green = Color(red: 0.09, green: 0.64, blue: 0.29)   // #16a34a
}

struct RootView: View {
    @EnvironmentObject var session: SessionStore

    var body: some View {
        if session.token == nil {
            LoginView()
        } else {
            NavigationStack(path: $session.path) {
                PropertiesView()
                    .navigationDestination(for: PropertyRef.self) { ref in
                        PropertyView(ref: ref)
                    }
            }
        }
    }
}
