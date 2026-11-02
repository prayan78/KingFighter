# KingFighter

KingFighter is a browser-based 3D arena fighter built with React, TypeScript, Vite, and React Three Fiber. Play offline against AI or create an account for online 1v1, player profiles, hero ownership, experience, achievements, match history, and mobile control layout. Guest training stays available without MongoDB or sign-in.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- MongoDB Community Server or a MongoDB Atlas connection for account features
- A modern browser with WebGL support

## Install

```bash
npm install
```

## Build and run on Android

The Capacitor Android project is in `android/` (`com.kingfighter.arena`). Capacitor 8 requires Android Studio 2025.2.1 or newer and an Android SDK; use Android Studio's bundled JDK.

1. If online multiplayer should work in the APK, set `VITE_API_URL` to the deployed HTTPS API origin before building. For example, in PowerShell:

   ```powershell
   $env:VITE_API_URL = "https://api.example.com"
   ```

   The API must be reachable from the phone. Configure its `CLIENT_ORIGIN` to include `https://localhost` for the Capacitor WebView (and your browser client origin, if used). Without a deployed API URL, offline guest training still works, but account and online features won't connect from the APK.

2. Build the web app and sync it into Android:

   ```powershell
   npm.cmd run android:sync
   ```

   This builds the web app and syncs the latest files into Android. Run it again after changing the web app before rebuilding the APK.

3. Open the native project:

   ```powershell
   npm.cmd run android:open
   ```

4. In Android Studio, wait for Gradle sync. Select an Android emulator or connect a phone with USB debugging enabled, then press **Run** to install and launch the app.

### Create an APK

For a local debug APK, use Android Studio's **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The output is:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Or build from PowerShell:

```powershell
cd android
.\gradlew.bat assembleDebug
cd ..
```

For distribution, choose **Build > Generate Signed Bundle / APK > APK** in Android Studio and create/select a release signing key. Keep the keystore and passwords backed up securely; never commit them to the repo. Android Studio writes the signed APK under `android/app/build/outputs/apk/release/`. If publishing through Google Play, generate a signed Android App Bundle (AAB) instead.

