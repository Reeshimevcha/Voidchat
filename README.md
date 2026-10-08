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

Messages are encrypted client-side with AES-256-GCM before being written to Firebase.
**The key is derived from the room code**, and the room code is also the database path — so
anyone who can read a room's data can also derive its key. Treat the encryption as
obfuscation against a casual reader, not as confidentiality against a determined one, and
treat the per-user privacy toggles as a UI convenience rather than access control.

See [`../UPGRADE-PLAN.md`](../UPGRADE-PLAN.md) for the full security review, what has been
fixed, and what is still open — including the room-passphrase change that would make the
encryption meaningful.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup, CSP, script loading |
| `style.css` | All styling |
| `firebase-config.js` | Firebase project config (public by design) |
| `sanitize.js` | HTML / JS-argument / media-URL escaping for untrusted DB values |
| `cipher.js` | AES-GCM + emoji encoding |
| `app.js` | Everything else |
| `database.rules.json` | Server-side authorisation — deploy this |
| `selfcheck.html` | Assertions for `sanitize.js` and `cipher.js` |
