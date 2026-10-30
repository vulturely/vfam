# VFAM

VFAM is the desktop and mobile Tauri client for Vulture. It includes Vulture's responsive parent and child interfaces for family onboarding, tasks and chores, learning, worksheets and practice, timetables, dashboards, mailbox import, private chat and calls, resource settings, and FamBuddy parent controls.

The client connects to an existing Vulture server. This repository does not include the Vulture server, the FamBuddy Pi gateway, or the separate Kids/Elders apps.

## Native transport

The production runtime is Tauri-only. All Vulture gRPC, streaming, chat Socket.IO, attachment HTTP, and OIDC discovery traffic follows component → frontend service → frontend repository → Tauri command → Rust service → Rust repository. The UI does not use gRPC-Web, direct Socket.IO, or direct attachment/discovery HTTP.

`crates/vulture-protocol` contains only authoritative Vulture protobuf contracts and generates tonic clients and canonical protobuf JSON bindings; it contains no server business logic. Native streams and chat subscriptions use Tauri events with explicit close/cancellation lifecycles. Browser integration tests exercise real UI flows against strict IPC mocks rather than browser network transports.

### FamBuddy screen

The FamBuddy paired on your home network comes first: its listening, message and settings controls (**Your FamBuddy**), then **Waiting for your approval**. With nothing paired, the screen offers **Pair on home network**. **Away from home** is a separate, optional section listing FamBuddies registered with the family server; it needs that server on HTTPS port 443, and with any other server address (such as a local development server) it says so once and stays off instead of retrying. Outside-home approval setup appears only when the server qualifies.

Each device card has a **Captions** switch. With captions on, the card shows what the FamBuddy is saying now, and the FamBuddy's own screen shows the conversation; with captions off, neither shows any text.

Each device card and the FamBuddy settings also have a **Screen PIN**. It is needed on the FamBuddy's own screen before anyone changes its Wi-Fi there. A parent sets or changes it by entering 4 to 8 digits twice, or removes it; the card shows only whether a PIN is set. The app never stores or logs the PIN, and the hub keeps only a salted hash and locks after repeated wrong tries.

Each device card and the FamBuddy settings also show **Software updates**: the installed version and whether it is up to date, an update is available, it is updating, or the last update failed (the FamBuddy then keeps its previous version). A FamBuddy only installs signed releases. Automatic updates are off by default, so an available update waits until a parent chooses **Update now**; the FamBuddy pauses for 1 to 3 minutes while it updates. Turning on **Install updates automatically** lets that FamBuddy install signed updates on its own whenever it is idle.

**License.** Core FamBuddy features are free. A FamBuddy license from the Swavan App Platform unlocks the paid ones: On-device AI, Away-from-home access, Server alerts & email, and Live camera. The **FamBuddy license** section at the top of the FamBuddy screen (parents only) shows the family's license (none, active until a date, or expired on a date), its edition, and which paid features are on. Pasting a **License key** and choosing **Install** saves it on the family server (`SetFamilyLicense`), then sends it to every paired FamBuddy, at home and away; a FamBuddy that cannot take it is listed without holding back the others. **Remove license** clears it in both places. The key field is cleared afterwards; the app never stores or logs the key, which lives only on the family server and the FamBuddies. Each FamBuddy's settings show its own license, a paid control it lacks says "Needs a FamBuddy license", and a FamBuddy without the family's license offers **Install on this FamBuddy** (the key is pasted again, since the app does not keep it). Licenses need the family server on HTTPS port 443.

**On-device AI.** A child's question (or an unnamed voice's) is answered only by the FamBuddy's own AI. When it cannot answer, the FamBuddy says "I am unable to find an answer, please reach out to your parent for help." (shown in Chat as an informational reply that needs no action) and the question waits for a parent: its card in Chat says "Needs you — FamBuddy couldn't answer this" with who asked, and offers **Ask cloud AI** (sends it to that FamBuddy's AI provider; the answer still needs approval, and the button is disabled with a reason when no provider is set up), **Answer it yourself** (the parent's text becomes the answer, which then waits for approval like any other), and **Dismiss**. Each device card and the FamBuddy settings have **Family AI**: a **Family AI mode** for parents' questions (Local only, Local first with the cloud when needed, or Cloud only; `configure_ai_mode`) and whether **On-device AI** is available, which needs a FamBuddy with 4 GB or more of memory and a license with On-device AI.