Capacitor's Android tooling requires Android Studio and an Android SDK; Capacitor 8's current minimum Android Studio version is 2025.2.1. [Capacitor Android setup](https://capacitorjs.com/docs/getting-started/environment-setup), [Capacitor Android workflow](https://capacitorjs.com/docs/android), and [Android APK build/signing docs](https://developer.android.com/studio/run).

## Run the frontend as an offline guest

```bash
npm run frontend
```

Open the local URL printed by Vite (usually `http://localhost:5173`). Guest matches, hero selection, combat, and local control customization work without the API or MongoDB.

## Run frontend and backend

1. Start MongoDB locally, or create a MongoDB Atlas database.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a private random `JWT_SECRET` of at least 32 characters. Do not commit `.env` or share the secret.
3. In one terminal start the backend API and Socket.IO server:

   ```bash
   npm run backend
   ```

4. In a second terminal, from the project directory, start the frontend:

   ```bash
   npm run frontend
   ```

The Vite development server proxies `/api` and `/socket.io` to `http://localhost:3001`. The backend requires MongoDB and a valid JWT secret. The frontend works by itself for offline guest matches; sign-in and online multiplayer require both processes.

Accounts can register with a username, display name, email, and password (10+ characters including upper/lowercase and a number). Passwords are hashed with bcrypt; the API returns a signed 7-day JWT and never returns the password hash. Use HTTPS in production, keep secrets in the hosting provider's secret store, and set `CLIENT_ORIGIN` to the exact trusted web origin(s).

## Player data and API

Authenticated players receive a profile with owned heroes, selected hero, XP-derived level, achievements, recent match history, and saved control layout. Both launch heroes are initially owned. Server-simulated online best-of-three results earn XP and can award achievements. Match history is capped at 100 records per player; profiles return the latest 50.

Main routes:

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/profile`, `PUT /api/profile`
- `PUT /api/profile/control-layout`
- `GET /api/health`

Request bodies are strictly validated with Zod, request sizes are capped, auth endpoints are rate limited, and Helmet/CORS are enabled. Profile and layout routes require a valid bearer token. Client-submitted match results are rejected; only the online server simulation writes ranked match history or rewards.

## Online 1v1

Sign in, select a hero, and open the radio icon to find an opponent or create/join a private 6-character room. Both players must ready up before the server starts. Movement, attacks, ability resources/cooldowns, collision, damage, health, rounds, match results, XP, and achievements are computed by the server. Socket clients send only bounded movement and action inputs; extra fields such as damage and results are rejected. The server advances fixed 60 Hz simulation steps and broadcasts state snapshots at about 20 Hz. Clients interpolate position, facing, health, and elevation between snapshots.

Socket.IO reconnects automatically. If a player disconnects, the authoritative match pauses for up to 20 seconds while the same account reconnects into its existing room slot. Lobby join attempts and gameplay inputs are rate limited and validated. For production, serve the site and API over HTTPS/WSS.

The integration tests use two independent authenticated Socket.IO clients and add 65 ms simulated input latency. They cover matchmaking/readiness, server movement and damage, input spoof rejection, ability cooldown/mana checks, private room joins, and reconnect recovery.

For a manual browser check, open the Vite URL in two separate browser profiles, sign in with two different accounts, then use **Play Online 1v1** on both. One client can create a private room and share its code; both clients must ready up. Disconnect one tab briefly and restore it within the reconnect window to verify the same match resumes.

## Controls

| Input | Action |
| --- | --- |
| `W` / `A` / `S` / `D` or arrow keys | Move |
| `Space` | Strike; chain up to three hits during the combo window |
| `Shift` (hold) | Block and reduce incoming damage |
| `Q` | Dodge with a brief invulnerability window |
| `E` | Jump |
| `R` | Dash |
| `1`–`4` | Cast the selected hero's three skills or ultimate |
| Ability button tap | Cast toward the opponent |
| Hold an ability button, drag, release | Aim at an arena point and cast |
| Touch joystick | Analog movement; can be held with other combat actions |
| HUD sliders button | Open the touch control layout editor |
| Pause / Rematch | Pause or restart the match |
| `?` | Show the controls guide |

The HUD includes health, mana, timer, score, and cooldowns. Touch layouts save locally for guests and sync to an account when signed in. Layouts adapt to screen aspect ratios, and editing controls does not trigger combat actions.

## Production build and tests

```bash
npm run build
npm run preview
npm test
npm exec tsc -- -p server/tsconfig.json
```

`build` type-checks the client and generates production files in `dist/`; `preview` serves that build locally. `test` runs combat, ability, and two-client multiplayer integration tests.

## Project structure

```text
src/
  App.tsx                 Match UI, input, offline flow, account connection
  game/
    simulation.ts         Framework-independent match simulation
    combat.ts             Hero stats, combat state, hitboxes, and damage
    abilities.ts          Loadouts, abilities, cooldowns, and resource rules
    ai.ts                  Difficulty-based opponent decisions
    AccountPanel.tsx      Account sign-in, registration, and profile UI
    account.ts            Typed client API and local session handling
    network.ts            Socket.IO connection and snapshot interpolation
    OnlineLobby.tsx       Public matchmaking and private room readiness UI
    TouchHUD.tsx          Mobile controls and layout editor
    Arena.tsx             Arena geometry and scenery
    Character.tsx         Fighter models and animations
    CameraRig.tsx         Smooth arena camera
server/
  index.ts                Express API routes and database startup
  multiplayer.ts          JWT-authenticated rooms and authoritative fixed-step matches
  security.ts             JWT middleware and Zod request schemas
  models/Player.ts        MongoDB player/profile schema
.env.example              Local API configuration template
```
