import SwiftUI

// MARK: - Sign in (same account as the RoofTrace Pro website)

struct LoginView: View {
    @EnvironmentObject var session: SessionStore
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showServer = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        (Text("Roof") + Text("Trace").foregroundColor(Brand.amber) + Text(" Scan")).font(.largeTitle.bold())
                        Text("LiDAR room measurements for RoofTrace Pro").font(.subheadline).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                Section("Your RoofTrace Pro account") {
                    TextField("Email", text: $email)
                        .textContentType(.username).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password)
                }
                if showServer {
                    Section("Server") {
                        TextField("Server", text: $session.server)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button {
                        Task {
                            busy = true; error = nil
                            do { try await session.signIn(email: email, password: password) }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text("Sign In").bold() }; Spacer() }
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                }
                Section {
                    Button(showServer ? "Hide server" : "Change server") { showServer.toggle() }
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Brand.bg)
        }
    }
}

// MARK: - Properties

struct PropertiesView: View {
    @EnvironmentObject var session: SessionStore
    @State private var items: [PropertySummary] = []
    @State private var loading = true
    @State private var error: String?
    @State private var showNew = false
    @State private var newAddress = ""

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            ForEach(items) { p in
                NavigationLink(value: PropertyRef(id: p._id, address: p.address)) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(p.address).font(.headline)
                        Text("\(p.roomCount ?? 0) rooms · \(fmt(p.floorSF ?? 0)) ft²").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !loading && items.isEmpty && error == nil {
                ContentUnavailableView("No properties yet", systemImage: "house",
                                       description: Text("Tap + to add the property you're inspecting."))
            }
        }
        .overlay { if loading && items.isEmpty { ProgressView() } }
        .navigationTitle("Properties")
        .toolbar {
            ToolbarItem(placement: .primaryAction) { Button { showNew = true } label: { Image(systemName: "plus") } }
            ToolbarItem(placement: .topBarLeading) { Button("Sign Out") { session.signOut() }.font(.footnote) }
        }
        .refreshable { await load() }
        .task { await load() }
        .alert("New Property", isPresented: $showNew) {
            TextField("Property address", text: $newAddress)
            Button("Cancel", role: .cancel) { newAddress = "" }
            Button("Create") {
                Task {
                    do {
                        let p = try await session.api.createProperty(address: newAddress)
                        newAddress = ""
                        await load()
                        session.path.append(PropertyRef(id: p._id, address: p.address))
                    } catch { self.error = error.localizedDescription }
                }
            }
        }
    }

    private func load() async {
        loading = true
        do { items = try await session.api.properties(); error = nil }
        catch APIError.unauthorized { session.signOut() }
        catch { self.error = error.localizedDescription }
        loading = false
    }
}

// MARK: - One property: rooms + scan

struct PropertyView: View {
    let ref: PropertyRef
    @EnvironmentObject var session: SessionStore
    @State private var detail: PropertyDetail?
    @State private var error: String?
    @State private var scanning = false

    private var floors: [String] {
        var f = detail?.floors ?? ["Entrance Floor"]
        detail?.rooms.forEach { if !f.contains($0.floor) { f.append($0.floor) } }
        return f
    }

    var body: some View {
        List {
            Section {
                Button { scanning = true } label: {
                    Label("Scan a Room", systemImage: "camera.metering.matrix").font(.headline)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent).tint(Brand.green)
                .listRowBackground(Color.clear)
            }
            if let error { Text(error).foregroundStyle(.red) }
            if let d = detail {
                ForEach(floors, id: \.self) { f in
                    let rooms = d.rooms.filter { $0.floor == f }
                    if !rooms.isEmpty {
                        Section {
                            ForEach(rooms) { r in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(r.name).font(.headline)
                                        Text("Walls \(fmt(r.metrics.wallSF)) ft² · \(fmt(r.metrics.ceilingHeightFt))' ceiling")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text("\(fmt(r.metrics.floorSF)) ft²").bold().foregroundStyle(Brand.blue)
                                }
                            }
                        } header: {
                            HStack { Text(f); Spacer(); Text("\(fmt(rooms.reduce(0) { $0 + $1.metrics.floorSF })) ft²") }
                        }
                    }
                }
                if d.rooms.isEmpty {
                    Text("No rooms yet. Tap Scan a Room and walk the first room.").foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(ref.address)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task {
            await load()
            if session.autoScanPropertyId == ref.id { session.autoScanPropertyId = nil; scanning = true }
        }
        .fullScreenCover(isPresented: $scanning) {
            ScanView(property: ref, floors: floors) { Task { await load() } }
                .environmentObject(session)
        }
    }

    private func load() async {
        do { detail = try await session.api.property(ref.id); error = nil }
        catch APIError.unauthorized { session.signOut() }
        catch { self.error = error.localizedDescription }
    }
}

func fmt(_ v: Double) -> String {
    v.formatted(.number.precision(.fractionLength(v < 20 ? 1 : 0)))
}
