# Shipping the phone app

Push notifications do not work in the browser here: `apps/web` has a manifest and icons
but no service worker, so its notifications only appear while a tab is open. The phone app
is the path to real background push, and it already exists — `apps/mobile` is an Expo
client of the same API, it registers an Expo push token through `notifications/registerPush`,
and the server already sends to it through `ExpoPushProvider`. What was missing is a build
under *our* account.

## What the repository already carries

- App identity renamed to 아이쌤봇 (`com.issambot.app` on both platforms, version 1.0.0,
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

## Language

The app is Korean on a Korean phone with nothing to choose: `resolveUiLocale` reads the
device language, and `ko` is a supported locale now. The catalog reuses the web catalog's
wording wherever the same English source appears there, so both surfaces say the same
thing, and two tests keep it honest — every `t()` id in the app must have a Korean value,
and every value must carry the same `{placeholders}` as its source.

## Icons

Every icon is built from the supplied mascot artwork by `scripts/build-icons.mjs`. The file
we were given is an icon *mockup* — a rounded white card with a drop shadow, on white — so
the script crops the character out of it, washes the card's neutral grey edge to white
(the felt's own light tones are warm, so only the card goes), and composes each platform's
asset at the size and padding that platform expects: full-bleed for iOS, inside the safe
zone for Android's adaptive icon, a rounded card with transparent corners for the dark
splash, and the web's favicons down to 16px.

The Android status-bar icon is a drawn four-point star rather than a traced outline: it is
rendered a few millimetres wide in one flat colour, and at that size the mascot's mitts,
eyes and mouth turn to mush. The shape it is built from stays legible.

To rebuild after new artwork, from the repository root:

```bash
node scripts/build-icons.mjs apps/mobile/assets/source/mascot.png /tmp/icons
cp /tmp/icons/{icon,adaptive-icon,splash-icon,notification-icon,monochrome-icon}.png apps/mobile/assets/
cp /tmp/icons/{icon-192,icon-512,apple-touch-icon,favicon-32x32,favicon-16x16}.png apps/web/public/
```

`favicon.ico` and `favicon.svg` wrap the same raster (an ICO holding 16/32/64 PNGs, and an
SVG embedding the 64px one) so every favicon path shows the same mascot.
