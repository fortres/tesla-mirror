# tesla-mirror v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android app that mirrors the phone screen into the Tesla browser over WebRTC and injects touches from the browser back into the phone.

**Architecture:** One Android app (Kotlin) runs a foreground service with an embedded Ktor HTTP+WebSocket server, a libwebrtc screen-capture video track, and an AccessibilityService that turns finger snapshots into continued gesture strokes. A plain HTML/JS page served from the APK plays the stream and sends touch snapshots. All pure logic (protocol, coordinate mapping, gesture streaming, touch normalization) lives in framework-free units with unit tests.

**Tech Stack:** Kotlin 2.3.21, AGP 8.13.2, Gradle 8.14.6, minSdk 30 / compileSdk 35 / targetSdk 34, Ktor 3.6.0 (server-cio, server-websockets, server-test-host), kotlinx-serialization-json 1.9.0, io.getstream:stream-webrtc-android 1.3.10, JUnit 4, Node 22 (`node --test`, built-in `WebSocket`).

**Spec:** `docs/superpowers/specs/2026-10-18-tesla-mirror-design.md`. Living docs in `docs/` (architecture, protocol, development, device-setup, car-checklist) must be kept in sync by every task that changes behavior (AGENTS.md golden rule).

## Global Constraints

- Android 11+ (minSdk 30), stock OS, no root, no Play Store mechanisms.
- Everything in the repo in English; comments only where logic is non-obvious.
- Commit only complete tasks; message 1–2 lines; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Web page: plain HTML/JS ES modules, no build step, no framework.
- Protocol exactly as `docs/protocol.md`: inbound `offer|ice|touch|key`, outbound `state|answer|ice`; `touch.pts` is a full snapshot, empty = all up.
- Constants: capture at half scale, 30 fps, 4 Mbit/s max, H.264 preferred; port 8080; WS reconnect backoff 1–5 s; touch watchdog 500 ms; stroke split before 60 s (use 50 s); gesture segment 20 ms; tap 50 ms.
- One WS client at a time; a new connection closes the previous one.
- Pure logic (`Protocol`, `CoordMapper`, `GestureStreamer`, `touch.js` functions) must not depend on Android or DOM APIs.
- Package `com.fortres.teslamirror`. Logcat tag `TeslaMirror`.

## Review Focus

1. Touch starting in the letterbox (outside the video box) must be ignored, not clamped onto the edge of the phone screen → test in Task 5 (`normalize` returns `null` outside the box; `snapshot` drops such touches).
2. Malformed or unknown WebSocket messages must not kill the socket loop → test in Task 1 (`Protocol.parse` returns `null`) and Task 4 (server stays connected after junk).
3. Browser reuses touch identifiers: an id released and pressed again must start a new stroke, not continue the old one → test in Task 2.
4. WS drops while a finger is down: fingers must be released after 500 ms without snapshots → test in Task 2 (watchdog inside `GestureStreamer`).
5. H.264 rejects odd frame sizes; capture size must be even after halving → test in Task 6 (`captureSize`).

---

### Task 0: Project scaffold

**Files:**
- Create: `.gitignore`, `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties`, `gradle/libs.versions.toml`, `gradle/wrapper/*` (via `gradle wrapper`), `app/build.gradle.kts`, `app/proguard-rules.pro`, `app/src/main/AndroidManifest.xml`, `app/src/main/res/values/strings.xml`, `app/src/main/res/values/themes.xml`, `app/src/main/java/com/fortres/teslamirror/MainActivity.kt` (placeholder), `web/public/index.html` (placeholder), `web/package.json`
- Modify: `AGENTS.md` (status line), `docs/development.md` (Node 22, API 30 image commands)

**Interfaces:**
- Produces: Gradle build where `app` compiles, unit tests run with `./gradlew test`, `web/public/**` is on the app classpath as `public/...` resources, `cd web && node --test` runs `test/*.test.mjs`.

- [ ] **Step 1: Generate the Gradle wrapper**

Run (needs a one-off Gradle; use the wrapper from any existing project or `sdkmanager`-independent download):
```bash
cd ~/projects/tesla-mirror && (gradle wrapper --gradle-version 8.14.6 2>/dev/null || \
  (curl -sLo /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.14.6-bin.zip && unzip -q /tmp/gradle.zip -d /tmp && /tmp/gradle-8.14.6/bin/gradle wrapper --gradle-version 8.14.6))
```
Expected: `gradlew`, `gradlew.bat`, `gradle/wrapper/` created.

- [ ] **Step 2: Write `gradle/libs.versions.toml`**

Versions: `agp = "8.13.2"`, `kotlin = "2.3.21"`, `serialization = "1.9.0"`, `ktor = "3.6.0"`, `webrtc = "1.3.10"`, `coroutines = "1.10.2"`, `junit = "4.13.2"`. Libraries: `ktor-server-core`, `ktor-server-cio`, `ktor-server-websockets`, `ktor-server-test-host`, `ktor-client-websockets` (test), `kotlinx-serialization-json`, `kotlinx-coroutines-android`, `kotlinx-coroutines-test`, `stream-webrtc-android`, `junit`. Plugins: `android-application`, `kotlin-android`, `kotlin-serialization`.

- [ ] **Step 3: Write root and app build files**

