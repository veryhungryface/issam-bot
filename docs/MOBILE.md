# Shipping the phone app

Push notifications do not work in the browser here: `apps/web` has a manifest and icons
but no service worker, so its notifications only appear while a tab is open. The phone app
is the path to real background push, and it already exists — `apps/mobile` is an Expo
client of the same API, it registers an Expo push token through `notifications/registerPush`,
and the server already sends to it through `ExpoPushProvider`. What was missing is a build
under *our* account.

## What the repository already carries

- App identity renamed to 이삼봇 (`com.issambot.app` on both platforms, version 1.0.0,
  Korean permission prompts). Upstream's Expo account, project id and OTA endpoint were
  removed; `eas init` writes ours.
- The URL scheme stays `rakazo://`. It never appears in front of the user, and the API
  trusts exactly that scheme for auth callbacks and CORS (`isTrustedOrigin`); renaming it
  would mean changing the server's allowlist for no visible gain.
- `app.config.ts` refuses a production build unless `EXPO_PUBLIC_API_URL` is set and HTTPS.
  That is deliberate: the app also refuses a public `http://` server at runtime.

## What only you can do

1. **A domain for the API.** Point an A record at the VPS, then run the *Set public origin*
   workflow with `origin=https://<domain>` (its host input defaults to the current VPS).
   It sets `WEB_ORIGIN`, `BETTER_AUTH_URL`, `API_URL` and `RAKAZO_HOST`, and the Caddy
   container already on the box takes a Let's Encrypt certificate for that name. Until then
   the Vercel → VPS hop is plaintext HTTP.
2. **An Expo account** (free). `cd apps/mobile && npx eas login && npx eas init` writes the
   project id into `app.json`. For CI publishing, put an `EXPO_TOKEN` in the repository
   secrets.
3. **A Firebase project** for Android push (free). Upload its `google-services.json` to EAS
   (`npx eas credentials`, Android → FCM V1). Without it an Android build installs and runs
   but receives no push.
4. **An Apple Developer Program membership** ($99/year) for iOS. A free Apple ID cannot get
   the push entitlement, so iOS push needs it; EAS then generates the APNs key and the
   provisioning profile for you.

## Build and install

```bash
cd apps/mobile

# Android, no store needed: an installable build you download from the EAS link.
EXPO_PUBLIC_API_URL=https://<domain> npx eas build --platform android --profile preview

# iOS, once the Apple account exists (TestFlight):
EXPO_PUBLIC_API_URL=https://<domain> npx eas build --platform ios --profile production
npx eas submit --platform ios --latest
```

After installing, sign in with the same account the web app uses, and allow notifications
when asked — that is when `registerPushToken()` stores the token against your user. The
server then pushes for the things it already notifies about: a run finishing when
`notifyOnFinish` is on, a sign-in sheet or takeover waiting on you, the four-hour
stuck-work reminder, and a check-in that decides it has something to say.

## Known gaps

- The app's UI is English (and Chinese); there is no Korean catalog yet — 470 strings, of
  which 249 already have approved Korean wording in the web catalog. It ships as an OTA
  update whenever we do it, with no rebuild.
- The icon is still upstream's Rakazo mark, shared with the web app's icons.