In **Chat**, parents also see their FamBuddies, including the one paired on the home network ("FamBuddy at home"). A conversation can **Say it** (the FamBuddy speaks the message), **Ask AI** (the question goes to the FamBuddy's AI and the answer waits for approval in the same conversation before it is spoken; `/ask question` works too), broadcast to every FamBuddy with `/broadcast message`, and mute or turn listening back on from the microphone icon in the top bar. The live camera stays hidden until a parent opens it from the camera icon in the top bar or with `/camera`; closing it (or `/stop`) hides it again, and if it does not start the conversation says so. Typing `/` lists the commands; arrow keys move through them and Enter or Tab completes one. The message box has the message on top and Say it / Ask AI with Send underneath. With captions on, what the FamBuddy says appears in the conversation.

### FamBuddy approvals

While a parent is signed in, VFAM watches every paired FamBuddy, not only the one on screen. When a question or answer starts waiting for approval, the parent gets an OS notification ("Kitchen needs your approval — An answer is waiting for you in Chat.") and an in-app message with **Open**, which opens that FamBuddy's conversation in Chat, where it is approved, revised or rejected. Notifications never include the question or answer. Each waiting review is announced once; a revised or edited answer is announced again. A question the FamBuddy could not answer is announced once per question as "Kitchen needs you — a question is waiting". Watching stops when the parent signs out or a child session starts.

Every approval card says who asked and how ("Jamie asked aloud", "A parent asked in VFAM") and, for an answer, who wrote it (the FamBuddy's AI provider, family AI on a parent's device, the FamBuddy itself, a cloud AI a parent chose, or a parent). A pending answer can be **revised**: the parent writes how it should change ("make it simpler") and it goes back to the AI that wrote it, with the original question; the new answer waits for approval again. With family AI on a parent's device, that device writes the revision just as it answers an approved question.

In the FamBuddy's settings, **Voices** lists every voice the FamBuddy knows; a parent names each one and marks it Child or Parent. A voice without a name counts as a child. A child's question is answered on the FamBuddy first and is never sent to a cloud AI unless a parent chooses to.

On desktop, closing the window keeps VFAM running in the menu bar (macOS) or system tray so approvals and help alerts keep arriving; **Quit VFAM** in the tray menu stops it, and clicking the Dock icon on macOS brings the window back. VFAM turns on starting at login once; if a parent switches that off in the system's login items, VFAM leaves it off.

### Staying connected

A FamBuddy's live updates come over one long-lived stream. If it drops (Wi-Fi change, the computer sleeping, the FamBuddy restarting), the app shows the reason followed by "Reconnecting…" and reconnects on its own after 1, 2, 5, 10 and then every 30 seconds, clearing the notice once updates arrive again. It stops when no screen is using that FamBuddy. Home-network connections also send HTTP/2 keepalive pings every 20 seconds.

### Family chat on a new device

A child's new device joins family chat only after a parent approves it (parents' own devices are approved automatically). Until then, Chat says "Waiting for a parent to approve this device" instead of trying to read or send messages, and starts again as soon as the approval arrives. A parent approves it in Chat under Device security.

### Home-network FamBuddy certificates

A FamBuddy hub signs its HTTPS certificate with its own private authority, which this app never adds to the system trust store. Before pairing, **Check device** reads the certificate the hub presents (`fambuddy_certificate`) and shows its SHA-256 fingerprint. Compare it with the one the FamBuddy prints:

```sh
sudo openssl x509 -in /etc/fambuddy/hub/server.crt -noout -fingerprint -sha256
```

Only if they match, **They match, connect** confirms it (`fambuddy_trust`, which checks the hub still presents the same certificate) and pairs. The fingerprint is saved per hub address in `fambuddy-certificates.json` in the app data folder. Every later gateway call, stream and parent-device AI answer to that address accepts only that exact certificate; a changed certificate is refused with "This FamBuddy's certificate changed", and an address with no confirmed certificate is refused until it is checked.

## Requirements

- Node.js and npm
- Stable Rust with rustfmt, Clippy, and `cargo-llvm-cov`
- Native Tauri prerequisites for the target platform
- Chromium and WebKit for browser integration tests
- A reachable Vulture server and a public OIDC client registration for real sign-in

Install dependencies and start the desktop development client:

```sh
npm install
npx playwright install chromium webkit
npm run tauri dev
```