`settings.gradle.kts`: pluginManagement + dependencyResolutionManagement with `google()` and `mavenCentral()`, `rootProject.name = "tesla-mirror"`, `include(":app")`.

`app/build.gradle.kts`: `namespace = "com.fortres.teslamirror"`, `compileSdk = 35`, `minSdk = 30`, `targetSdk = 34`, `versionCode = 1`, `versionName = "0.1"`, Java 17 toolchain, `buildFeatures { viewBinding = true }`, and:
```kotlin
sourceSets["main"].resources.srcDir("../web")   // web/public/** becomes classpath "public/**"
packaging { resources.excludes += setOf("test/**", "package.json", "META-INF/INDEX.LIST", "META-INF/io.netty.versions.properties") }
```
`gradle.properties`: `org.gradle.jvmargs=-Xmx2g`, `android.useAndroidX=true`, `kotlin.code.style=official`.

- [ ] **Step 4: Write the manifest and placeholder activity**

Manifest permissions: `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `FOREGROUND_SERVICE_SPECIAL_USE`, `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS`, `ACCESS_NETWORK_STATE`. Only `MainActivity` (launcher, `screenOrientation="unspecified"`) for now. `MainActivity.kt` sets a content view with one `TextView` "tesla-mirror".

- [ ] **Step 5: Write `.gitignore`, `web/package.json`, `web/public/index.html` placeholder**

`.gitignore`: `.gradle/`, `build/`, `local.properties`, `*.iml`, `.idea/`, `.kotlin/`, `captures/`, `node_modules/`, `*.apk`, `*.keystore`.
`web/package.json`: `{"name":"tesla-mirror-web","private":true,"type":"module","scripts":{"test":"node --test test/"}}`.
`web/public/index.html`: minimal document with `<title>tesla-mirror</title>`.

- [ ] **Step 6: Build**

Run: `./gradlew assembleDebug --console=plain`
Expected: `BUILD SUCCESSFUL`, `app/build/outputs/apk/debug/app-debug.apk` exists, and `unzip -l app/build/outputs/apk/debug/app-debug.apk | grep public/index.html` prints one line.

- [ ] **Step 7: Update docs**

`docs/development.md`: Node 22+ (built-in WebSocket); add under Requirements:
```
sdkmanager "system-images;android-30;google_apis;x86_64"
avdmanager create avd -n tesla-mirror -k "system-images;android-30;google_apis;x86_64" -d pixel_2_xl
```
`AGENTS.md` Status: "Scaffold in place, implementation in progress; see docs/superpowers/plans/".

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Scaffold Android app and web module
" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Protocol messages

**Files:**
- Create: `app/src/main/java/com/fortres/teslamirror/net/Protocol.kt`
- Test: `app/src/test/java/com/fortres/teslamirror/net/ProtocolTest.kt`

**Interfaces:**
- Produces:
```kotlin
data class Point(val id: Int, val x: Float, val y: Float)
sealed interface Inbound {
    data class Offer(val sdp: String) : Inbound
    data class Ice(val candidate: JsonObject) : Inbound
    data class Touch(val pts: List<Point>) : Inbound
    data class Key(val key: String) : Inbound          // "back" | "home" | "recents"
}
object Protocol {
    fun parse(text: String): Inbound?                   // null for junk or unknown "t"
    fun state(capturing: Boolean, accessibility: Boolean, captureW: Int, captureH: Int): String
    fun answer(sdp: String): String
    fun ice(candidate: JsonObject): String
}
```

- [ ] **Step 1: Write failing tests**

```kotlin
class ProtocolTest {
    @Test fun parsesTouchSnapshot() {
        val m = Protocol.parse("""{"t":"touch","pts":[{"id":0,"x":0.42,"y":0.71},{"id":1,"x":0.58,"y":0.33}]}""")
        assertEquals(Inbound.Touch(listOf(Point(0, 0.42f, 0.71f), Point(1, 0.58f, 0.33f))), m)
    }
    @Test fun parsesEmptyTouchAsAllUp() = assertEquals(Inbound.Touch(emptyList()), Protocol.parse("""{"t":"touch","pts":[]}"""))
    @Test fun parsesKey() = assertEquals(Inbound.Key("back"), Protocol.parse("""{"t":"key","k":"back"}"""))
    @Test fun parsesOfferAndIce() {
        assertEquals(Inbound.Offer("v=0"), Protocol.parse("""{"t":"offer","sdp":"v=0"}"""))
        val ice = Protocol.parse("""{"t":"ice","candidate":{"candidate":"c","sdpMid":"0"}}""") as Inbound.Ice
        assertEquals("c", ice.candidate["candidate"]!!.jsonPrimitive.content)
    }
    @Test fun junkReturnsNull() {
        assertNull(Protocol.parse("not json"))
        assertNull(Protocol.parse("""{"t":"nope"}"""))
        assertNull(Protocol.parse("""{"t":"touch"}"""))
        assertNull(Protocol.parse("""{"t":"key"}"""))
    }
    @Test fun buildsState() {
        val j = Json.parseToJsonElement(Protocol.state(true, false, 1440, 720)).jsonObject
        assertEquals("state", j["t"]!!.jsonPrimitive.content)
        assertEquals(true, j["capturing"]!!.jsonPrimitive.boolean)
        assertEquals(false, j["accessibility"]!!.jsonPrimitive.boolean)
        assertEquals(1440, j["capture"]!!.jsonObject["w"]!!.jsonPrimitive.int)
    }
    @Test fun buildsAnswerAndIce() {
        assertEquals("""{"t":"answer","sdp":"v=0"}""", Protocol.answer("v=0"))
        assertEquals("""{"t":"ice","candidate":{"candidate":"c"}}""", Protocol.ice(buildJsonObject { put("candidate", "c") }))
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `./gradlew :app:testDebugUnitTest --tests '*ProtocolTest*' --console=plain`
Expected: compilation failure (`Protocol` unresolved).

- [ ] **Step 3: Implement `Protocol.kt`**

Use `Json { ignoreUnknownKeys = true }` and manual `JsonObject` reading; wrap parsing in `runCatching { }.getOrNull()`. Keys: `t`, `sdp`, `candidate`, `pts[].id|x|y`, `k`.

- [ ] **Step 4: Run tests**

Run: `./gradlew :app:testDebugUnitTest --tests '*ProtocolTest*' --console=plain`
Expected: `BUILD SUCCESSFUL`, 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add WebSocket protocol parser and builders" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: CoordMapper and GestureStreamer (pure Kotlin)

**Files:**
- Create: `app/src/main/java/com/fortres/teslamirror/input/CoordMapper.kt`, `app/src/main/java/com/fortres/teslamirror/input/GestureStreamer.kt`
- Test: `app/src/test/java/com/fortres/teslamirror/input/CoordMapperTest.kt`, `app/src/test/java/com/fortres/teslamirror/input/GestureStreamerTest.kt`

**Interfaces:**
- Produces:
```kotlin
object CoordMapper {
    fun toPixels(nx: Float, ny: Float, width: Int, height: Int): Pair<Float, Float>  // clamp to [0,1], scale, max width-1 / height-1
}
data class Finger(val id: Int, val x: Float, val y: Float)   // pixels
data class Segment(val id: Int, val fromX: Float, val fromY: Float, val toX: Float, val toY: Float,
                   val durationMs: Long, val willContinue: Boolean, val isNew: Boolean)
class GestureStreamer(val segmentMs: Long = 20, val tapMs: Long = 50, val maxStrokeMs: Long = 50_000, val watchdogMs: Long = 500) {
    fun onSnapshot(fingers: List<Finger>, nowMs: Long)
    fun nextBatch(nowMs: Long): List<Segment>   // empty when nothing to dispatch
    fun releaseAll()
    val hasFingers: Boolean
}
```
Semantics: each finger has `current` (where the injected stroke is), `target` (latest snapshot), `down`, `started`, `strokeStartMs`. `onSnapshot` sets `target` for known ids, adds unknown ids (`current = target`, `started = false`), marks missing ids `down = false`, records `lastSnapshotMs`. `nextBatch` emits one segment per finger: `isNew = !started`, `from = current`, `to = target`, `willContinue = down && (now - strokeStartMs) < maxStrokeMs`; a finger that is `!started && !down` is a tap: `from == to`, `durationMs = tapMs`; everything else `durationMs = segmentMs`. After emitting: `current = target`; `started = willContinue`; if `!down` remove; if the stroke was cut by `maxStrokeMs`, keep the finger with `started = false`, `strokeStartMs = now`. If `now - lastSnapshotMs > watchdogMs` and fingers are down, treat as `releaseAll()` before building the batch.

- [ ] **Step 1: Write failing tests**

```kotlin
class CoordMapperTest {
    @Test fun scales() = assertEquals(500f to 250f, CoordMapper.toPixels(0.5f, 0.5f, 1000, 500))
    @Test fun clamps() = assertEquals(999f to 0f, CoordMapper.toPixels(1.2f, -1f, 1000, 500))
}

class GestureStreamerTest {
    private fun f(id: Int, x: Float, y: Float) = Finger(id, x, y)

    @Test fun tapWithinOneTickIsSingleShortStroke() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 100f, 200f)), 0); s.onSnapshot(emptyList(), 5)
        assertEquals(listOf(Segment(0, 100f, 200f, 100f, 200f, 50, willContinue = false, isNew = true)), s.nextBatch(10))
        assertTrue(s.nextBatch(30).isEmpty()); assertFalse(s.hasFingers)
    }
    @Test fun holdEmitsContinuedZeroLengthSegments() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 10f, 10f)), 0)
        assertEquals(listOf(Segment(0, 10f, 10f, 10f, 10f, 20, true, isNew = true)), s.nextBatch(0))
        assertEquals(listOf(Segment(0, 10f, 10f, 10f, 10f, 20, true, isNew = false)), s.nextBatch(20))
    }
    @Test fun moveContinuesFromLastPoint() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(listOf(f(0, 10f, 10f)), 15)
        assertEquals(listOf(Segment(0, 0f, 0f, 10f, 10f, 20, true, false)), s.nextBatch(20))
    }
    @Test fun releaseEndsStroke() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(emptyList(), 30)
        assertEquals(listOf(Segment(0, 0f, 0f, 0f, 0f, 20, false, false)), s.nextBatch(40))
        assertTrue(s.nextBatch(60).isEmpty())
    }
    @Test fun twoFingersInOneBatch() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f), f(1, 50f, 50f)), 0)
        assertEquals(setOf(0, 1), s.nextBatch(0).map { it.id }.toSet())
    }
    @Test fun strokeIsSplitBeforeMaxDuration() {
        val s = GestureStreamer(maxStrokeMs = 100)
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        assertEquals(false, s.nextBatch(150).single().willContinue)
        assertEquals(true, s.nextBatch(170).single().isNew)
        assertTrue(s.hasFingers)
    }
    @Test fun reusedIdAfterReleaseIsNewStroke() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(emptyList(), 20); s.nextBatch(20)
        s.onSnapshot(listOf(f(0, 5f, 5f)), 40)
        assertEquals(true, s.nextBatch(40).single().isNew)
    }
    @Test fun watchdogReleasesStaleFingers() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        assertEquals(false, s.nextBatch(600).single().willContinue)
        assertFalse(s.hasFingers)
    }
    @Test fun releaseAllFinishesEveryFinger() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f), f(1, 1f, 1f)), 0); s.nextBatch(0)
        s.releaseAll()
        assertTrue(s.nextBatch(20).all { !it.willContinue }); assertFalse(s.hasFingers)
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `./gradlew :app:testDebugUnitTest --tests '*input*' --console=plain`
Expected: compilation failure.

- [ ] **Step 3: Implement `CoordMapper.kt` and `GestureStreamer.kt`** per the semantics above. Keep per-finger state in a `LinkedHashMap<Int, FingerState>` so batch order is stable.

- [ ] **Step 4: Run tests**

Run: `./gradlew :app:testDebugUnitTest --tests '*input*' --console=plain`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add coordinate mapping and gesture streaming logic" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: InputService (AccessibilityService)

**Files:**
- Create: `app/src/main/java/com/fortres/teslamirror/input/InputService.kt`, `app/src/main/java/com/fortres/teslamirror/input/InputBridge.kt`, `app/src/main/res/xml/accessibility_service.xml`
- Modify: `app/src/main/AndroidManifest.xml`, `app/src/main/res/values/strings.xml`

**Interfaces:**
- Consumes: `Point`, `CoordMapper`, `GestureStreamer`, `Segment`.
- Produces:
```kotlin
object InputBridge {
    @Volatile var service: InputService? = null          // set in onServiceConnected, cleared in onDestroy
    val enabled: Boolean get() = service != null
}
class InputService : AccessibilityService() {
    fun onTouch(pts: List<Point>)                        // normalized; safe from any thread
    fun onKey(key: String)                               // back | home | recents
}
```

- [ ] **Step 1: Register the service**

`accessibility_service.xml`: `android:canPerformGestures="true"`, `android:accessibilityEventTypes="typeWindowStateChanged"`, `android:accessibilityFeedbackType="feedbackGeneric"`, `android:description="@string/accessibility_description"`. Manifest: `<service android:name=".input.InputService" android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE" android:exported="true">` with the `AccessibilityService` intent filter and `meta-data android.accessibilityservice`.

- [ ] **Step 2: Implement `InputService.kt`**

- Main-thread `Handler`; `onTouch` posts to it. Map each point with `CoordMapper.toPixels` using `windowManager.currentWindowMetrics.bounds` (read per call, so rotation is honored). Call `streamer.onSnapshot(fingers, SystemClock.uptimeMillis())`, then `pump()`.
- `pump()`: if a dispatch is in flight, return. `batch = streamer.nextBatch(now)`; if empty, return. Build one `GestureDescription`: for each `Segment`, `Path().apply { moveTo(fromX, fromY); lineTo(toX, toY) }`; `isNew` or no stroke stored for `id` → `StrokeDescription(path, 0, durationMs, willContinue)`, else `strokes[id].continueStroke(path, 0, durationMs, willContinue)`. Store the stroke in `strokes[id]` when `willContinue`, else remove. `dispatchGesture(gesture, callback, null)`; on `onCompleted`/`onCancelled` set in flight false and `pump()` again. If `dispatchGesture` returns false: clear `strokes`, `streamer.releaseAll()`, log.
- While fingers are held and no snapshot arrives, `pump()` keeps dispatching hold segments through the completion callback; the watchdog inside `GestureStreamer` ends them after 500 ms.
- `onKey`: `performGlobalAction(GLOBAL_ACTION_BACK | GLOBAL_ACTION_HOME | GLOBAL_ACTION_RECENTS)`.
- `onAccessibilityEvent`/`onInterrupt`: no-op.

- [ ] **Step 3: Build and verify on the emulator**

Run: `./gradlew installDebug`; in the emulator enable the service under Settings → Accessibility. Then from `adb shell` confirm it is bound:
```bash
adb shell settings get secure enabled_accessibility_services
```
Expected: contains `com.fortres.teslamirror/.input.InputService`. (Gesture injection is exercised end-to-end in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Add accessibility service that injects streamed gestures" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: WebServer (Ktor)

**Files:**
- Create: `app/src/main/java/com/fortres/teslamirror/net/WebServer.kt`
- Test: `app/src/test/java/com/fortres/teslamirror/net/WebServerTest.kt`

**Interfaces:**
- Consumes: `Protocol`, `Inbound`.
- Produces:
```kotlin
class WebServer(private val port: Int = 8080, private val devDir: File? = null, private val listener: Listener) {
    interface Listener {
        fun onClientConnected()
        fun onMessage(msg: Inbound)
        fun onClientDisconnected()
    }
    fun start()
    fun stop()
    fun send(text: String)                     // to the current client; no-op without one
    fun Application.module()                   // routes; used directly by tests
}
```
Routes: `GET /` and static files from classpath `public/` (`staticResources("/", "public") { default("index.html") }`), or from `devDir` when it is non-null and exists (`staticFiles("/", devDir)`); `webSocket("/ws")` with `pingPeriod = 15 s`. Single client: keep `AtomicReference<DefaultWebSocketServerSession?>`; on a new session close the previous with `CloseReason.Codes.GOING_AWAY`. Text frames → `Protocol.parse` → `listener.onMessage` when non-null; junk is ignored. Server: `embeddedServer(CIO, port = port, host = "0.0.0.0") { module() }`, `start(wait = false)`, `stop(500, 1000)`.

- [ ] **Step 1: Write failing tests**

```kotlin
class WebServerTest {
    private class Rec : WebServer.Listener {
        val msgs = mutableListOf<Inbound>(); var connected = 0; var disconnected = 0
        override fun onClientConnected() { connected++ }
        override fun onMessage(msg: Inbound) { msgs += msg }
        override fun onClientDisconnected() { disconnected++ }
    }
    @Test fun servesIndex() = testApplication {
        val server = WebServer(listener = Rec()); application { with(server) { module() } }
        val r = client.get("/"); assertEquals(HttpStatusCode.OK, r.status); assertTrue(r.bodyAsText().contains("<title>tesla-mirror</title>"))
    }
    @Test fun deliversParsedMessagesAndIgnoresJunk() = testApplication {
        val rec = Rec(); val server = WebServer(listener = rec); application { with(server) { module() } }
        val c = createClient { install(WebSockets) }
        c.webSocket("/ws") {
            send("junk"); send("""{"t":"key","k":"home"}""")
            server.send("""{"t":"state"}""")
            assertEquals("""{"t":"state"}""", (incoming.receive() as Frame.Text).readText())
        }
        assertEquals(listOf(Inbound.Key("home")), rec.msgs); assertEquals(1, rec.connected)
    }
    @Test fun secondClientReplacesFirst() = testApplication {
        val server = WebServer(listener = Rec()); application { with(server) { module() } }
        val c = createClient { install(WebSockets) }
        val first = c.webSocketSession("/ws")
        c.webSocket("/ws") { server.send("hi"); assertEquals("hi", (incoming.receive() as Frame.Text).readText()) }
        val close = first.closeReason.await(); assertEquals(CloseReason.Codes.GOING_AWAY.code, close?.code)
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `./gradlew :app:testDebugUnitTest --tests '*WebServerTest*' --console=plain`
Expected: compilation failure.

- [ ] **Step 3: Implement `WebServer.kt`**

Call `listener.onClientConnected()` after the session became current. In the handler's `finally`, call `listener.onClientDisconnected()` only when `current.compareAndSet(session, null)` succeeds, so a replaced session going away does not report a disconnect for the client that replaced it.

- [ ] **Step 4: Run tests**

Run: `./gradlew :app:testDebugUnitTest --tests '*WebServerTest*' --console=plain`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add embedded HTTP and WebSocket server" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Browser page

**Files:**
- Create: `web/public/index.html` (replace placeholder), `web/public/style.css`, `web/public/app.js`, `web/public/ws.js`, `web/public/peer.js`, `web/public/touch.js`, `web/public/debug.js`
- Test: `web/test/touch.test.mjs`, `web/test/ws.test.mjs`

**Interfaces:**
- Produces (`touch.js`, pure):
```js
export function videoBox(viewportW, viewportH, aspect)          // -> {x, y, w, h}: largest box of `aspect` (w/h) centered in viewport
export function normalize(clientX, clientY, box)                 // -> {x, y} in 0..1, or null when outside box
export function snapshot(touches, box)                           // touches: iterable of {identifier, clientX, clientY} -> [{id, x, y}], outside-box touches dropped
export function createCoalescer(send, schedule)                  // {push(pts), flush()}; schedule(fn) called once per pending frame; flush sends only the latest pts
```
- Produces (`ws.js`): `export function connect({url, onOpen, onMessage, onClose, backoff = nextBackoff}) -> {send(text), close()}`; `export function nextBackoff(prevMs)` → `Math.min(prevMs * 2, 5000)` starting from 1000, reset to 1000 on open.
- Produces (`peer.js`): `export function startPeer({send, onTrack, onFailed}) -> {handle(msg), close()}`: creates `RTCPeerConnection({iceServers: []})`, `addTransceiver('video', {direction: 'recvonly'})`, sends `{t:'offer', sdp}`, forwards `onicecandidate` as `{t:'ice', candidate}`, `handle` applies `answer`/`ice`, `onconnectionstatechange` `failed|disconnected` → `onFailed()`.
- Produces (`debug.js`): `export function createDebug(el) -> {set(key, value), touch(pts), watch(pc)}`; `watch` polls `pc.getStats()` every 1 s and sets `fps` (`framesPerSecond`) and `kbps` (bytesReceived delta × 8 / 1000) from the `inbound-rtp` video report.

- [ ] **Step 1: Write failing tests**

`web/test/touch.test.mjs`:
```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { videoBox, normalize, snapshot, createCoalescer } from '../public/touch.js';
test('videoBox letterboxes a wide video in a tall viewport', () => assert.deepEqual(videoBox(1000, 1000, 2), { x: 0, y: 250, w: 1000, h: 500 }));
test('videoBox pillarboxes a tall video in a wide viewport', () => assert.deepEqual(videoBox(1000, 500, 1), { x: 250, y: 0, w: 500, h: 500 }));
test('normalize maps inside the box', () => assert.deepEqual(normalize(500, 500, { x: 0, y: 250, w: 1000, h: 500 }), { x: 0.5, y: 0.5 }));
test('normalize returns null outside the box', () => assert.equal(normalize(10, 10, { x: 0, y: 250, w: 1000, h: 500 }), null));
test('snapshot drops touches outside the box', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(snapshot([{ identifier: 3, clientX: 50, clientY: 50 }, { identifier: 4, clientX: 150, clientY: 50 }], box), [{ id: 3, x: 0.5, y: 0.5 }]);
});
test('coalescer sends only the latest snapshot per frame', () => {
  const sent = []; let pending;
  const c = createCoalescer(p => sent.push(p), fn => { pending = fn; });
  c.push([{ id: 0, x: 0.1, y: 0.1 }]); c.push([{ id: 0, x: 0.2, y: 0.2 }]);
  assert.equal(sent.length, 0); pending(); assert.deepEqual(sent, [[{ id: 0, x: 0.2, y: 0.2 }]]);
});
```
`web/test/ws.test.mjs`:
```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { nextBackoff } from '../public/ws.js';
test('backoff doubles and caps at 5 s', () => { assert.equal(nextBackoff(1000), 2000); assert.equal(nextBackoff(4000), 5000); assert.equal(nextBackoff(5000), 5000); });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && node --test`
Expected: failures (modules missing).

- [ ] **Step 3: Implement `touch.js`, `ws.js`, `peer.js`, `debug.js`**

`touch.js` and `ws.js` (except `connect`) must import nothing and touch no globals so node can load them.

- [ ] **Step 4: Write `index.html`, `style.css`, `app.js`**

`index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`, `<title>tesla-mirror</title>`, `<video id="video" autoplay muted playsinline>`, `<div id="hint">Tap Start on phone</div>`, `<nav id="panel">` with buttons `data-key="back|home|recents"` and `id="debugToggle"`, `<pre id="debug" hidden>`, `<script type="module" src="app.js">`.
`style.css`: black full-viewport body, `touch-action: none; overscroll-behavior: none; user-select: none`, video `object-fit: contain` filling the viewport, panel fixed on the right edge, 48 px buttons, 60 % opacity, debug panel bottom-left monospace.
`app.js` wiring: `connect` → on `state`: show/hide hint; when `capturing` and no peer, `startPeer`; on `answer|ice` → `peer.handle`; `onFailed` → close WS (reconnect restarts everything); `ontrack` → `video.srcObject`; compute `box` from `videoBox(innerWidth, innerHeight, aspect)` where aspect comes from `video.videoWidth/videoHeight` once playing, else `state.capture`; on `resize` recompute; `touchstart/touchmove/touchend/touchcancel` on `document` with `preventDefault` → `snapshot(e.touches, box)` → coalescer (`requestAnimationFrame` as `schedule`) → `send(JSON.stringify({t:'touch', pts}))`; `touchend` with no touches sends `pts: []` immediately; while any finger is down, a 100 ms interval re-sends the latest snapshot so the phone's 500 ms watchdog does not release a finger that is simply holding still (long press, paused drag); panel buttons send `{t:'key', k}`; debug toggle flips `hidden`.

- [ ] **Step 5: Run tests**

Run: `cd web && node --test`
Expected: 7 tests pass. The page itself is exercised end-to-end in Task 8.

- [ ] **Step 6: Update docs**

`docs/architecture.md` browser table: confirm file list matches; add `style.css`. `docs/protocol.md`: under `touch`, add "while fingers are down the page repeats the latest snapshot at least every 100 ms; the phone releases all fingers after 500 ms without a snapshot".

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add browser page: WebRTC playback, touch capture, debug overlay" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: ScreenSource and PeerManager (WebRTC)

**Files:**
- Create: `app/src/main/java/com/fortres/teslamirror/video/Rtc.kt`, `app/src/main/java/com/fortres/teslamirror/video/ScreenSource.kt`, `app/src/main/java/com/fortres/teslamirror/video/PeerManager.kt`
- Test: `app/src/test/java/com/fortres/teslamirror/video/ScreenSourceTest.kt`

**Interfaces:**
- Consumes: `Protocol.answer`, `Protocol.ice`.
- Produces:
```kotlin
object Rtc {
    fun init(context: Context)                       // idempotent: PeerConnectionFactory.initialize + EglBase + factory with DefaultVideoEncoderFactory(egl, false, true)
    val egl: EglBase
    val factory: PeerConnectionFactory
}
fun captureSize(displayW: Int, displayH: Int, scale: Int = 2): Pair<Int, Int>   // divide, round down to even
class ScreenSource(context: Context, projection: Intent, private val onStopped: () -> Unit) {
    val width: Int; val height: Int; val track: VideoTrack
    fun start()                                      // ScreenCapturerAndroid.startCapture(width, height, FPS)
    fun onDisplayChanged()                           // re-read display size; changeCaptureFormat if it changed
    fun stop()
}
class PeerManager(private val track: VideoTrack, private val signal: (String) -> Unit) {
    fun onOffer(sdp: String)                         // setRemote → prefer H264 → addTrack → createAnswer → setLocal → signal(Protocol.answer)
    fun onRemoteIce(candidate: JsonObject)
    fun close()
}
```
Constants in `ScreenSource`: `FPS = 30`; in `PeerManager`: `MAX_BITRATE_BPS = 4_000_000`.

- [ ] **Step 1: Write failing test**

```kotlin
class ScreenSourceTest {
    @Test fun halvesAndRoundsToEven() {
        assertEquals(1440 to 720, captureSize(2880, 1440))
        assertEquals(540 to 1200, captureSize(1080, 2400))
        assertEquals(538 to 1198, captureSize(1077, 2397))
    }
}
```
Run: `./gradlew :app:testDebugUnitTest --tests '*ScreenSourceTest*' --console=plain` → compilation failure.

- [ ] **Step 2: Implement `Rtc.kt` and `captureSize`, run the test**

Expected: pass.

- [ ] **Step 3: Implement `ScreenSource.kt`**

`ScreenCapturerAndroid(projection, MediaProjection.Callback { onStopped() })`; `SurfaceTextureHelper.create("capture", Rtc.egl.eglBaseContext)`; `source = Rtc.factory.createVideoSource(true)`; `capturer.initialize(helper, context, source.capturerObserver)`; `track = Rtc.factory.createVideoTrack("screen", source)`. Size from `WindowManager.maximumWindowMetrics.bounds` through `captureSize`. Register a `DisplayManager.DisplayListener` that calls `onDisplayChanged()`.

- [ ] **Step 4: Implement `PeerManager.kt`**

`RTCConfiguration(emptyList())` with `sdpSemantics = UNIFIED_PLAN`. Observer: `onIceCandidate` → `signal(Protocol.ice(json))` where json has `candidate`, `sdpMid`, `sdpMLineIndex`; log `onConnectionChange`. In `onOffer`: `setRemoteDescription(OFFER)`, then `addTrack(track)`, then on the video transceiver `setCodecPreferences` with H264 capabilities first (from `Rtc.factory.getRtpSenderCapabilities(MEDIA_TYPE_VIDEO)`; if none, leave defaults), set `sender.parameters.encodings[0].maxBitrateBps = MAX_BITRATE_BPS`, `createAnswer`, `setLocalDescription`, `signal(Protocol.answer(sdp))`. `onRemoteIce`: `IceCandidate(sdpMid, sdpMLineIndex, candidate)` → `addIceCandidate`.

- [ ] **Step 5: Build**

Run: `./gradlew assembleDebug --console=plain`
Expected: `BUILD SUCCESSFUL`. Runtime behavior is verified in Task 8.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add screen capture video source and WebRTC peer" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: MirrorService, MainActivity, BootReceiver

**Files:**
- Create: `app/src/main/java/com/fortres/teslamirror/MirrorService.kt`, `app/src/main/java/com/fortres/teslamirror/MirrorState.kt`, `app/src/main/java/com/fortres/teslamirror/BootReceiver.kt`, `app/src/main/java/com/fortres/teslamirror/NetUtil.kt`, `app/src/main/res/layout/activity_main.xml`, `docs/decisions/2026-10-18-boot-starts-service.md`
- Modify: `app/src/main/java/com/fortres/teslamirror/MainActivity.kt`, `app/src/main/AndroidManifest.xml`, `docs/architecture.md`, `docs/device-setup.md`
- Test: `app/src/test/java/com/fortres/teslamirror/NetUtilTest.kt`

**Interfaces:**
- Consumes: `WebServer`, `PeerManager`, `ScreenSource`, `InputBridge`, `Protocol.state`.
- Produces:
```kotlin
data class State(val serverRunning: Boolean, val capturing: Boolean, val accessibility: Boolean, val url: String?, val captureW: Int, val captureH: Int)
object MirrorState { val flow: MutableStateFlow<State> }
object NetUtil { fun pickHotspotAddress(interfaces: List<Pair<String, List<String>>>): String? }  // (ifaceName, ipv4s) -> prefer names starting with "ap"/"swlan"/"wlan" with 192.168.*, else first 192.168.*, else first non-loopback
class MirrorService : Service()   // ACTION_SERVE, ACTION_START (extras RESULT_CODE, DATA), ACTION_STOP
```

- [ ] **Step 1: Write failing test for `NetUtil`**

```kotlin
class NetUtilTest {
    @Test fun prefersHotspotInterface() = assertEquals("192.168.43.1", NetUtil.pickHotspotAddress(listOf("wlan0" to listOf("10.0.0.5"), "swlan0" to listOf("192.168.43.1"))))
    @Test fun fallsBackToAnyPrivateThenAny() {
        assertEquals("192.168.1.7", NetUtil.pickHotspotAddress(listOf("eth0" to listOf("192.168.1.7"))))
        assertEquals("10.0.2.15", NetUtil.pickHotspotAddress(listOf("lo" to listOf("127.0.0.1"), "eth0" to listOf("10.0.2.15"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("lo" to listOf("127.0.0.1"))))
    }
}
```
Run: `./gradlew :app:testDebugUnitTest --tests '*NetUtilTest*' --console=plain` → compilation failure. Implement, run again → pass.

- [ ] **Step 2: Implement `MirrorState.kt` and `MirrorService.kt`**

- `onCreate`: notification channel `mirror`; `startForeground` (API ≥ 34: `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`, otherwise untyped) with a notification whose tap opens `MainActivity`; `Rtc.init`; `WebServer(devDir = File(getExternalFilesDir(null), "web"), listener = this).start()` (the server serves that folder instead of APK assets only when it exists; this is the dev mode from `docs/development.md`); publish state (`url = "http://${NetUtil.pickHotspotAddress(...)}:8080"`).
- `ACTION_START`: `MediaProjectionManager.getMediaProjection` is done inside `ScreenCapturerAndroid`, so only: `startForeground` again with `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`, create `ScreenSource(this, data, onStopped = ::stopCapture)`, `start()`, publish `capturing = true`, send state to the client.
- `ACTION_STOP`: `stopCapture()` (close peer, stop source), keep serving.
- `WebServer.Listener`: `onClientConnected` → send `Protocol.state(...)`; `onMessage`: `Offer` → create `PeerManager(source.track, server::send)` (close any previous) and `onOffer`; `Ice` → `peer?.onRemoteIce`; `Touch` → `InputBridge.service?.onTouch(pts)`; `Key` → `InputBridge.service?.onKey`; `onClientDisconnected` → close peer.
- Poll `InputBridge.enabled` every 2 s and push state when it changes (service binding has no callback into the app).
- `onDestroy`: stop capture, `server.stop()`.

- [ ] **Step 3: Implement `MainActivity.kt`, `activity_main.xml`, `BootReceiver.kt`, manifest entries**

Layout: four status lines (server URL, capture, accessibility, hint), buttons Start, Stop, Open accessibility settings. Activity collects `MirrorState.flow` with `repeatOnLifecycle(STARTED)`. Start → `registerForActivityResult(StartActivityForResult())` with `MediaProjectionManager.createScreenCaptureIntent()` → `startForegroundService(ACTION_START)` with result code and data. On create also `startForegroundService(ACTION_SERVE)` and request `POST_NOTIFICATIONS` on API ≥ 33.
`BootReceiver`: on `BOOT_COMPLETED` → `startForegroundService(ACTION_SERVE)`.
Manifest: service `android:foregroundServiceType="mediaProjection|specialUse"` with `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="serving mirror page before capture"/>`; receiver with `BOOT_COMPLETED` filter, `exported="true"`.

- [ ] **Step 4: Build, install, smoke-test on the emulator**

Run: `./gradlew installDebug && adb shell am start -n com.fortres.teslamirror/.MainActivity && adb forward tcp:8080 tcp:8080 && curl -s localhost:8080 | head -3`
Expected: the activity shows the URL and "server: running"; curl prints the page head.

- [ ] **Step 5: Record the boot decision and update docs**

`docs/decisions/2026-10-18-boot-starts-service.md`: Context (Android 10+ blocks activity launches from BOOT_COMPLETED), Decision (BootReceiver starts MirrorService; its notification opens MainActivity; one tap on Start still required), Consequences. Update `docs/architecture.md` (BootReceiver and MirrorService rows, startup section), `docs/device-setup.md` (what happens after reboot) and `docs/development.md` dev mode: `adb push web/public/. /sdcard/Android/data/com.fortres.teslamirror/files/web/` enables it, deleting that folder disables it; no in-app toggle.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add foreground service, main screen and boot start" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end on the emulator, tap tool, docs

**Files:**
- Create: `tools/tap.mjs`
- Modify: `docs/development.md`, `AGENTS.md` (status)

**Interfaces:**
- Produces: `node tools/tap.mjs <x> <y> [host:port]` — connects to `ws://host:port/ws` (default `localhost:8080`), sends `{"t":"touch","pts":[{"id":0,"x":X,"y":Y}]}`, then `{"t":"touch","pts":[]}` 60 ms later, then closes; exits non-zero if the socket cannot open.

- [ ] **Step 1: Write `tools/tap.mjs`** using the global `WebSocket` (Node 22).

- [ ] **Step 2: Full loop on the emulator**

1. `./gradlew installDebug`, open the app, enable accessibility, tap Start, accept capture.
2. `adb forward tcp:8080 tcp:8080`; open `http://localhost:8080` in Chrome.
Expected: video of the emulator screen within 2 s; debug overlay shows `ice: connected`, fps > 0.
3. `node tools/tap.mjs 0.5 0.5`.
Expected: a tap lands in the middle of the emulator screen (visible in the mirrored video; `adb logcat -s TeslaMirror` shows a dispatched gesture).
4. In Chrome DevTools device mode: tap, drag, long press, Shift-drag pinch on a map app or the launcher.
Expected: emulator reacts; overlay shows two ids during pinch.
5. Back/Home/Recents buttons act on the emulator.
6. `adb shell am force-stop com.fortres.teslamirror`, reopen the app, Start.
Expected: page reconnects by itself (hint shown while down), video returns without reload.

- [ ] **Step 3: Fix anything found**, re-run the loop; keep fixes inside the owning files.

- [ ] **Step 4: Update docs**

`docs/development.md`: confirm commands, add `node tools/tap.mjs` usage; `AGENTS.md` status → "v1 runs on the emulator; car verification pending (docs/car-checklist.md)".

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add synthetic tap tool and verify end-to-end loop on emulator" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
