# Voidchat

Ephemeral encrypted chat rooms. Static HTML/CSS/JS — no build step, no dependencies.
Firebase Realtime Database is the only backend.

## Setup (required — the app will not start without these)

1. **Firebase Console → Authentication → Sign-in method → enable Anonymous.**
   `app.js` signs in anonymously on load; the uid it returns is what the database rules
   authorise every read and write against.
2. **Firebase Console → Realtime Database → Rules →** paste [`database.rules.json`](database.rules.json)
   and publish. Without these rules the database is world-readable and world-writable.

Then open `index.html`. Open [`selfcheck.html`](selfcheck.html) to verify the sanitizers and
the cipher; it should report `ALL PASS`.

## What this is and is not

Messages are encrypted client-side with AES-256-GCM before being written to Firebase, in
two modes:

- **New text messages**: every message gets a fresh random AES-256-GCM key, wrapped
  separately to each allowed member's ECDH P-256 public key. A database dump — or any
  member not in the wrapped list — cannot decrypt it.
- **Legacy messages** (sent before per-message keys): encrypted with a key derived from
  the room code, which is also the database path — so anyone who can read a room's data
  can derive its key. Old history stays in this mode; it cannot be sealed retroactively.

### Per-message keys (envelope encryption)

- Every text message is encrypted with its own random AES-256-GCM key. The key is wrapped
  separately to each recipient's public key and stored with the message as
  `wrapped: { <uid>: <capsule> }` — sender included, so they can re-read their own
  history. A database dump therefore holds **no key that decrypts message history**.
- Each client publishes only its public key (`keys/{room}/{uid}/pub`); the private key
  never leaves the device (localStorage). Older builds kept it in
  `vault/{room}/{uid}/priv` — on first run the app migrates it locally and deletes the
  server copy.
- Decryption needs the recipient's private key **and** the sender's public key, so a
  swapped public key fails closed to 🔒 instead of exposing content.
- Audience: with no privacy list set, the key is wrapped to every current member; with a
  privacy list, only to the listed members. Members who join later, or had no published
  key at send time, see 🔒 on that message — there is no retroactive access.
- Honest limits: only text content is sealed. Image/voice attachments and poll,
  checklist, location and contact fields remain readable by any room member, as before.
  Clearing site data loses the private key: older messages can no longer be re-read on
  that device (a new identity is minted and peers see a key change). Messages sent before
  per-message keys stay room-key encrypted and cannot be sealed retroactively.

### Trust & verification (safety numbers)

- The sidebar **IDENTITY KEYS** list shows every member's key status — ✓ VERIFIED,
  ○ UNVERIFIED or ⚠ CHANGED — plus your own fingerprint.
- Click 🔑 next to a member to see your **60-digit safety number** (12 groups of 5,
  derived from both public keys, so both sides compute the same value). Compare it
  through another channel (in person, a call): matching digits mean nobody swapped
  keys in the database.
- First sight of a peer key is trust-on-first-use. If a published key ever changes a
  loud alarm banner appears, the peer is marked unverified, and you must compare the
  new number and press **ACCEPT NEW KEY** before trusting it again.
- Limits: trust is stored on this device (localStorage) per room, and there is no key
  transparency log — a database operator that consistently swaps every key is detectable
  only by out-of-band comparison of the safety numbers.

### Encrypted backup (export / restore)

- **BACKUP** in the sidebar (same permission as DOWNLOAD) exports the room's readable
  history as one `.vcbackup` file encrypted with your passphrase — PBKDF2-SHA256 with
  600,000 iterations, then AES-256-GCM. The passphrase is never stored or sent anywhere.
- **OPEN BACKUP** restores a file: it decrypts with the passphrase and opens the history
  in a new tab. A wrong passphrase or corrupted file fails closed with an error.
- There is no recovery: losing the passphrase means the backup is unreadable, by design.

## Screen protection (honest limits)