Use `npm run dev` for IPC-mocked browser integration tests and `npm run tauri build` for desktop bundles.

Public client configuration uses these nonsecret build-time values:

```sh
VITE_SERVER_URL=https://vulture.swavan.com
VITE_OIDC_AUTHORITY=https://auth.swavan.io/auth/v1/
VITE_OIDC_CLIENT_ID=vulturefam
VITE_OIDC_DESKTOP_REDIRECT_URI=http://127.0.0.1:7793/login/callback
```

The hosted Vulture service is the default. Set `VITE_SERVER_URL=https://localhost:50051` explicitly when developing against a local server. Never put OIDC client secrets, access tokens, AI keys, or other credentials in `VITE_*` variables.

## macOS keychain prompts

The app keeps three keychain items: the display cache key (`com.swavan.vfam.cache`), FamBuddy secure storage, and the family AI key (`com.swavan.vfam.family-ai`). macOS remembers **Always Allow** for one code signature. Development builds are otherwise given a new ad-hoc signature by every rebuild, so the Keychain asks again after each one.

To stop that during development, create one local signing certificate once: Keychain Access → Certificate Assistant → Create a Certificate…, name `VFam Development`, identity type **Self Signed Root**, certificate type **Code Signing**. The Cargo runner in `.cargo/config.toml` (`scripts/dev/macos-sign-run.sh`) then signs each dev build of the app with it, so **Always Allow** keeps working after rebuilds. Use another identity with `VFAM_DEV_SIGNING_IDENTITY`. Without the certificate the app runs unchanged and the Keychain keeps asking.

Release bundles keep one identity across versions only when signed. `npm run tauri build` on macOS stops unless `APPLE_SIGNING_IDENTITY` names the Developer ID Application identity; set `VFAM_ALLOW_UNSIGNED_BUNDLE=1` for a local test bundle.

## Encrypted local cache

Installed desktop and mobile apps use SQLCipher for non-authoritative display caching. A random 32-byte key is held by the operating system credential store: macOS/iOS Keychain, Android Keystore-backed storage, Windows Credential Manager, or Linux Secret Service. There is no plaintext key file, plaintext fallback, or JavaScript access to the key.

The SQLCipher database and its WAL are stored in the app-private `display-cache` directory. FamBuddy's existing encrypted files and reference index use the same SQLCipher implementation. Private-chat MLS state and FamBuddy credentials retain their separate encrypted storage paths.

Family/member metadata and task lists use five-minute fresh cache entries with account/server isolation and mutation/sign-out invalidation. If the network is unavailable, the UI may show clearly labeled stale read-only data. Cached data never restores sessions, PINs, parent/child authority, timetable/policy leases, device telemetry, or permission to perform an action. Browser test builds do not substitute a plaintext implementation of the native cache.

## Workspace layout

- `src/`: thin SvelteKit routes and application configuration
- `packages/core/`: Vulture UI, services, transport repositories, and tests
- `packages/data`, `packages/plugin-sdk`, `packages/markdown-editor/`: shared client packages
- `plugins/identity/`: identity plugin
- `src-tauri/`: Tauri composition plus command, service, and repository layers
- `crates/`: generated protocol clients, native chat crypto, and encrypted device vault crates
- `tests/integration/`: Playwright journeys and native IPC test boundaries

## Verification

```sh
npm run lint
npm run format:check
npm run check
npm run check:rust
npm run build
npm test
```

`npm test` enforces at least 90% UI statement, branch, function, and line coverage from the combined Vitest and instrumented Playwright report, plus at least 90% Rust line coverage for testable backend code. Browser integration tests use real UI and crypto boundaries with synthetic native IPC responses and contribute source-mapped coverage to the same threshold; they do not prove a hosted deployment or native platform security by themselves.

CI (`.github/workflows/test.yml`) runs this suite in Docker on the self-hosted runner for every pull request and for pushes to `main`; other branch pushes are covered by their pull request so the suite is not run twice. Unit tests allow 30 seconds each because whole-screen behavior tests can exceed Vitest's 5-second default on a busy shared runner.

## Mobile

Initialize targets when setting up a new checkout:

```sh
npm run tauri android init
npm run tauri ios init
```

Use `npm run tauri android dev` or `npm run tauri ios dev` on a configured machine. Android's native Keystore context is initialized by the host. Device/emulator verification also requires the platform SDKs, signing configuration, and reachable Vulture/OIDC services.
