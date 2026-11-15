/**
 * Sanitizers for untrusted values coming out of the database.
 * Kept in their own file so selfcheck.html can test them without booting Firebase.
 */

// HTML-escape, including the apostrophe. Coerces non-strings (DB values are not typed).
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// For a value placed inside onclick="f('HERE')". JS-escape FIRST, then HTML-escape:
// the HTML parser decodes entities before JS parses the handler, so esc() alone
// would hand a real apostrophe to the JS parser and let an attacker break out.
const jsArg = s => esc(String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' '));

// Only our own base64 data: media is rendered. Blocks javascript:, data:text/html,
// and remote URLs written straight into the DB by anyone.
const safeMedia = (url, kind) =>
  typeof url === 'string' && url.length <= 7.3e6 &&
  new RegExp('^data:' + kind + '/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$').test(url)
    ? url : '';

// Highlight every occurrence of q inside text for search results.
// Decrypted plaintext is attacker-controlled (any member can send it), so EVERY
// segment — match and remainder alike — is HTML-escaped before it can reach
// innerHTML. Never build this with a bare String.replace + <mark>.
const highlightEsc = (text, q) => {
  text = String(text ?? ''); q = String(q ?? '');
  if (!q) return esc(text);
  const lt = text.toLowerCase(), lq = q.toLowerCase();
  let out = '', i = 0;
  for (;;) {
    const idx = lt.indexOf(lq, i);
    if (idx === -1) { out += esc(text.slice(i)); break; }
    out += esc(text.slice(i, idx)) + '<mark>' + esc(text.slice(idx, idx + lq.length)) + '</mark>';
    i = idx + lq.length;
  }
  return out;
};