Browsers have **no API to block OS-level screenshots** (Print Screen, Win+Shift+S,
macOS Cmd+Shift+3/4, phone hardware buttons) — capture happens below the browser
sandbox, and no major web app (WhatsApp Web, Telegram Web, Snapchat for Web) claims
to block it either. Voidchat therefore layers deterrence and attribution instead:

1. **Privacy curtain** — losing window/tab focus instantly re-hides every revealed
   message and covers the whole UI until focus returns. Catches snipping tools,
   alt-tab, screenshot UIs and screen shares.
2. **Capture warning** — a toast tells the user why the screen went dark.
3. **Forensic watermark** — a tiled, drifting overlay of `codename · uid` across every
   frame, so any captured image is attributable to a specific viewer. The room code is
   deliberately excluded: a screenshot must never leak the code needed to join.
   This is the industry-standard answer (Google Meet, Microsoft Purview).
4. **Copy locks** — right-click, text selection and image drag-out of chat content
   are blocked. Casual deterrence only; DevTools bypasses this in seconds.

PrintScreen (Windows/Linux) and Cmd+Shift+3/4/5 (macOS) are watched for: the page
hides every revealed message and covers the UI the moment the shortcut is seen.
That is still only a race — the OS can grab the frame before the page repaints,
and **Android/iOS fire no event at all** for a hardware screenshot. Real blocking
requires a native shell (Android `FLAG_SECURE`, macOS `NSWindow.sharingType`).

Deliberately *not* implemented: DevTools detection —
both are trivially bypassable and create false confidence. Real capture blocking
needs a native wrapper (e.g. Electron `setContentProtection(true)` on Windows).

## Other security notes

- **Room codes are 10 characters** (≈50 bits) so they cannot be brute-forced by
  probing room existence.
- **`database.rules.json` is not optional.** Without it the database is world-readable
  and world-writable. The rules gate every read/write on room membership, restrict
  `closed`/`pinned`/kick to the owner, cap message sizes, and prevent message
  forgery (a message's sender, content and timestamp are immutable after creation).
- Search results HTML-escape decrypted plaintext (`highlightEsc` in `sanitize.js`)
  so a malicious message cannot execute script when someone searches for it.
- Firebase SDK scripts carry Subresource Integrity hashes, and a `no-referrer` meta
  tag stops referrer leakage.
- Fonts are self-hosted (`fonts.css` + `fonts/*.woff2`, downloaded from Google Fonts):
  the page makes zero third-party requests, so the CSP needs no font/style origins
  beyond `'self'`.
- **No inline script, no inline event handlers.** `script-src` in the CSP does not allow
  `'unsafe-inline'`, and every control is wired through the `data-action` registry in
  `app.js` (a fixed object, never a `window[name]` lookup). `style-src` keeps
  `'unsafe-inline'` because message bubbles build dynamic `style` attributes; a nonce is
  not possible for values computed at runtime.
- Still open: **App Check** (Firebase-console setup — register the web app with a
  reCAPTCHA provider, then enforce it for Realtime Database). Server-side rate limiting
  is impossible with Realtime Database rules (they validate one write at a time and
  cannot verify that a sibling node was updated atomically), so the client throttles
  every send path — text, polls, checklists, images, voice notes, location and contact
  shares — to a 500 ms minimum gap and 10 sends per 10 seconds. Scheduled deliveries
  are exempt because they were already counted when scheduled. App Check remains the
  real abuse control.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup, CSP, script loading |
| `style.css` | All styling |
| `firebase-config.js` | Firebase project config (public by design) |
| `sanitize.js` | HTML / JS-argument / media-URL escaping for untrusted DB values |
| `cipher.js` | AES-GCM + emoji encoding; Envelope (per-message ECDH-wrapped keys) |
| `app.js` | Everything else |
| `database.rules.json` | Server-side authorisation — deploy this |
| `selfcheck.html` | Assertions for `sanitize.js` and `cipher.js` |
