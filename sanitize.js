/**
 * Sanitizers for untrusted values coming out of the database.
 * Kept in their own file so selfcheck.html can test them without booting Firebase.
 *
 * Loaded as a classic script before app.js, so these consts share the page's
 * global scope. Nothing here may redeclare a name that app.js defines.
 *
 * Exports (used by app.js and exercised by selfcheck.html):
 *   esc(text)            HTML-escape a value for interpolation into markup
 *   jsArg(text)          escape a value for a quoted JS argument inside an attribute
 *   safeMedia(url, kind) accept only our own base64 image/audio data URLs
 *   safeDecode(text)     percent-decode a stored key, malformed input tolerated
 *   highlightEsc(t, q)   escape text and wrap every case-insensitive match of q
 */

// ── esc ──────────────────────────────────────────────────────────────────────
// HTML-escape, including the apostrophe. Coerces non-strings (DB values are not typed).
// Fast path: most values have nothing to escape, so skip the regex pass entirely.
const HTML_SPECIALS = /[&<>"']/;
const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => {
  const str = String(s ?? '');
  return HTML_SPECIALS.test(str) ? str.replace(/[&<>"']/g, c => HTML_ENTITIES[c]) : str;
};

// ── jsArg ────────────────────────────────────────────────────────────────────
// For a value placed inside onclick="f('HERE')". JS-escape FIRST, then HTML-escape:
// the HTML parser decodes entities before JS parses the handler, so esc() alone
// would hand a real apostrophe to the JS parser and let an attacker break out.
// Inline handlers were removed in the Phase 3 CSP; kept because selfcheck tests it
// and future markup may still need a JS-string-safe escaping of an attribute.
const jsArg = s => esc(String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/[\r\n\u2028\u2029]/g, ' '));

// ── safeMedia ────────────────────────────────────────────────────────────────
// Media is rendered, so accept only our own base64 payloads of the requested
// top-level type. Blocks javascript:, data:text/html, remote URLs written into
// the DB by anyone, and values that would break out of the src="…" attribute.
const MAX_MEDIA_LEN = 7.3e6;              // matches the rules' fileUrl/voiceUrl cap
const MEDIA_PATTERNS = new Map();         // kind → compiled RegExp (built once)
const mediaPattern = kind => {
  let re = MEDIA_PATTERNS.get(kind);
  if (!re) {
    re = new RegExp('^data:' + kind + '/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$');
    MEDIA_PATTERNS.set(kind, re);
  }
  return re;
};
const safeMedia = (url, kind) => {
  // kind is code-supplied, but it is interpolated into a RegExp: strip anything
  // that is not a letter so a caller typo can never inject a pattern.
  const k = String(kind ?? '').replace(/[^a-z]/g, '');
  if (!k) return '';
  return typeof url === 'string' && url.length <= MAX_MEDIA_LEN && mediaPattern(k).test(url) ? url : '';
};

// ── safeDecode ───────────────────────────────────────────────────────────────
// Decode a percent-encoded value we stored as an object key (reactions). A
// malformed sequence must come back unchanged instead of throwing inside a
// render loop.
const safeDecode = s => {
  const str = String(s ?? '');
  try { return decodeURIComponent(str); } catch { return str; }
};

// ── highlightEsc ─────────────────────────────────────────────────────────────
// Highlight every occurrence of q inside text for search results.
// Decrypted plaintext is attacker-controlled (any member can send it), so EVERY
// segment — match and remainder alike — is HTML-escaped before it can reach
// innerHTML. Never build this with a bare String.replace + <mark>.
const highlightEsc = (text, q) => {
  text = String(text ?? ''); q = String(q ?? '');
  if (!q) return esc(text);
  const lt = text.toLowerCase(), lq = q.toLowerCase();
  // Case folding changes length for a few characters (İ, ...). Offsets would
  // desync and mis-slice the text, so fall back to plain escaping.
  if (lt.length !== text.length || lq.length !== q.length) return esc(text);
  let out = '', i = 0;
  for (;;) {
    const idx = lt.indexOf(lq, i);
    if (idx === -1) { out += esc(text.slice(i)); return out; }
    out += esc(text.slice(i, idx)) + '<mark>' + esc(text.slice(idx, idx + lq.length)) + '</mark>';
    i = idx + lq.length;
  }
};
