/**
 * VoidChat Cipher v6 — room-key AES-GCM + per-message envelope keys.
 *
 * EmojiCipher: legacy room-key encryption. The key is PBKDF2(room code), so
 * every room member who reads the raw database can decrypt — used for messages
 * addressed to everyone.
 *
 * Envelope:   per-message random key, wrapped separately to each recipient's
 * ECDH P-256 public key. Only listed recipients can unwrap; the database never
 * holds anything that decrypts restricted content for an unlisted member.
 */
const _EMOJI_BASE = (() => {
  const r=[[0x1F600,0x1F637],[0x1F641,0x1F644],[0x1F400,0x1F43E],
           [0x1F330,0x1F343],[0x1F311,0x1F31E],[0x1F300,0x1F30F],
           [0x1F347,0x1F37F],[0x1F380,0x1F393],[0x1F3A0,0x1F3A5]];
  const t=[];
  for(const[s,e]of r)for(let c=s;c<=e;c++)t.push(String.fromCodePoint(c));
  return t;
})();
const _rng=seed=>()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
const _hash=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h;};
const _table=(id,rc)=>{const r=_rng(_hash((id||'x')+rc));const t=[..._EMOJI_BASE];for(let i=t.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[t[i],t[j]]=[t[j],t[i]];}return t;};
const _segs=s=>(typeof Intl!=='undefined'&&Intl.Segmenter)?[...new Intl.Segmenter().segment(s)].map(x=>x.segment):[...s];
const _concat=(a,b)=>{const out=new Uint8Array(a.length+b.length);out.set(a);out.set(b,a.length);return out;};
const _emojiFromBytes=(bytes,id,rc)=>{const t=_table(id,rc);return Array.from(bytes).map(b=>t[b&0xFF]).join('');};
const _bytesFromEmoji=(emoji,id,rc)=>{const t=_table(id,rc),rev=new Map(t.map((e,i)=>[e,i]));return new Uint8Array(_segs(emoji).map(g=>rev.get(g)).filter(v=>v!==undefined));};

const EmojiCipher = (() => {
  const kc=new Map();
  const dk=async rc=>{
    const k=rc.toUpperCase().trim();
    if(kc.has(k))return kc.get(k);
    const raw=new TextEncoder().encode(k);
    const km=await crypto.subtle.importKey('raw',raw,'PBKDF2',false,['deriveKey']);
    // Salt is per-room: a single precomputed table must not cover every room code.
    const salt=new TextEncoder().encode('VoidChatV6:'+k);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    kc.set(k,key);return key;
  };
  const encrypt=async(plain,rc,id='x')=>{
    if(!plain)return'';
    if(!rc)throw new Error('encrypt: missing room key');
    // No catch: failing open here would publish plaintext while the UI still says ENCRYPTED.
    const key=await dk(rc),iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(plain)));
    return _emojiFromBytes(_concat(iv,ct),id,rc);
  };
  const decrypt=async(emoji,rc,id='x')=>{
    if(!emoji||!rc)return'';
    try{
      const bytes=_bytesFromEmoji(emoji,id,rc);
      if(bytes.length<13)return'🔒';
      const key=await dk(rc);
      const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12));
      return new TextDecoder().decode(dec);
    }catch{return'🔒';}
  };
  const shortDisplay=e=>e||'🔒';
  const calcReadTime=plain=>{
    if(!plain)return 4000;
    const words=plain.trim().split(/\s+/).length;
    return Math.max(3000,Math.min(30000,words*900));
  };
  return{encrypt,decrypt,shortDisplay,calcReadTime};
})();

const Envelope = (() => {
  const enc=new TextEncoder();
  const b64=u8=>{let s='';const CH=0x8000;for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);};
  const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const wrapSalt=enc.encode('VoidChatMKWrapV1');
  // A fresh ECDH P-256 keypair; public half goes to the room key directory,
  // private half to the owner-only vault.
  const genKeypair=async()=>{
    const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    return{
      pub:b64(new Uint8Array(await crypto.subtle.exportKey('spki',kp.publicKey))),
      priv:b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8',kp.privateKey)))
    };
  };
  const kek=async(myPrivB64,theirPubB64)=>{
    const priv=await crypto.subtle.importKey('pkcs8',unb64(myPrivB64),{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    const pub=await crypto.subtle.importKey('spki',unb64(theirPubB64),{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await crypto.subtle.deriveBits({name:'ECDH',public:pub},priv,256);
    const hk=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:wrapSalt,info:enc.encode('mk-wrap')},hk,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  };
  const wrap=async(mk,myPriv,theirPub)=>{
    const k=await kek(myPriv,theirPub);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,mk));
    return b64(_concat(iv,ct));
  };
  const unwrap=async(capsule,myPriv,theirPub)=>{
    const k=await kek(myPriv,theirPub);
    const bytes=unb64(capsule);
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},k,bytes.slice(12)));
  };
  const contentKey=mk=>crypto.subtle.importKey('raw',mk,{name:'AES-GCM'},false,['encrypt','decrypt']);
  // Encrypt under a fresh key and wrap that key to every recipient (self included,
  // so the sender can re-read their own history).
  const seal=async(plain,rc,id,myPriv,pubsByUid)=>{
    const mk=new Uint8Array(32); crypto.getRandomValues(mk);
    const key=await contentKey(mk);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(plain)));
    const content=_emojiFromBytes(_concat(iv,ct),id,rc);
    const wrapped={};
    for(const[uid,pub]of Object.entries(pubsByUid||{})){
      try{wrapped[uid]=await wrap(mk,myPriv,pub);}
      catch(e){console.warn('Envelope: wrap failed for',uid);}
    }
    return{content,wrapped};
  };
  // Unwrap our copy of the per-message key (needs the sender's public key — the
  // ECDH shared secret is the same from either side) and decrypt.
  const open=async(content,capsule,myPriv,senderPub,rc,id)=>{
    const mk=await unwrap(capsule,myPriv,senderPub);
    const key=await contentKey(mk);
    const bytes=_bytesFromEmoji(content,id,rc);
    if(bytes.length<13)return null;
    const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12));
    return new TextDecoder().decode(dec);
  };
  const fingerprint=async pubB64=>{
    const d=await crypto.subtle.digest('SHA-256',enc.encode('VoidChatFPV1|'+pubB64));
    const hex=[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
    return (hex.slice(0,32).match(/.{4}/g)||[]).join(' ');
  };
  // Safety number: 60 decimal digits derived from BOTH public keys (sorted, so
  // either side computes the same value), rendered as 12 groups of 5. Compare it
  // out-of-band: matching digits mean no key-substitution in the directory.
  const safetyNumber=async(pubA,pubB)=>{
    const pair=[pubA,pubB].sort();
    let digits='';
    for(let i=0;digits.length<60;i++){
      const d=await crypto.subtle.digest('SHA-512',enc.encode(`VoidChatSafetyV1|${i}|${pair[0]}|${pair[1]}`));
      digits+=BigInt('0x'+[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')).toString();
    }
    return digits.slice(0,60).replace(/(\d{5})(?=\d)/g,'$1 ');
  };
  // Passphrase-encrypted backups: PBKDF2-SHA256 (600k) → AES-256-GCM.
  // Layout: 16-byte salt ‖ 12-byte iv ‖ ciphertext.
  const backupKey=async(pass,salt)=>{
    const km=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  };
  const backupSeal=async(text,pass)=>{
    const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await backupKey(pass,salt);
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(text)));
    return b64(_concat(salt,_concat(iv,ct)));
  };
  const backupOpen=async(blob,pass)=>{
    const bytes=unb64(blob);
    if(bytes.length<16+12+16)throw new Error('backup too short');
    const salt=bytes.slice(0,16), iv=bytes.slice(16,28), ct=bytes.slice(28);
    const key=await backupKey(pass,salt);
    const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
    return new TextDecoder().decode(dec);
  };
  return{genKeypair,seal,open,fingerprint,safetyNumber,backupSeal,backupOpen};
})();
