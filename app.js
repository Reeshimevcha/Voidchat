firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const RTC_CONFIG = {
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
    {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
    {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
  ]
};

const S = {
  uid: null,
  name:null, room:null, type:null, isOwner:false,
  canDownload:false, myVisibleTo:null,
  roomExpires:null, listeners:[], timers:{}, schedTimers:{},
  sessInterval:null, revealed:new Set(), globalReveal:false, pubs:{}, myPriv:null, trust:{}, keyModalUid:null,
  schedTime:null, destructSecs:0, revealSecs:0, sidebarOpen:false,
  recorder:null, recordingChunks:[], isRecording:false, recordTimer:null,
  peerConn:null, localStream:null, callId:null, inCall:false,
  callTimers:{}, pendingCandidates:[], peerRole:null, peerName:null, iceRestarted:false, offCandidates:null,
  pollOptions:['',''], checkItems:[],
  pinnedMsgId:null,
  replyTo:null,
  searchOpen:false,
  msgCache:{}, sendTimes:[],
  wmOn:(()=>{try{return localStorage.getItem('vc_wm')!=='0';}catch(e){return true;}})(),
  roomUsers:{},
  curtainOn:false, curtainToastAt:0, captureTimer:null,
};

const $ = id => document.getElementById(id);
const ce = t => document.createElement(t);
const fmt = ts => new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const fmtFull = ts => new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fmtDT = ts => new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtSz = b => b<1024?`${b}B`:b<1048576?`${(b/1024).toFixed(1)}KB`:`${(b/1048576).toFixed(1)}MB`;
const fmtDur = ms => { const s=Math.floor(ms/1000),m=Math.floor(s/60); return m>0?`${m}m ${s%60}s`:`${s}s`; };
const fmtSecs = s => s<60?`${s}s`:s<3600?`${Math.floor(s/60)}m ${s%60}s`:`${Math.floor(s/3600)}h`;
const hue = s => { let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; };
const genCode = () => { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>c[x%32]).join(''); };
const avatarBg = name => `hsl(${hue(name)},70%,45%)`;
const avatarLetter = name => esc(String(name||'?').charAt(0).toUpperCase());

function toast(msg, type='info') {
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t=ce('div'); t.className=`toast toast-${type}`;
  t.innerHTML=`<span class="ti">${{success:'✓',error:'✗',info:'i'}[type]||'i'}</span><span class="tm"></span>`;
  t.querySelector('.tm').textContent=msg;   // never innerHTML: callers pass error strings
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},3000);
}
function copyText(text){ navigator.clipboard.writeText(text).then(()=>toast('Copied!','success')); }
function showScreen(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); const s=$(id); if(s)s.classList.add('active'); }

// ── Connection diagnostics ────────────────────────────────────────────────
// A bare "sign-in failed" toast cannot be acted on: the usual causes are a
// hostname that is not allowlisted in Firebase, Anonymous sign-in being off,
// or the page being opened as a file:// document. Say which one it is, show
// the rejected hostname, and offer a retry instead of leaving a dead button.
function authErrorMessage(e){
  const code=(e&&e.code)||'';
  if(location.protocol==='file:')
    return 'This page is open from a file (file://), where Firebase sign-in cannot run. Serve it over http:// or https:// (GitHub Pages, Netlify, or a local server) instead of double-clicking index.html.';
  const host=location.hostname||'this origin';
  const map={
    'auth/unauthorized-domain':`The domain ${host} is not authorised for Firebase Authentication. Add it in Firebase Console → Authentication → Settings → Authorized domains, then retry.`,
    'auth/operation-not-allowed':'Anonymous sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method → Anonymous, then retry.',
    'auth/network-request-failed':'Firebase is unreachable. A firewall, VPN, proxy or ad-blocker is blocking identitytoolkit.googleapis.com — check the connection and retry.',
    'auth/invalid-api-key':'The Firebase apiKey in firebase-config.js is invalid or restricted. Check the API key restrictions in Google Cloud Console.',
    'auth/too-many-requests':'Too many sign-in attempts from this network. Wait a minute, then retry.',
    'auth/app-deleted':'This Firebase project no longer exists. Check firebase-config.js.',
    'auth/internal-error':'Firebase returned an internal error. Retry in a moment.'
  };
  return map[code]||`Sign-in failed${code?' ('+code+')':''}. Open the browser console for the full error, then retry.`;
}
function dbErrorMessage(e){
  const code=(e&&e.code)||'';
  const text=`${code} ${(e&&e.message)||''}`;
  if(/PERMISSION_DENIED/i.test(text))
    return 'The database rejected this request (PERMISSION_DENIED). Publish database.rules.json in Firebase Console → Realtime Database → Rules, then retry.';
  if(/UNAVAILABLE|disconnected|network|offline/i.test(text))
    return 'Cannot reach the Realtime Database. Check your connection (or VPN/firewall) and retry.';
  if(/INVALID_URL|invalid.*url/i.test(text))
    return 'The databaseURL in firebase-config.js is invalid. Copy it from Firebase Console → Realtime Database.';
  return 'Database error: '+(code||(e&&e.message)||'unknown')+'. Open the browser console for details.';
}
function showConnError(msg){
  const box=$('conn-error'), m=$('conn-error-msg');
  if(!box||!m)return;
  m.textContent=msg;
  box.classList.remove('hidden');
}
function clearConnError(){
  $('conn-error')?.classList.add('hidden');
}
async function connectFirebase(){
  clearConnError();
  try{
    const cred=await auth.signInAnonymously();
    S.uid=cred.user.uid;
    return true;
  }catch(e){
    console.error('sign-in failed',e);
    showConnError(authErrorMessage(e));
    toast('Cannot connect','error');
    return false;   // no uid means every write would be rejected by the rules anyway
  }
}
async function retryConnect(){
  const btn=$('btn-retry-connect');
  if(btn){btn.disabled=true;btn.textContent='CONNECTING…';}
  const ok=await connectFirebase();
  if(btn){btn.disabled=false;btn.textContent='RETRY CONNECTION';}
  if(!ok)return;
  toast('Connected','success');
  await tryRestore();
}

document.addEventListener('DOMContentLoaded', async()=>{
  initLanding(); initChat(); initEmojiPicker(); initAttachMenu(); initVoiceNote();
  initSearch(); initCipherVisualizer(); initScreenProtection();
  if(!await connectFirebase()) return;   // the landing banner explains why
  await tryRestore();
});

async function tryRestore(){
  const sv=JSON.parse(localStorage.getItem('vc_sess')||'null'); if(!sv)return;
  try{
    const base=`rooms/${sv.room}`;
    const [closed,expiresAt,owner,type,kicked]=await Promise.all(
      ['closed','expiresAt','owner','type'].map(f=>db.ref(`${base}/${f}`).once('value').then(s=>s.val()))
        .concat([db.ref(`${base}/users/${S.uid}/kicked`).once('value').then(s=>s.val())])
    );
    if(owner===null||closed===true||kicked===true){clearSess();return;}
    if(expiresAt&&Date.now()>expiresAt){clearSess();return;}
    S.name=sv.name; S.room=sv.room; S.type=type;
    S.isOwner=owner===S.uid;              // authoritative: from the DB, not localStorage
    S.canDownload=S.isOwner; S.roomExpires=expiresAt||null;
    await db.ref(`rooms/${S.room}/users/${S.uid}`).update({online:true,name:S.name});
    db.ref(`rooms/${S.room}/users/${S.uid}/online`).onDisconnect().set(false);
    enterChat(); toast('Session restored','success');
  }catch(e){clearSess();}
}
function saveSess(){ localStorage.setItem('vc_sess',JSON.stringify({name:S.name,room:S.room})); }
function clearSess(){ localStorage.removeItem('vc_sess'); }

// ── Landing ────────────────────────────────────────────────────────────────
function initLanding(){
  document.querySelectorAll('.type-card').forEach(c=>c.addEventListener('click',()=>{
    document.querySelectorAll('.type-card').forEach(x=>x.classList.remove('selected'));
    c.classList.add('selected');
    $('group-options').classList.toggle('hidden',c.dataset.type!=='group');
  }));
  $('max-unlimited').addEventListener('change',e=>$('max-users-wrap').classList.toggle('hidden',e.target.checked));
  $('btn-create').addEventListener('click',handleCreate);
  $('tab-join-btn').addEventListener('click',()=>switchTab('join'));
  $('tab-create-btn').addEventListener('click',()=>switchTab('create'));
  $('btn-join').addEventListener('click',handleJoin);
}
function switchTab(t){
  $('tab-create-btn').classList.toggle('active',t==='create');
  $('tab-join-btn').classList.toggle('active',t==='join');
  $('panel-create').classList.toggle('hidden',t!=='create');
  $('panel-join').classList.toggle('hidden',t!=='join');
}

async function handleCreate(){
  if(!S.uid){toast('Not connected — press RETRY CONNECTION','error');return;}
  const name=$('username-create').value.trim();
  if(!name){toast('Enter codename','error');return;}
  const tc=document.querySelector('.type-card.selected');
  const type=tc?tc.dataset.type:'duo';
  const maxUsers=type==='group'?($('max-unlimited').checked?0:parseInt($('max-users-val').value)||0):2;
  const sessMin=parseInt($('session-duration').value)||0;
  try{
    // Never .set() over a code that is already in use — that would hijack a live room.
    let code=null;
    for(let i=0;i<5&&!code;i++){
      const c=genCode();
      if((await db.ref(`rooms/${c}/owner`).once('value')).val()===null) code=c;
    }
    if(!code){toast('Could not allocate a channel code','error');return;}
    S.name=name; S.isOwner=true; S.type=type; S.room=code; S.canDownload=true;
    const expiresAt=sessMin>0?Date.now()+sessMin*60*1000:null; S.roomExpires=expiresAt;
    await db.ref(`rooms/${S.room}`).set({type,maxUsers,owner:S.uid,created:Date.now(),expiresAt,closed:false});
    await db.ref(`rooms/${S.room}/users/${S.uid}`).set({name,online:true,joinedAt:Date.now(),canDownload:true,myVisibleTo:null});
    db.ref(`rooms/${S.room}/users/${S.uid}/online`).onDisconnect().set(false);
    saveSess(); enterChat();
  }catch(e){
    console.error('create room failed',e);
    S.room=null; S.name=null; S.isOwner=false;
    toast(dbErrorMessage(e),'error');
  }
}

async function handleJoin(){
  if(!S.uid){toast('Not connected — press RETRY CONNECTION','error');return;}
  const name=$('username-join').value.trim();
  // Mobile keyboards like to add spaces or dashes; strip anything that is not a
  // letter/digit so a pasted "X7KQ-2M9PLZ" still joins.
  const code=$('room-code-join').value.replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  if(!name){toast('Enter codename','error');return;}
  if(!/^[A-Z2-9]{10}$/.test(code)){toast('Room code is 10 letters/digits (no 0, 1, I or O)','error');return;}
  try{
    // Read the public fields one by one: the room node itself is not readable to non-members.
    const base=`rooms/${code}`;
    const [owner,closed,expiresAt,type,maxUsers]=await Promise.all(
      ['owner','closed','expiresAt','type','maxUsers'].map(f=>db.ref(`${base}/${f}`).once('value').then(s=>s.val()))
    );
    if(owner===null){toast('Room not found','error');return;}
    const kicked=(await db.ref(`${base}/users/${S.uid}/kicked`).once('value')).val();
    if(kicked===true){toast('You were removed from this room','error');return;}
    if(closed===true){toast('Room is closed','error');return;}
    if(expiresAt&&Date.now()>expiresAt){toast('Room expired','error');return;}
    if(maxUsers>0){
      const us=await db.ref(`${base}/users`).once('value');
      if(Object.values(us.val()||{}).filter(u=>u.online).length>=maxUsers){toast('Room full','error');return;}
    }
    S.name=name; S.isOwner=owner===S.uid; S.room=code; S.type=type;
    S.canDownload=S.isOwner; S.roomExpires=expiresAt||null;
    await db.ref(`${base}/users/${S.uid}`).set({name,online:true,joinedAt:Date.now(),canDownload:S.isOwner,myVisibleTo:null});
    db.ref(`${base}/users/${S.uid}/online`).onDisconnect().set(false);
    saveSess(); enterChat();
  }catch(e){
    console.error('join room failed',e);
    S.room=null; S.name=null; S.isOwner=false;
    toast(dbErrorMessage(e),'error');
  }
}

// ── Enter Chat ─────────────────────────────────────────────────────────────
function enterChat(){
  showScreen('screen-chat');
  curtainOff(); $('toggle-wm').checked=S.wmOn; buildWatermark();
  $('chat-room-code').textContent=S.room;
  $('sb-room-code').textContent=S.room;
  $('room-type-badge').textContent=S.type==='duo'?'⚡ DUO':'◈ GROUP';
  $('btn-permissions').classList.toggle('hidden',!(S.isOwner&&S.type==='group'));
  $('btn-close-room').classList.toggle('hidden',!S.isOwner);
  listenRoom();
  initKeys();
  if(S.roomExpires) startSessTimer();
}

// ── Per-user keys (envelope encryption) ────────────────────────────────────
// Each member publishes an ECDH P-256 public key in the room key directory and
// keeps the private half in an owner-only vault. Restricted messages wrap their
// per-message key to these public keys — unlisted members cannot unwrap them.
// The identity keypair lives on THIS device only. A database dump must not
// contain anything that decrypts history.
function localIdentity(){
  try{return JSON.parse(localStorage.getItem('vc_identity')||'null');}catch{return null;}
}
function saveIdentity(id){
  try{localStorage.setItem('vc_identity',JSON.stringify(id));}catch(e){console.error('saveIdentity failed',e);}
}
async function initKeys(){
  trustLoad();
  let id=localIdentity();
  if(!id){
    // One-time migration: older builds stored the private key in the database.
    // Best-effort only: when the rules have not been deployed the lookup is
    // denied, and that must never stop this device from having keys.
    let lp=null, lk=null;
    try{
      const [s1,s2]=await Promise.all([
        db.ref(`keys/${S.room}/${S.uid}/pub`).once('value'),
        db.ref(`vault/${S.room}/${S.uid}/priv`).once('value')
      ]);
      lp=s1.val(); lk=s2.val();
    }catch(e){console.warn('legacy key lookup unavailable (rules not deployed?)',e);}
    id=(lp&&lk)?{pub:lp,priv:lk}:await Envelope.genKeypair();
    try{saveIdentity(id);}catch(e){console.warn('identity could not be saved locally',e);}
    if(lk) db.ref(`vault/${S.room}/${S.uid}/priv`).remove().catch(()=>{});
  }
  // Keys are usable from here on — nothing below may block sending.
  S.myPriv=id.priv; S.pubs[S.uid]=id.pub;
  // Republish the public half (idempotent; heals a wiped key node). A rejection
  // means database.rules.json is not deployed: nobody can encrypt to this
  // device until it is, so surface that instead of failing silently.
  db.ref(`keys/${S.room}/${S.uid}/pub`).once('value')
    .then(s=>s.val()===id.pub?null:db.ref(`keys/${S.room}/${S.uid}/pub`).set(id.pub))
    .catch(e=>{
      console.error('public key publish failed',e);
      toast('Public key rejected by database rules — publish database.rules.json','error');
    });
  // Cache every member's public key; late joiners appear here too.
  const kRef=db.ref(`keys/${S.room}`);
  const onKey=snap=>{
    const p=snap.child('pub').val(); if(!p)return;
    S.pubs[snap.key]=p; notePeerKey(snap.key,p); renderKeys();
  };
  const onKeyErr=e=>{
    console.error('key directory unavailable',e);
    toast('Encryption key directory blocked by database rules — publish database.rules.json','error');
  };
  kRef.on('child_added',onKey,onKeyErr);
  S.listeners.push(()=>kRef.off('child_added',onKey));
  renderKeys();
}

// Recipients of a per-message key: the privacy list when one is set, otherwise
// every current member — plus the sender, so they can re-read their own history.
function recipientPubs(visList){
  const vis=Array.isArray(visList)?visList:null;
  const pubs={};
  if(S.pubs[S.uid]) pubs[S.uid]=S.pubs[S.uid];
  for(const[uid,u]of Object.entries(S.roomUsers||{})){
    if(uid===S.uid||!u||u.kicked)continue;
    if(vis&&!vis.includes(uid))continue;
    if(S.pubs[uid])pubs[uid]=S.pubs[uid];
  }
  return pubs;
}

// ── Trust layer: safety numbers, TOFU, key-change alarms ──────────────────
// Trust lives on this device (localStorage), per room. First sight of a peer
// key is TOFU: remembered silently. If it ever changes, the peer is flagged
// UNVERIFIED with a loud alarm until the user compares the new safety number
// out-of-band and explicitly accepts it.
function trustLoad(){
  try{const all=JSON.parse(localStorage.getItem('vc_trust')||'{}');S.trust=all[S.room]||{};}catch{S.trust={};}
}
function trustSave(){
  try{
    const all=JSON.parse(localStorage.getItem('vc_trust')||'{}');
    all[S.room]=S.trust; localStorage.setItem('vc_trust',JSON.stringify(all));
  }catch(e){console.error('trustSave failed',e);}
}
const peerName=uid=>S.roomUsers[uid]?.name||String(uid||'').slice(0,8)+'…';
function notePeerKey(uid,pub){
  if(uid===S.uid)return;
  const rec=S.trust[uid];
  if(!rec){S.trust[uid]={pub,verified:false};trustSave();return;}
  if(rec.pub!==pub&&rec.pending!==pub){
    rec.pending=pub; rec.verified=false; trustSave();
    toast(`⚠ Encryption key changed for ${peerName(uid)} — verify again`,'error');
  }
}
function pendingKeys(){return Object.keys(S.trust).filter(u=>S.roomUsers[u]&&S.trust[u]&&S.trust[u].pending);}
function updateKeyAlarm(){
  const el=$('key-alarm'); if(!el)return;
  const p=pendingKeys();
  el.classList.toggle('hidden',!p.length);
  if(p.length)$('key-alarm-text').textContent=p.length===1
    ? `Encryption key changed for ${peerName(p[0])} — verify before trusting`
    : `${p.length} member keys changed — verify`;
}
function renderKeys(){
  const list=$('key-list'); if(!list)return;
  list.innerHTML='';
  let n=0;
  const me=S.pubs[S.uid];
  if(me){
    const row=ce('div'); row.className='perm-row key-row';
    row.innerHTML=`<div class="pa" style="background:${avatarBg(S.name||'?')}">${avatarLetter(S.name||'?')}</div>
      <div class="pm"><span class="pn">YOU</span><span class="priv-status" style="color:#00d4ff;font-size:9px;display:block">YOUR KEY</span></div>
      <button class="key-btn" ${act('openKeyModal',[S.uid])}>🔑</button>`;
    list.appendChild(row);
  }
  for(const[uid,u]of Object.entries(S.roomUsers)){
    if(!u||uid===S.uid)continue;
    const rec=S.trust[uid]||{};
    const noKey=!S.pubs[uid];
    const st=noKey?'nokey':(rec.pending?'changed':(rec.verified?'verified':'unverified'));
    const label=st==='verified'?'✓ VERIFIED':st==='changed'?'⚠ CHANGED':st==='nokey'?'○ KEY NOT PUBLISHED':'○ UNVERIFIED';
    const color=st==='verified'?'#00ff41':(st==='changed'||st==='nokey')?'#ffaa00':'#446644';
    const row=ce('div'); row.className='perm-row key-row';
    row.innerHTML=`<div class="pa" style="background:${avatarBg(u.name||'?')}">${avatarLetter(u.name||'?')}</div>
      <div class="pm"><span class="pn">${esc(u.name||'?')}</span><span class="priv-status" style="color:${color};font-size:9px;display:block">${label}</span></div>
      <button class="key-btn" ${act('openKeyModal',[uid])}>🔑</button>`;
    list.appendChild(row); n++;
  }
  const kc=$('key-count'); if(kc)kc.textContent=n;
  updateKeyAlarm();
}
async function openKeyModal(uid){
  if(!uid)return;
  const myPub=S.pubs[S.uid], theirPub=S.pubs[uid];
  if(!theirPub){
    toast(`${peerName(uid)} has not published a key. The database rules must allow /keys — publish database.rules.json, then both reload`,'error');
    return;
  }
  if(!myPub){toast('Your own key is still being generated — try again in a moment','error');return;}
  S.keyModalUid=uid;
  const rec=S.trust[uid]||{};
  const fp=await Envelope.fingerprint(theirPub);
  const verifyBtn=$('km-verify'), acceptBtn=$('km-accept'), num=$('km-num'), sub=$('km-sub'), st=$('km-status');
  if(uid===S.uid){
    $('km-title').textContent='YOUR IDENTITY KEY';
    sub.textContent='Share this fingerprint with others through another channel so they can verify you.';
    num.textContent=fp; $('km-fp').textContent='';
    verifyBtn.classList.add('hidden'); acceptBtn.classList.add('hidden');
    st.textContent=''; st.style.color='';
  }else{
    $('km-title').textContent=`SAFETY NUMBER — ${peerName(uid)}`;
    sub.textContent='Compare these 60 digits with the other person through another channel. If they match, nobody is impersonating them.';
    num.textContent=await Envelope.safetyNumber(myPub,theirPub);
    $('km-fp').textContent=`KEY FINGERPRINT: ${fp}`;
    if(rec.pending){
      verifyBtn.classList.add('hidden'); acceptBtn.classList.remove('hidden');
      st.textContent='⚠ THIS KEY CHANGED — verify the new number before accepting.';
      st.style.color='#ffaa00';
    }else{
      acceptBtn.classList.add('hidden'); verifyBtn.classList.remove('hidden');
      verifyBtn.textContent=rec.verified?'✕ MARK UNVERIFIED':'✓ MARK VERIFIED';
      st.textContent=rec.verified?'✓ Verified on this device':'Not verified yet';
      st.style.color=rec.verified?'#00ff41':'#446644';
    }
  }
  $('key-modal').classList.remove('hidden');
}
function closeKeyModal(){ $('key-modal').classList.add('hidden'); S.keyModalUid=null; }
function toggleVerifyKey(){
  const uid=S.keyModalUid; if(!uid||uid===S.uid)return;
  const rec=S.trust[uid]; if(!rec)return;
  rec.verified=!rec.verified; trustSave();
  toast(rec.verified?'✓ Key marked verified':'Key marked unverified','info');
  openKeyModal(uid); renderKeys();
}
function acceptKey(){
  const uid=S.keyModalUid; if(!uid)return;
  const rec=S.trust[uid]; if(!rec||!rec.pending)return;
  rec.pub=rec.pending; delete rec.pending; rec.verified=false; trustSave();
  toast('New key accepted — verify the safety number to trust it','info');
  openKeyModal(uid); renderKeys();
}
function copySafetyNumber(){
  const t=$('km-num')?.textContent||''; if(!t||t==='—')return;
  copyText(t.replace(/\s/g,''));
}
function reviewKeyAlarm(){
  const p=pendingKeys(); if(p.length)openKeyModal(p[0]);
}

// ── UI action registry (CSP: no inline handlers anywhere) ──────────────────
// Controls carry data-action="name" (space-separated = several calls) with an
// optional data-args='[...]' JSON array and data-evt="input|change". Actions
// run as fn(...args, event, element). The registry is a fixed object — never a
// window[name] lookup — so markup cannot name arbitrary globals.
const act=(name,args,evt)=>
  `data-action="${name}"${args&&args.length?` data-args="${esc(JSON.stringify(args))}"`:''}${evt?` data-evt="${evt}"`:''}`;
const ACTION_FNS={
  closeSidebar:()=>closeSidebar(),
  clearFile:()=>clearFile(),
  closeInputPanels:()=>closeInputPanels(),
  applyRevealTimer:()=>applyRevealTimer(),
  closeLightbox:()=>closeLightbox(),
  upperInput:(ev,el)=>{el.value=el.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);},
  autoGrow:(ev,el)=>{el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px';},
  pinMessage:(id,ev)=>pinMessage(id,ev),
  setReplyFrom:(id)=>setReplyFrom(id),
  scrollToMsg:(id)=>scrollToMsg(id),
  toggleReveal:(id)=>toggleReveal(id),
  openLightbox:(src)=>openLightbox(src),
  toggleAudio:(id)=>toggleAudio(id),
  votePoll:(id,opt)=>votePoll(id,opt),
  toggleCheckItem:(id,idx)=>toggleCheckItem(id,idx),
  doReact:(id,emoji)=>doReact(id,emoji),
  closeRxPicker:(...a)=>{const el=a[a.length-1];if(el&&el.closest)el.closest('.rx-picker')?.remove();},
  openRxPicker:(id,ev,el)=>openRxPicker(id,ev,el),
  kickUser:(uid,name)=>kickUser(uid,name),
  setPermToggle:(uid,field,ev,el)=>setPerm(uid,field,!!el.checked),
  myVisToggle:(uid,ev,el)=>toggleMyVis(uid,!!el.checked),
  setPollOpt:(i,ev,el)=>{S.pollOptions[i]=el.value;},
  delPollOpt:(i)=>{S.pollOptions.splice(i,1);renderPollOptions();},
  setCheckItem:(i,ev,el)=>{S.checkItems[i]=el.value;},
  delCheckItem:(i)=>{S.checkItems.splice(i,1);renderCheckItems();},
  openKeyModal:(uid)=>openKeyModal(uid),
  closeKeyModal:()=>closeKeyModal(),
  toggleVerifyKey:()=>toggleVerifyKey(),
  acceptKey:()=>acceptKey(),
  copySafetyNumber:()=>copySafetyNumber(),
  reviewKeyAlarm:()=>reviewKeyAlarm(),
  openBackup:()=>openBackup(),
  closeBackup:()=>closeBackup(),
  backupExport:()=>backupExport(),
  backupPickFile:()=>$('backup-file').click(),
  backupImport:()=>backupImport(),
  retryConnect:()=>retryConnect(),
  toggleWatermark:(ev,el)=>toggleWatermark(el)
};
function runAction(e){
  const t=e.target, el=t&&t.closest?t.closest('[data-action]'):null;
  if(!el)return;
  if((el.dataset.evt||'click')!==e.type)return;
  let args=[]; try{args=JSON.parse(el.dataset.args||'[]');}catch{args=[];}
  for(const name of (el.dataset.action||'').split(/\s+/).filter(Boolean)){
    const fn=ACTION_FNS[name];
    if(fn)fn(...args,e,el);
  }
}
document.addEventListener('click',runAction);
document.addEventListener('input',runAction);
document.addEventListener('change',runAction);
// Any broken <img> (including DB-supplied media) hides itself.
document.addEventListener('error',e=>{const t=e.target;if(t&&t.tagName==='IMG')t.style.display='none';},true);

// ── PRIVACY HELPERS ────────────────────────────────────────────────────────
// Normalize Firebase value (may be object) to array or null
function normArr(v){
  if(v===null||v===undefined) return null;
  if(Array.isArray(v)) return v;
  return Object.values(v);
}

// Can the current user see this message?
// Checks BOTH baked-in visibleTo AND the sender's LIVE current myVisibleTo from roomUsers
function canView(data){
  if(data.from===S.uid) return true;
  // Check sender's live privacy setting first (most up-to-date)
  const sender=S.roomUsers[data.from];
  if(sender){
    const liveVis=normArr(sender.myVisibleTo);
    if(liveVis!==null && !liveVis.includes(S.uid)) return false;
  }
  // Also check baked-in visibleTo on the message
  const msgVis=normArr(data.visibleTo);
  if(msgVis!==null && !msgVis.includes(S.uid)) return false;
  return true;
}

// Re-render all messages based on current privacy state
function reRenderAllMsgVisibility(){
  document.querySelectorAll('.msg-wrap').forEach(wrap=>{
    const id=wrap.id.replace('msg-','');
    const cached=S.msgCache[id]; if(!cached||cached.from===S.uid) return;
    const nowCanSee=canView(cached);
    const body=wrap.querySelector('.msg-content'); if(!body) return;
    const wasEncOnly=body.classList.contains('msg-encrypted-only');
    if(!wasEncOnly && !nowCanSee){
      // Was visible, now restricted — show encrypted only, no reveal button
      S.revealed.delete(id);
      if(cached.content) body.textContent=EmojiCipher.shortDisplay(cached.content);
      body.classList.add('msg-encrypted-only');
      body.removeAttribute('id'); body.removeAttribute('data-raw'); body.removeAttribute('data-state');
      const btn=body.nextElementSibling;
      if(btn&&btn.classList.contains('btn-reveal')) btn.remove();
    } else if(wasEncOnly && nowCanSee && cached.content){
      // Was hidden, now allowed — restore reveal button
      body.classList.remove('msg-encrypted-only');
      body.id='mc-'+id;
      body.dataset.id=id;
      body.dataset.raw=encodeURIComponent(cached.content);
      body.dataset.state='encrypted';
      body.textContent=EmojiCipher.shortDisplay(cached.content);
      // Add reveal button if missing
      if(!body.nextElementSibling||!body.nextElementSibling.classList.contains('btn-reveal')){
        const btn=ce('button'); btn.className='btn-reveal';
        btn.textContent='👁 REVEAL';
        btn.onclick=()=>toggleReveal(id);
        body.insertAdjacentElement('afterend',btn);
      }
    }
  });
}

function listenRoom(){
  const root=db.ref(`rooms/${S.room}`);
  const uRef=root.child('users');
  const uL=uRef.on('value',snap=>{
    const users=snap.val()||{};
    // Update live user cache FIRST so canView uses latest data
    S.roomUsers=users;
    const me=users[S.uid];
    if(me){
      if(me.kicked){forceLeave('You were removed from this room');return;}
      S.canDownload=!!me.canDownload||S.isOwner;
      // Normalize myVisibleTo from Firebase (object vs array)
      S.myVisibleTo=normArr(me.myVisibleTo);
      $('btn-download-chat').classList.toggle('hidden',!S.canDownload);
      $('btn-backup').classList.toggle('hidden',!S.canDownload);
    }
    renderUsers(users);
    if(S.isOwner&&S.type==='group') renderOwnerPerms(users);
    renderMyPrivacy(users);
    renderKeys();
    // Re-check all message visibility whenever any user's privacy changes
    reRenderAllMsgVisibility();
  });
  const mRef=root.child('messages');
  const mAdd=mRef.orderByChild('timestamp').on('child_added',snap=>{
    const d=snap.val(); if(!d)return;
    renderMessage(snap.key,d); markDelivered(snap.key,d);
  });
  const mChg=mRef.on('child_changed',snap=>{
    const d=snap.val(); if(!d)return;
    updateReceipts(snap.key,d); updateReactions(snap.key,d); updatePollUI(snap.key,d);
    updateChecklistUI(snap.key,d);
  });
  const mDel=mRef.on('child_removed',snap=>{
    removeMsgUI(snap.key);
    if(snap.key===S.pinnedMsgId) clearPinnedBar();
  });
  // FIXED: scheduled delivery — all users listen, sender delivers
  const sRef=root.child('scheduled');
  const sAdd=sRef.on('child_added',snap=>{
    const d=snap.val(); if(!d) return;
    // Only the original sender runs the timer to deliver
    if(d.from===S.uid) scheduleDelivery(snap.key,d);
  });
  const pinRef=root.child('pinned');
  const pinL=pinRef.on('value',snap=>{
    const d=snap.val();
    if(d&&d.msgId) renderPinnedBar(d);
    else clearPinnedBar();
  });
  const closedRef=root.child('closed');
  const closedL=closedRef.on('value',snap=>{if(snap.val()===true&&!S.isOwner)forceLeave('Room was closed');});
  const callRef=root.child('call');
  const callL=callRef.on('value',snap=>{const d=snap.val();if(d)handleCallSignal(d).catch(e=>console.error('call signal failed',e));});
  S.listeners=[
    ()=>uRef.off('value',uL),
    ()=>mRef.off('child_added',mAdd),
    ()=>mRef.off('child_changed',mChg),
    ()=>mRef.off('child_removed',mDel),
    ()=>sRef.off('child_added',sAdd),
    ()=>pinRef.off('value',pinL),
    ()=>closedRef.off('value',closedL),
    ()=>callRef.off('value',callL),
  ];
}

// ── Session Timer ──────────────────────────────────────────────────────────
function startSessTimer(){
  if(S.sessInterval) clearInterval(S.sessInterval);
  $('session-timer-wrap').classList.remove('hidden');
  const tick=async()=>{
    const rem=S.roomExpires-Date.now();
    if(rem<=0){clearInterval(S.sessInterval);if(S.isOwner)await closeRoom(true);else forceLeave('Session expired');return;}
    $('session-countdown').textContent=fmtDur(rem);
    $('session-timer-wrap').classList.toggle('expiring',rem<300000);
  };
  tick(); S.sessInterval=setInterval(tick,1000);
}

// ── Users List ─────────────────────────────────────────────────────────────
function renderUsers(users){
  const list=$('users-list'); list.innerHTML='';
  let online=0;
  for(const[uid,u]of Object.entries(users)){
    if(!u)continue; if(u.online)online++;
    const li=ce('li'); li.className=`user-item ${u.online?'online':'offline'}`;
    const bg=avatarBg(u.name||'?');
    const ownerTag=uid===S.uid&&S.isOwner?' 👑':'';
    li.innerHTML=`
      <div class="ua" style="background:${bg}">${avatarLetter(u.name||'?')}</div>
      <div class="um">
        <span class="un">${esc(u.name||'?')}${uid===S.uid?` <span class="you-tag">YOU</span>`:''}${ownerTag}</span>
        <span class="us">${u.online?'● ONLINE':'○ OFFLINE'} · ${u.canDownload?'⬇':'🔒'}</span>
      </div>`;
    list.appendChild(li);
  }
  $('online-count').textContent=online;
  const othersOnline=Object.entries(users).filter(([uid,u])=>uid!==S.uid&&u?.online).length;
  $('btn-voice-call').classList.toggle('hidden',othersOnline===0||S.inCall);
}

// ── Owner Access Control ───────────────────────────────────────────────────
function renderOwnerPerms(users){
  const p=$('owner-perm-list'); if(!p)return; p.innerHTML='';
  let has=false;
  for(const[uid,u]of Object.entries(users)){
    if(!u||uid===S.uid)continue; has=true;
    const row=ce('div'); row.className='perm-row';
    const bg=avatarBg(u.name||'?');
    row.innerHTML=`
      <div class="pa" style="background:${bg}">${avatarLetter(u.name||'?')}</div>
      <div class="pm">
        <span class="pn">${esc(u.name||'?')}</span>
        <span class="ps ${u.online?'online':'offline'}">${u.online?'● ONLINE':'○ OFFLINE'}</span>
      </div>
      <div class="pt">
        <div class="ptr">
          <span class="ptl">Download</span>
          <label class="toggle-switch">
            <input type="checkbox" ${u.canDownload?'checked':''} ${act('setPermToggle',[uid,'canDownload'],'change')}>
            <span class="tt"></span>
          </label>
        </div>
        <div class="ptr">
          <button class="kick-btn" ${act('kickUser',[uid,u.name||'user'])}>Kick</button>
        </div>
      </div>`;
    p.appendChild(row);
  }
  if(!has) p.innerHTML='<div class="perm-empty">Waiting for members…</div>';
}
async function setPerm(uid,field,val){
  await db.ref(`rooms/${S.room}/users/${uid}/${field}`).set(val);
  toast(`Download ${val?'granted':'revoked'}`,'success');
}
async function kickUser(uid,name){
  if(!confirm(`Kick ${name} from the room?`))return;
  await db.ref(`rooms/${S.room}/users/${uid}/online`).set(false);
  await db.ref(`rooms/${S.room}/users/${uid}/kicked`).set(true);
  toast(`${name} kicked`,'success');
}

// ── My Privacy ─────────────────────────────────────────────────────────────
function renderMyPrivacy(users){
  const p=$('my-privacy-list'); if(!p)return; p.innerHTML='';
  for(const[uid,u]of Object.entries(users)){
    if(!u||uid===S.uid)continue;
    // Use normalized S.myVisibleTo (already normalized in listener)
    const allowed=S.myVisibleTo===null || (Array.isArray(S.myVisibleTo)&&S.myVisibleTo.includes(uid));
    const row=ce('div'); row.className='perm-row';
    const bg=avatarBg(u.name||'?');
    row.innerHTML=`
      <div class="pa" style="background:${bg}">${avatarLetter(u.name||'?')}</div>
      <div class="pm">
        <span class="pn">${esc(u.name||'?')}</span>
        <span class="ps ${u.online?'online':'offline'}">${u.online?'● ONLINE':'○ OFFLINE'}</span>
        <span class="priv-status" style="color:${allowed?'#00ff41':'#ff4444'};font-size:9px;display:block">${allowed?'✓ CAN READ':'🔒 BLOCKED'}</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${allowed?'checked':''} ${act('myVisToggle',[uid],'change')}>
        <span class="tt"></span>
      </label>`;
    p.appendChild(row);
  }
  if(!p.children.length) p.innerHTML='<div class="perm-empty">No other users yet…</div>';
}

async function toggleMyVis(uid, allow){
  // Get all other users
  const snap=await db.ref(`rooms/${S.room}/users`).once('value');
  const allOthers=Object.keys(snap.val()||{}).filter(k=>k!==S.uid);

  // Build current list from S.myVisibleTo (already normalized)
  let current = S.myVisibleTo===null ? [...allOthers] : [...(S.myVisibleTo||[])];

  if(allow){
    if(!current.includes(uid)) current.push(uid);
  } else {
    current=current.filter(k=>k!==uid);
  }

  // If all others are included, save null (visible to everyone)
  const isAll = allOthers.length>0 && allOthers.every(k=>current.includes(k));
  const newVal = isAll ? null : current;

  // Update local state immediately BEFORE Firebase so reRender uses new value
  S.myVisibleTo = newVal;
  if(S.roomUsers[S.uid]) S.roomUsers[S.uid].myVisibleTo = newVal;

  // Re-render messages immediately with new privacy
  reRenderAllMsgVisibility();

  // Persist to Firebase
  await db.ref(`rooms/${S.room}/users/${S.uid}/myVisibleTo`).set(newVal);
  toast(allow ? '✓ User can now read your messages' : '🔒 User blocked — messages now encrypted for them', 'info');
}

// ── Schedule / Destruct ────────────────────────────────────────────────────
function toggleSchedulePanel(){
  const p=$('schedule-panel'); const o=!p.classList.contains('hidden');
  closeInputPanels();
  if(!o){
    if(!$('sched-dt').value){const n=new Date(Date.now()+3600000);const pad=x=>String(x).padStart(2,'0');$('sched-dt').value=`${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;}
    p.classList.remove('hidden'); $('btn-schedule').classList.add('btn-active');
  }
}
function toggleDestructPanel(){
  const p=$('destruct-panel'); const o=!p.classList.contains('hidden');
  closeInputPanels();
  if(!o){p.classList.remove('hidden'); $('btn-destruct').classList.add('btn-active');}
}
function closeInputPanels(){
  ['schedule-panel','destruct-panel','attach-menu','emoji-picker-wrap','reply-bar'].forEach(id=>{
    const el=$(id); if(el&&id==='reply-bar'){clearReply();return;} if(el)el.classList.add('hidden');
  });
  ['btn-schedule','btn-destruct','btn-attach','btn-emoji'].forEach(id=>{const el=$(id);if(el)el.classList.remove('btn-active');});
}
function applySchedule(){
  const v=$('sched-dt').value; if(!v){toast('Pick date/time','error');return;}
  const ts=new Date(v).getTime(); if(ts<=Date.now()){toast('Must be future time','error');return;}
  S.schedTime=ts; $('btn-schedule').classList.add('btn-set');
  closeInputPanels(); toast(`Scheduled: ${fmtDT(ts)}`,'success');
}
function applyDestruct(){
  const v=parseInt($('destruct-sel').value)||0; S.destructSecs=v;
  $('btn-destruct').classList.toggle('btn-set',v>0);
  closeInputPanels(); if(v>0)toast(`Self-destruct: ${fmtSecs(v)}`,'success');
}
function applyRevealTimer(){
  const v=parseInt($('reveal-timer-sel').value)||0; S.revealSecs=v;
  closeInputPanels(); if(v>0)toast(`Auto-hide after: ${fmtSecs(v)}`,'success');
}
function clearSchedule(){ S.schedTime=null; $('btn-schedule').classList.remove('btn-set'); }
function clearDestruct(){ S.destructSecs=0; $('btn-destruct').classList.remove('btn-set'); }

// ── Attach Menu ────────────────────────────────────────────────────────────
function initAttachMenu(){
  $('btn-attach').addEventListener('click',e=>{
    e.stopPropagation();
    const open=!$('attach-menu').classList.contains('hidden');
    closeInputPanels();
    if(!open) $('attach-menu').classList.remove('hidden');
  });
  $('attach-poll').addEventListener('click',()=>{openPollBuilder();closeInputPanels();});
  $('attach-checklist').addEventListener('click',()=>{openChecklistBuilder();closeInputPanels();});
  $('attach-location').addEventListener('click',()=>{shareLocation();closeInputPanels();});
  $('attach-contact').addEventListener('click',()=>{openContactForm();closeInputPanels();});
  $('attach-photo').addEventListener('click',()=>{$('file-input').accept='image/*';$('file-input').click();closeInputPanels();});
  $('file-input').addEventListener('change',handleImageSelect);
}
function clearFile(){
  const fp=$('file-preview'); if(fp)fp.classList.add('hidden');
  const fi=$('file-input'); if(fi)fi.value='';
}
function handleImageSelect(e){
  const file=e.target.files[0]; if(!file)return;
  if(!file.type.startsWith('image/')){toast('Images only','error');return;}
  if(file.size>2*1024*1024){toast('Max 2MB for images','error');return;}
  if(sendThrottled()){e.target.value='';return;}
  const reader=new FileReader();
  reader.onload=async()=>{
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'image',
      fileUrl:reader.result,fileName:file.name,fileSize:file.size,
      readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
    toast('Image sent!','success');
  };
  reader.readAsDataURL(file);
  e.target.value='';
}

// ── Emoji Picker ───────────────────────────────────────────────────────────
const EMOJI_CATS = {
  '😀':['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🙂','🤗','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','😷','🤒','🤕','🤢','🤧','🥵','🥶','😵','🤯','🤠','🥳','🤓'],
  '👍':['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','🖐','✋','🖖','💪','🤲','👐','🙌','👏','🤝','🙏','✍️','💅','🫶'],
  '❤️':['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','🔥','⭐','🌟','✨','💫','🎉','🎊','🎈','🚀','💯','✅','❌','⚡'],
  '🐶':['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄'],
  '🍎':['🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥕','🌽','🍕','🍔','🍟','🌭','🥪','🌮','🥗','🍜','🍣','🍦','🎂'],
};
function initEmojiPicker(){
  const wrap=$('emoji-picker-wrap'); wrap.innerHTML='';
  for(const[cat,emojis]of Object.entries(EMOJI_CATS)){
    const sec=ce('div'); sec.className='ep-sec';
    const title=ce('div'); title.className='ep-title'; title.textContent=cat;
    const grid=ce('div'); grid.className='ep-grid';
    emojis.forEach(e=>{
      const btn=ce('button'); btn.className='ep-btn'; btn.textContent=e;
      btn.addEventListener('click',()=>insertEmoji(e)); grid.appendChild(btn);
    });
    sec.appendChild(title); sec.appendChild(grid); wrap.appendChild(sec);
  }
  $('btn-emoji').addEventListener('click',e=>{
    e.stopPropagation();
    const open=!wrap.classList.contains('hidden');
    closeInputPanels();
    if(!open){wrap.classList.remove('hidden');$('btn-emoji').classList.add('btn-active');}
  });
}
function insertEmoji(e){
  const inp=$('msg-input');
  const start=inp.selectionStart,end=inp.selectionEnd;
  inp.value=inp.value.slice(0,start)+e+inp.value.slice(end);
  inp.selectionStart=inp.selectionEnd=start+e.length; inp.focus();
}

// ── Voice Note ─────────────────────────────────────────────────────────────
function initVoiceNote(){
  const btn=$('btn-voice-note');
  btn.addEventListener('pointerdown',e=>{e.preventDefault();startRecording();});
  btn.addEventListener('pointerup',e=>{e.preventDefault();stopRecording();});
  btn.addEventListener('pointerleave',()=>{if(S.isRecording)stopRecording();});
  btn.addEventListener('touchstart',e=>{e.preventDefault();startRecording();},{passive:false});
  btn.addEventListener('touchend',e=>{e.preventDefault();stopRecording();});
}
async function startRecording(){
  if(S.isRecording)return;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    S.localStream=stream; S.recordingChunks=[];
    S.recorder=new MediaRecorder(stream);
    S.recorder.ondataavailable=e=>{if(e.data.size>0)S.recordingChunks.push(e.data);};
    S.recorder.start(); S.isRecording=true;
    $('btn-voice-note').classList.add('recording');
    $('rec-indicator').classList.remove('hidden');
    let secs=0;
    S.recordTimer=setInterval(()=>{secs++;$('rec-time').textContent=fmtSecs(secs);if(secs>=120)stopRecording();},1000);
  }catch(e){toast('Microphone access denied','error');}
}
async function stopRecording(){
  if(!S.isRecording)return;
  clearInterval(S.recordTimer); S.isRecording=false;
  $('btn-voice-note').classList.remove('recording');
  $('rec-indicator').classList.add('hidden'); $('rec-time').textContent='0s';
  S.recorder.stop();
  S.localStream?.getTracks().forEach(t=>t.stop());
  await new Promise(r=>S.recorder.onstop=r);
  const blob=new Blob(S.recordingChunks,{type:'audio/webm'});
  if(blob.size<1000){toast('Too short — hold longer','error');return;}
  if(blob.size>5*1024*1024){toast('Recording too long (max ~60s)','error');return;}
  if(sendThrottled())return;
  toast('Sending voice note…','info');
  const reader=new FileReader();
  reader.onloadend=async()=>{
    const dur=Math.round(blob.size/8000);
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'voice',
      voiceUrl:reader.result,duration:dur,
      readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
    toast('🎙 Voice note sent!','success');
  };
  reader.readAsDataURL(blob);
}

// ── Poll ───────────────────────────────────────────────────────────────────
function openPollBuilder(){S.pollOptions=['',''];$('poll-question').value='';renderPollOptions();$('poll-builder').classList.remove('hidden');$('poll-builder').scrollIntoView({behavior:'smooth'});}
function renderPollOptions(){
  const c=$('poll-options-list'); c.innerHTML='';
  S.pollOptions.forEach((opt,i)=>{
    const row=ce('div'); row.className='builder-row';
    row.innerHTML=`<input class="fi" value="${esc(opt)}" placeholder="Option ${i+1}" ${act('setPollOpt',[i],'input')}>${S.pollOptions.length>2?`<button class="del-btn" ${act('delPollOpt',[i])}>✕</button>`:''}`;
    c.appendChild(row);
  });
}
function addPollOption(){if(S.pollOptions.length<8){S.pollOptions.push('');renderPollOptions();}}
async function sendPoll(){
  const q=$('poll-question').value.trim(); const opts=S.pollOptions.filter(o=>o.trim());
  if(!q){toast('Enter question','error');return;} if(opts.length<2){toast('Add at least 2 options','error');return;}
  if(sendThrottled())return;
  const msgRef=db.ref(`rooms/${S.room}/messages`).push();
  await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'poll',question:q,options:opts,votes:{},readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
  $('poll-builder').classList.add('hidden'); toast('Poll sent!','success');
}

// ── Checklist ──────────────────────────────────────────────────────────────
function openChecklistBuilder(){S.checkItems=[''];$('check-title').value='';renderCheckItems();$('check-builder').classList.remove('hidden');$('check-builder').scrollIntoView({behavior:'smooth'});}
function renderCheckItems(){
  const c=$('check-items-list'); c.innerHTML='';
  S.checkItems.forEach((item,i)=>{
    const row=ce('div'); row.className='builder-row';
    row.innerHTML=`<input class="fi" value="${esc(item)}" placeholder="Item ${i+1}" ${act('setCheckItem',[i],'input')}>${S.checkItems.length>1?`<button class="del-btn" ${act('delCheckItem',[i])}>✕</button>`:''}`;
    c.appendChild(row);
  });
}
function addCheckItem(){S.checkItems.push('');renderCheckItems();}
async function sendChecklist(){
  const title=$('check-title').value.trim(); const items=S.checkItems.filter(i=>i.trim()).map(t=>({text:t,checked:false}));
  if(!items.length){toast('Add at least one item','error');return;}
  if(sendThrottled())return;
  const msgRef=db.ref(`rooms/${S.room}/messages`).push();
  await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'checklist',title:title||'Checklist',items,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
  $('check-builder').classList.add('hidden'); toast('Checklist sent!','success');
}
async function toggleCheckItem(msgId,index){
  const snap=await db.ref(`rooms/${S.room}/messages/${msgId}/items/${index}/checked`).once('value');
  await db.ref(`rooms/${S.room}/messages/${msgId}/items/${index}/checked`).set(!snap.val());
}
function updateChecklistUI(id,data){
  if(data.type!=='checklist')return;
  const wrap=document.getElementById(`msg-${id}`); if(!wrap)return;
  const old=wrap.querySelector('.checklist-msg');
  if(old){const tmp=ce('div');tmp.innerHTML=buildChecklistMsg(id,data);old.replaceWith(tmp.firstChild);}
}

// ── Location & Contact ─────────────────────────────────────────────────────
function shareLocation(){
  if(!navigator.geolocation){toast('Geolocation not supported','error');return;}
  if(sendThrottled())return;
  toast('Getting location…','info');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const{latitude:lat,longitude:lng}=pos.coords;
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'location',lat,lng,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
    toast('Location shared!','success');
  },()=>toast('Could not get location','error'));
}
function openContactForm(){$('contact-builder').classList.remove('hidden');$('contact-builder').scrollIntoView({behavior:'smooth'});}
async function sendContact(){
  const name=$('contact-name').value.trim(); const phone=$('contact-phone').value.trim(); const email=$('contact-email').value.trim();
  if(!name&&!phone){toast('Enter name or phone','error');return;}
  if(sendThrottled())return;
  const msgRef=db.ref(`rooms/${S.room}/messages`).push();
  await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'contact',contactName:name,phone,email,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
  $('contact-builder').classList.add('hidden');
  $('contact-name').value='';$('contact-phone').value='';$('contact-email').value='';
  toast('Contact shared!','success');
}

// ── Send throttle ──────────────────────────────────────────────────────────
// RTDB rules cannot rate-limit, so every user-initiated send path (text,
// polls, checklists, images, voice notes, location, contacts) comes through
// here: 500 ms minimum gap, at most 10 sends per 10 seconds.
function sendThrottled(){
  const now=Date.now();
  S.sendTimes=S.sendTimes.filter(t=>now-t<10000);
  if((S.sendTimes.length&&now-S.sendTimes[S.sendTimes.length-1]<500)||S.sendTimes.length>=10){
    toast('Slow down — max 10 messages per 10 seconds','error'); return true;
  }
  S.sendTimes.push(now); return false;
}

// ── Send Message ───────────────────────────────────────────────────────────
async function handleSend(){
  const text=$('msg-input').value.trim(); if(!text)return;
  if(sendThrottled())return;
  closeInputPanels(); $('btn-send').disabled=true;
  try{
    if(S.schedTime){
      // Encrypt at rest under the schedule's own key id; the DB never holds plaintext.
      const schedRef=db.ref(`rooms/${S.room}/scheduled`).push();
      if(!S.myPriv||!S.pubs[S.uid]) throw new Error('keys not ready');
      const sealed=await Envelope.seal(text,S.room,schedRef.key,S.myPriv,recipientPubs(S.myVisibleTo));
      const content=sealed.content, wrapped=sealed.wrapped;
      const schedPayload={
        from:S.uid, fromName:S.name,
        timestamp:S.schedTime, scheduledFor:S.schedTime,
        sent:false, content, type:'text',
        expiresAt:S.destructSecs>0?S.schedTime+S.destructSecs*1000:null,
        revealSecs:S.revealSecs, visibleTo:S.myVisibleTo
      };
      if(wrapped) schedPayload.wrapped=wrapped;
      await schedRef.set(schedPayload);
      toast(`Scheduled: ${fmtDT(S.schedTime)}`,'success');
      clearSchedule(); clearDestruct();
    } else {
      const msgRef=db.ref(`rooms/${S.room}/messages`).push();
      const msgId=msgRef.key;
      await showCipherVisualizer(text);
      // Every text message gets its own random key, wrapped to the current
      // members — a database dump holds no key that decrypts history.
      if(!S.myPriv||!S.pubs[S.uid]) throw new Error('keys not ready');
      const sealed=await Envelope.seal(text,S.room,msgId,S.myPriv,recipientPubs(S.myVisibleTo));
      const enc=sealed.content, wrapped=sealed.wrapped;
      const payload={
        from:S.uid, fromName:S.name, timestamp:Date.now(),
        expiresAt:S.destructSecs>0?Date.now()+S.destructSecs*1000:null,
        revealSecs:S.revealSecs||0,
        oneTimeView:$('toggle-otv').checked,
        readBy:{[S.uid]:Date.now()}, delivered:{[S.uid]:Date.now()},
        type:'text', content:enc, visibleTo:S.myVisibleTo,
      };
      if(wrapped) payload.wrapped=wrapped;
      if(S.replyTo) payload.replyTo={id:S.replyTo.id,fromName:S.replyTo.fromName};
      await msgRef.set(payload);
      clearDestruct(); clearReply();
    }
    $('msg-input').value=''; $('msg-input').style.height='auto';
  }catch(e){
    const denied=/permission/i.test((e&&e.message)||'')||(e&&e.code==='PERMISSION_DENIED');
    toast(e&&e.message==='keys not ready'?'Encryption keys still loading — retry in a moment'
      :denied?'Blocked by database rules — publish database.rules.json first':'Send failed','error');
    console.error(e);
  }
  $('btn-send').disabled=false; $('msg-input').focus();
}

// ── Scheduled Delivery — FIXED ─────────────────────────────────────────────
function scheduleDelivery(schedId, data){
  const delay=Math.max(0, data.scheduledFor - Date.now());
  S.schedTimers[schedId]=setTimeout(async()=>{
    try{
      const msgRef=db.ref(`rooms/${S.room}/messages`).push();
      const msgId=msgRef.key;
      // Re-key from the schedule id to the real message id (the emoji table is id-derived).
      const plain=data.content ? await decryptMsg(data,schedId) : '';
      if(!plain||plain==='🔒') throw new Error('scheduled message could not be decrypted');
      // Re-seal for delivery under the message id (legacy entries without
      // wrapped capsules fall back to the room key).
      let enc, wrapped=null;
      if(data.wrapped){
        if(!S.myPriv||!S.pubs[S.uid]) throw new Error('keys not ready');
        const sealed=await Envelope.seal(plain,S.room,msgId,S.myPriv,recipientPubs(data.visibleTo));
        enc=sealed.content; wrapped=sealed.wrapped;
      } else enc=await EmojiCipher.encrypt(plain,S.room,msgId);
      const payload={
        from:data.from, fromName:data.fromName, timestamp:Date.now(),
        expiresAt:data.expiresAt||null, revealSecs:data.revealSecs||0,
        readBy:{[S.uid]:Date.now()}, delivered:{[S.uid]:Date.now()},
        type:'text', content:enc, wasScheduled:true, visibleTo:data.visibleTo||null
      };
      if(wrapped) payload.wrapped=wrapped;
      await msgRef.set(payload);
      await db.ref(`rooms/${S.room}/scheduled/${schedId}`).remove();
      delete S.schedTimers[schedId];
      toast('⏰ Scheduled message delivered!','success');
    }catch(e){console.error('Schedule delivery failed',e);}
  }, delay);
}

// ── Render Message ─────────────────────────────────────────────────────────
function renderMessage(id, data){
  if(data.expiresAt&&Date.now()>data.expiresAt){db.ref(`rooms/${S.room}/messages/${id}`).remove();return;}
  if(document.getElementById(`msg-${id}`))return;
  const isMine=data.from===S.uid;
  const canSee=canView(data);
  const list=$('messages-list');
  const empty=list.querySelector('.empty-state'); if(empty)empty.remove();
  const wrap=ce('div'); wrap.id=`msg-${id}`; wrap.className=`msg-wrap ${isMine?'mine':'theirs'}`; wrap.dataset.ts=data.timestamp;
  const timerBar=data.expiresAt?`<div class="destruct-bar" style="--dur:${Math.max(0,data.expiresAt-Date.now())}ms"></div>`:'';
  const bg=avatarBg(data.fromName||'?');
  const body=buildMessageBody(id,data,isMine,canSee);
  const pinBtn=S.isOwner?`<button class="btn-pin-msg" ${act('pinMessage',[id])} title="Pin message">📌</button>`:'';
  const replyBtn=`<button class="btn-react btn-reply-msg" ${act('setReplyFrom',[id])} title="Reply">↩</button>`;
  wrap.innerHTML=`
    <div class="ma" style="background:${bg}" title="${esc(data.fromName||'?')}">${avatarLetter(data.fromName||'?')}</div>
    <div class="mc">
      ${!isMine?`<span class="msender">${esc(data.fromName)}</span>`:''}
      <div class="mb">
        ${timerBar}
        ${data.wasScheduled?'<span class="sched-tag-msg">⏰ SCHEDULED</span>':''}
        ${data.oneTimeView&&!isMine?'<span class="otv-badge">👁 ONE-TIME VIEW</span>':''}
        ${data.replyTo?buildReplyQuote(data.replyTo):''}
        ${body}
        <div class="mf">
          <span class="mt">${fmt(data.timestamp)}</span>
          ${data.expiresAt?'<span class="bomb-tag">💣</span>':''}
          ${data.oneTimeView?'<span class="otv-tag">👁</span>':''}
          ${isMine?buildReceipt(data):''}
        </div>
      </div>
      <div class="reactions" id="rx-${esc(id)}"></div>
      <div class="mha">
        ${replyBtn}
        <button class="btn-react" ${act('openRxPicker',[id])}>+</button>
        ${pinBtn}
      </div>
    </div>`;
  let ins=false;
  for(const ex of list.querySelectorAll('.msg-wrap')){if(parseInt(ex.dataset.ts)>data.timestamp){list.insertBefore(wrap,ex);ins=true;break;}}
  if(!ins) list.appendChild(wrap);
  if(S.globalReveal&&canSee&&data.content) autoRevealMessage(id,data);
  if(canSee) markRead(id);   // don't claim to have read what we are not allowed to see
  if(!isMine&&data.oneTimeView) handleOTV(id,data);
  list.scrollTop=list.scrollHeight;
  if(data.expiresAt){
    const bar=wrap.querySelector('.destruct-bar');
    if(bar)requestAnimationFrame(()=>bar.classList.add('running'));
    S.timers[id]=setTimeout(()=>db.ref(`rooms/${S.room}/messages/${id}`).remove(),Math.max(0,data.expiresAt-Date.now()));
  }
  if(data.reactions) updateReactions(id,data);
  // Cache for search and privacy re-renders
  S.msgCache[id]={from:data.from, fromName:data.fromName||'?', content:data.content||null,
    wrapped:data.wrapped||null, visibleTo:data.visibleTo||null, type:data.type, timestamp:data.timestamp, canSee};
}

function buildMessageBody(id,data,isMine,canSee){
  switch(data.type){
    case 'image':    return buildImageMsg(data);
    case 'voice':    return buildVoiceMsg(data);
    case 'poll':     return buildPollMsg(id,data);
    case 'checklist':return buildChecklistMsg(id,data);
    case 'location': return buildLocationMsg(data);
    case 'contact':  return buildContactMsg(data);
    default:         return buildTextMsg(id,data,isMine,canSee);
  }
}

// ── Reply Threading ────────────────────────────────────────────────────────
function buildReplyQuote(replyTo){
  // Resolve the quoted text locally. Storing a plaintext preview in the DB would
  // leak the quoted message to everyone, including users blocked from reading it.
  const q=S.msgCache[replyTo.id];
  const preview=(q&&q.canSee&&q.plainText)?q.plainText.slice(0,80):'[encrypted]';
  const sender=esc(replyTo.fromName||'?');
  const border=`hsl(${hue(String(replyTo.fromName||'x'))},70%,45%)`;
  return `<div class="reply-quote" ${act('scrollToMsg',[replyTo.id])} style="border-left-color:${border}">
    <span class="rq-sender">${sender}</span>
    <span class="rq-preview">${esc(preview)}</span>
  </div>`;
}
function scrollToMsg(id){
  const el=document.getElementById(`msg-${id}`); if(!el)return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  el.classList.add('msg-highlight');
  setTimeout(()=>el.classList.remove('msg-highlight'),1600);
}
function setReplyFrom(msgId){
  const wrap=document.getElementById(`msg-${msgId}`); if(!wrap)return;
  const senderEl=wrap.querySelector('.msender');
  const fromName=senderEl?senderEl.textContent:(wrap.classList.contains('mine')?S.name:'?');
  const mc=wrap.querySelector(`#mc-${msgId}`);
  const preview=mc?.dataset.state==='revealed'?mc.textContent:'[encrypted]';
  setReply(msgId,fromName,preview);
}
function setReply(id,fromName,preview){
  S.replyTo={id,fromName,preview};
  const bar=$('reply-bar'); if(!bar)return;
  $('reply-sender').textContent=fromName;
  $('reply-preview').textContent=(preview||'').slice(0,80);
  bar.classList.remove('hidden');
  $('msg-input').focus();
}
function clearReply(){
  S.replyTo=null;
  const bar=$('reply-bar'); if(bar)bar.classList.add('hidden');
}

// ── Text message ───────────────────────────────────────────────────────────
function buildTextMsg(id,data,isMine,canSee){
  if(!data.content) return '';
  // content is attacker-writable: escape it even though our own ciphertext is only emoji.
  const display=esc(EmojiCipher.shortDisplay(data.content));
  if(!canSee){
    return `<div class="msg-content msg-encrypted-only" title="You don't have permission to read this message">${display}</div>`;
  }
  return `<div class="msg-content" id="mc-${esc(id)}" data-id="${esc(id)}" data-raw="${encodeURIComponent(data.content)}" data-state="encrypted">${display}</div>
  <button class="btn-reveal" ${act('toggleReveal',[id])}>👁 REVEAL</button>`;
}
function buildImageMsg(data){
  const src=safeMedia(data.fileUrl,'image');
  if(!src) return `<div class="msg-content">[blocked attachment]</div>`;
  return `<div class="msg-image-wrap"><img class="msg-img" src="${esc(src)}" alt="${esc(data.fileName||'image')}" loading="lazy" draggable="false" ${act('openLightbox',[src])}>
  ${data.fileName?`<div class="img-caption">${esc(data.fileName)}</div>`:''}</div>`;
}
function buildVoiceMsg(data){
  const src=safeMedia(data.voiceUrl,'audio');
  if(!src) return `<div class="msg-content">[blocked attachment]</div>`;
  const uid='vc-'+Math.random().toString(36).slice(2);
  return `<div class="voice-msg">
    <button class="voice-play" ${act('toggleAudio',[uid])}>▶</button>
    <div class="voice-info">
      <div class="voice-wave">${Array.from({length:20},(_,i)=>`<span style="height:${Math.sin(i*0.7+1)*50+20}%"></span>`).join('')}</div>
      <span class="voice-dur">${fmtSecs(Number(data.duration)||0)}</span>
    </div>
    <audio id="${uid}" src="${esc(src)}" style="display:none"></audio>
  </div>`;
}
function toggleAudio(id){
  const audio=document.getElementById(id); if(!audio)return;
  const btn=audio.closest('.voice-msg')?.querySelector('.voice-play');
  if(audio.paused){audio.play();if(btn)btn.textContent='⏸';audio.onended=()=>{if(btn)btn.textContent='▶';};}
  else{audio.pause();if(btn)btn.textContent='▶';}
}
function buildPollMsg(id,data){
  const totalVotes=Object.values(data.votes||{}).reduce((a,v)=>a+Object.keys(v).length,0);
  const opts=(data.options||[]).map(opt=>{
    const count=Object.keys((data.votes||{})[opt]||{}).length;
    const pct=totalVotes?Math.round(count/totalVotes*100):0;
    const voted=((data.votes||{})[opt]||{})[S.uid];
    return `<div class="poll-opt ${voted?'voted':''}" ${act('votePoll',[id,opt])}>
      <div class="poll-bar" style="width:${pct}%"></div>
      <span class="poll-opt-text">${esc(opt)}</span>
      <span class="poll-pct">${pct}% (${count})</span>
    </div>`;
  }).join('');
  return `<div class="poll-msg"><div class="poll-q">📊 ${esc(data.question)}</div><div class="poll-opts">${opts}</div><div class="poll-total">${totalVotes} vote${totalVotes!==1?'s':''}</div></div>`;
}
async function votePoll(msgId,option){
  const ref=db.ref(`rooms/${S.room}/messages/${msgId}/votes/${option}/${S.uid}`);
  const snap=await ref.once('value'); if(snap.exists())await ref.remove(); else await ref.set(Date.now());
}
function updatePollUI(id,data){if(data.type!=='poll')return;const el=document.querySelector(`#msg-${id} .poll-msg`);if(el){const tmp=ce('div');tmp.innerHTML=buildPollMsg(id,data);el.replaceWith(tmp.firstChild);}}
function buildChecklistMsg(id,data){
  const items=data.items||[]; const done=items.filter(i=>i.checked).length;
  const itemHTML=items.map((item,idx)=>`<div class="check-item ${item.checked?'done':''}"><button class="check-box" ${act('toggleCheckItem',[id,Number(idx)])}>${item.checked?'☑':'☐'}</button><span>${esc(item.text)}</span></div>`).join('');
  return `<div class="checklist-msg"><div class="check-header">☑ ${esc(data.title||'Checklist')} <span class="check-prog">${done}/${items.length}</span></div><div class="check-items">${itemHTML}</div></div>`;
}
function buildLocationMsg(data){
  const lat=Number(data.lat), lng=Number(data.lng);
  if(!isFinite(lat)||!isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)
    return `<div class="msg-content">[invalid location]</div>`;
  const url=`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15`;
  return `<div class="location-msg"><div class="loc-header">📍 LOCATION SHARED</div><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="loc-link"><div class="loc-map-preview">🗺 ${lat.toFixed(4)}, ${lng.toFixed(4)}<br><span>Tap to open map</span></div></a></div>`;
}
function buildContactMsg(data){
  return `<div class="contact-msg">
    <div class="contact-avatar" style="background:${avatarBg(data.contactName||'?')}">${avatarLetter(data.contactName||'?')}</div>
    <div class="contact-info">
      <div class="contact-name">👤 ${esc(data.contactName||'Unknown')}</div>
      ${data.phone?`<div class="contact-detail">📞 <a href="tel:${esc(data.phone)}">${esc(data.phone)}</a></div>`:''}
      ${data.email?`<div class="contact-detail">✉ <a href="mailto:${esc(data.email)}">${esc(data.email)}</a></div>`:''}
    </div>
  </div>`;
}

// ── Decrypt (room key, or per-message envelope key) ────────────────────────
async function decryptMsg(data,id){
  if(!data||!data.content)return '';
  if(data.wrapped&&data.wrapped[S.uid]){
    if(!S.myPriv)return '🔒';
    const senderPub=S.pubs[data.from];
    if(!senderPub)return '🔒';
    try{
      const plain=await Envelope.open(data.content,data.wrapped[S.uid],S.myPriv,senderPub,S.room,id);
      return plain||'🔒';
    }catch{return '🔒';}
  }
  return EmojiCipher.decrypt(data.content,S.room,id);
}

// ── Auto-reveal ────────────────────────────────────────────────────────────
async function autoRevealMessage(id,data){
  if(!data.content)return;
  const el=document.getElementById(`mc-${id}`); if(!el)return;
  const plain=await decryptMsg(data,id);
  if(!plain||plain==='🔒')return;
  el.textContent=plain; el.classList.add('revealed'); el.dataset.state='revealed';
  if(S.msgCache[id]) S.msgCache[id].plainText=plain;
  S.revealed.add(id);
  const btn=el.nextElementSibling; if(btn?.classList.contains('btn-reveal'))btn.textContent='🔒 HIDE';
  const hideMs=data.revealSecs>0?data.revealSecs*1000:EmojiCipher.calcReadTime(plain);
  el.style.setProperty('--reveal-dur',`${hideMs/1000}s`);
  el.classList.add('reveal-timer');
  setTimeout(()=>{
    if(!S.revealed.has(id))return;
    S.revealed.delete(id);
    el.textContent=EmojiCipher.shortDisplay(data.content);
    el.classList.remove('revealed','reveal-timer'); el.dataset.state='encrypted';
    const b=el.nextElementSibling; if(b?.classList.contains('btn-reveal'))b.textContent='👁 REVEAL';
  },hideMs);
}

// ── One-time view ──────────────────────────────────────────────────────────
async function handleOTV(id,data){
  if(data.viewedBy&&data.viewedBy!==S.uid){
    const el=document.getElementById(`mc-${id}`);
    if(el)el.closest('.mb').innerHTML='<div class="msg-private">👁 VIEWED & DESTROYED</div>';
    return;
  }
  if(!data.viewedBy){
    await db.ref(`rooms/${S.room}/messages/${id}/viewedBy`).set(S.uid);
    setTimeout(()=>db.ref(`rooms/${S.room}/messages/${id}`).remove(),3000);
    const el=document.getElementById(`msg-${id}`);
    if(el){const badge=el.querySelector('.otv-badge');if(badge)badge.textContent='👁 SELF-DESTRUCTING IN 3s...';}
  }
}

// ── Toggle Reveal ──────────────────────────────────────────────────────────
async function toggleReveal(id){
  const el=document.getElementById(`mc-${id}`); if(!el)return;
  if(S.revealed.has(id)){
    S.revealed.delete(id);
    const raw=decodeURIComponent(el.dataset.raw||'');
    el.textContent=EmojiCipher.shortDisplay(raw);
    el.classList.remove('revealed','reveal-timer'); el.dataset.state='encrypted';
    const btn=el.nextElementSibling; if(btn?.classList.contains('btn-reveal'))btn.textContent='👁 REVEAL';
  }else{
    el.classList.add('decrypting');
    const raw=decodeURIComponent(el.dataset.raw||'');
    const cached=S.msgCache[id]||{};
    const plain=await decryptMsg({content:raw,wrapped:cached.wrapped,from:cached.from},id);
    el.classList.remove('decrypting');
    if(plain==='🔒'){
      el.classList.remove('revealed'); el.textContent=plain;
      toast('Cannot decrypt: the sender\'s key is not published, or you were not a recipient when this message was sent','error');
      return;
    }
    el.textContent=plain; el.classList.add('revealed'); S.revealed.add(id);
    if(S.msgCache[id]) S.msgCache[id].plainText=plain;
    const btn=el.nextElementSibling; if(btn?.classList.contains('btn-reveal'))btn.textContent='🔒 HIDE';
    const hideMs=EmojiCipher.calcReadTime(plain);
    el.style.setProperty('--reveal-dur',`${hideMs/1000}s`);
    el.classList.add('reveal-timer');
    setTimeout(()=>{
      if(!S.revealed.has(id))return;
      S.revealed.delete(id); el.textContent=EmojiCipher.shortDisplay(raw);
      el.classList.remove('revealed','reveal-timer');
      const b=el.nextElementSibling; if(b?.classList.contains('btn-reveal'))b.textContent='👁 REVEAL';
    },hideMs);
  }
}

// ── Read Receipts ──────────────────────────────────────────────────────────
function buildReceipt(data){
  const others=obj=>Object.entries(obj||{}).filter(([k])=>k!==S.uid);
  const readers=others(data.readBy);
  const deliveries=others(data.delivered);
  const nameOf=uid=>S.roomUsers[uid]?.name||uid.slice(0,8)+'…';
  let icon='<span class="rcpt rcpt-sent">✓</span>';
  if(readers.length>0){
    const tipLines=readers.map(([uid,ts])=>`${nameOf(uid)}: ${fmtFull(ts)}`).join('\n');
    icon=`<span class="rcpt rcpt-read has-tip">✓✓<span class="rcpt-tip">${esc(tipLines).replace(/\n/g,'&#10;')}</span></span>`;
  } else if(deliveries.length>0){
    const tipLines=deliveries.map(([uid,ts])=>`${nameOf(uid)}: delivered ${fmtFull(ts)}`).join('\n');
    icon=`<span class="rcpt rcpt-dlvr has-tip">✓✓<span class="rcpt-tip">${esc(tipLines).replace(/\n/g,'&#10;')}</span></span>`;
  }
  return icon;
}
async function markDelivered(msgId,data){if(data.from===S.uid)return;db.ref(`rooms/${S.room}/messages/${msgId}/delivered/${S.uid}`).set(Date.now()).catch(()=>{});}
async function markRead(msgId){db.ref(`rooms/${S.room}/messages/${msgId}/readBy/${S.uid}`).set(Date.now()).catch(()=>{});}
function updateReceipts(id,data){
  const w=document.getElementById(`msg-${id}`); if(!w||data.from!==S.uid)return;
  const old=w.querySelector('.rcpt'); if(old)old.outerHTML=buildReceipt(data);
}

// ── Reactions ──────────────────────────────────────────────────────────────
const REACTS=['❤️','🔥','😂','😮','👍','🎉','🤯','💯','😢','🚀','⚡','🔐'];
function openRxPicker(msgId,_ev,btn){
  document.querySelectorAll('.rx-picker').forEach(p=>p.remove());
  const p=ce('div'); p.className='rx-picker';
  p.innerHTML=REACTS.map(e=>`<button ${act('doReact closeRxPicker',[msgId,e])}>${e}</button>`).join('');
  const rect=btn.getBoundingClientRect();
  p.style.cssText=`position:fixed;top:${Math.max(10,rect.top-60)}px;left:${Math.min(Math.max(10,rect.left-70),window.innerWidth-220)}px;z-index:9999`;
  document.body.appendChild(p); requestAnimationFrame(()=>p.classList.add('open'));
}
async function doReact(msgId,emoji){
  const ref=db.ref(`rooms/${S.room}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}/${S.uid}`);
  const snap=await ref.once('value'); if(snap.exists())await ref.remove(); else await ref.set(Date.now());
}
function updateReactions(id,data){
  const el=document.getElementById(`rx-${id}`); if(!el)return;
  let html='';
  for(const[e,users]of Object.entries(data.reactions||{})){
    const count=Object.keys(users).length; if(!count)continue;
    const mine=!!users[S.uid];
    html+=`<button class="rx-chip${mine?' mine':''}" ${act('doReact',[id,safeDecode(e)])}>${esc(safeDecode(e))}<span>${count}</span></button>`;
  }
  el.innerHTML=html;
}

// ── Lightbox ───────────────────────────────────────────────────────────────
function openLightbox(url){
  const src=safeMedia(url,'image'); if(!src)return;
  let lb=document.getElementById('lightbox');
  if(!lb){lb=ce('div');lb.id='lightbox';lb.className='lightbox';lb.innerHTML=`<div class="lb-bg" ${act('closeLightbox')}></div><img class="lb-img"><button class="lb-close" ${act('closeLightbox')}>✕</button>`;document.body.appendChild(lb);}
  lb.querySelector('.lb-img').src=src; lb.classList.add('active');
}
function closeLightbox(){const lb=document.getElementById('lightbox');if(lb)lb.classList.remove('active');}
function removeMsgUI(id){
  const el=document.getElementById(`msg-${id}`);
  if(el){el.classList.add('msg-out');setTimeout(()=>el.remove(),300);}
  if(S.timers[id]){clearTimeout(S.timers[id]);delete S.timers[id];}
  S.revealed.delete(id); delete S.msgCache[id];
}

// ── Message Pinning ────────────────────────────────────────────────────────
async function pinMessage(msgId,e){
  e.stopPropagation();
  if(!S.isOwner){toast('Only owner can pin','error');return;}
  if(S.pinnedMsgId===msgId){await db.ref(`rooms/${S.room}/pinned`).remove();toast('Message unpinned','info');return;}
  const msgEl=document.getElementById(`msg-${msgId}`);
  const fromName=msgEl?.querySelector('.msender')?.textContent||S.name;
  // msgId + sender only. The preview is rendered client-side from each viewer's own cache.
  await db.ref(`rooms/${S.room}/pinned`).set({msgId,fromName,pinnedAt:Date.now(),pinnedBy:S.name});
  toast('📌 Message pinned','success');
}
function renderPinnedBar(data){
  S.pinnedMsgId=data.msgId;
  const bar=$('pinned-bar'); if(!bar)return;
  const c=S.msgCache[data.msgId];
  let preview='[encrypted]';
  if(c&&c.canSee){
    if(c.plainText) preview=c.plainText.slice(0,70);
    else if(c.type==='image') preview='[IMAGE]';
    else if(c.type==='voice') preview='[VOICE NOTE]';
    else if(c.type==='poll') preview='[POLL]';
  }
  $('pinned-sender').textContent=data.fromName||'?';
  $('pinned-preview').textContent=preview;
  bar.classList.remove('hidden');
}
function clearPinnedBar(){S.pinnedMsgId=null;const bar=$('pinned-bar');if(bar)bar.classList.add('hidden');}
async function unpinFromBar(){
  if(!S.isOwner){toast('Only owner can unpin','error');return;}
  await db.ref(`rooms/${S.room}/pinned`).remove();toast('Unpinned','info');
}
function scrollToPinned(){if(S.pinnedMsgId)scrollToMsg(S.pinnedMsgId);}

// ── Cipher Visualizer ──────────────────────────────────────────────────────
function initCipherVisualizer(){
  const ov=ce('div'); ov.id='cipher-viz'; ov.className='cipher-viz hidden';
  ov.innerHTML=`<div class="cv-inner"><div class="cv-label">ENCRYPTING</div><div class="cv-text" id="cv-text"></div><div class="cv-bar"><div id="cv-progress"></div></div></div>`;
  document.body.appendChild(ov);
}
async function showCipherVisualizer(plainText){
  const ov=$('cipher-viz'); if(!ov)return;
  const display=$('cv-text'); if(!display)return;
  ov.classList.remove('hidden');
  const chars=[...plainText];
  const EMOJIS=['🔐','🛡','⚡','🔒','💫','🌀','✨','🎯','🔑','💎'];
  const steps=Math.min(chars.length,18);
  const prog=$('cv-progress');
  for(let i=0;i<steps;i++){
    const mixed=chars.map((c,j)=>{
      const ratio=j/(chars.length||1),phase=i/steps;
      if(ratio<phase) return EMOJIS[Math.floor(Math.random()*EMOJIS.length)];
      return c;
    }).join('');
    display.textContent=mixed.slice(0,40)+(mixed.length>40?'…':'');
    if(prog) prog.style.width=`${Math.round((i+1)/steps*100)}%`;
    await new Promise(r=>setTimeout(r,28));
  }
  display.textContent='🔐'.repeat(Math.min(10,chars.length));
  await new Promise(r=>setTimeout(r,120));
  ov.classList.add('hidden');
}

// ── Message Search ────────────────────────────────────────────────────────
function initSearch(){
  const overlay=$('search-overlay'); if(!overlay)return;
  $('search-input').addEventListener('input',debounce(runSearch,200));
  $('search-input').addEventListener('keydown',e=>{if(e.key==='Escape')closeSearch();});
}
function openSearch(){
  S.searchOpen=true;
  const ov=$('search-overlay'); if(!ov)return;
  ov.classList.remove('hidden'); ov.classList.add('search-open-anim');
  $('search-input').value='';
  $('search-results').innerHTML='<div class="sr-hint">Type to decrypt and search messages…</div>';
  setTimeout(()=>$('search-input').focus(),100);
}
function closeSearch(){
  S.searchOpen=false;
  const ov=$('search-overlay'); if(!ov)return;
  ov.classList.add('hidden'); ov.classList.remove('search-open-anim');
  document.querySelectorAll('.msg-wrap.search-match').forEach(el=>el.classList.remove('search-match'));
}
const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
async function runSearch(){
  const q=$('search-input').value.trim().toLowerCase();
  const res=$('search-results');
  if(!q){res.innerHTML='<div class="sr-hint">Type to decrypt and search messages…</div>';return;}
  res.innerHTML='<div class="sr-hint">🔓 Decrypting…</div>';
  const results=[];
  for(const id of Object.keys(S.msgCache)){
    const cached=S.msgCache[id];
    if(!cached||!cached.canSee)continue;
    let plain=cached.plainText||null;
    if(!plain&&cached.content){
      plain=await decryptMsg(cached,id);
      if(plain&&plain!=='🔒') cached.plainText=plain;
    }
    if(!plain)continue;
    if(plain.toLowerCase().includes(q)) results.push({id,fromName:cached.fromName,plain,timestamp:cached.timestamp});
  }
  document.querySelectorAll('.msg-wrap.search-match').forEach(el=>el.classList.remove('search-match'));
  if(!results.length){res.innerHTML='<div class="sr-hint">No matches found</div>';return;}
  results.sort((a,b)=>b.timestamp-a.timestamp);
  res.innerHTML='';
  results.forEach(r=>{
    const div=ce('div'); div.className='sr-item';
    // highlightEsc escapes every segment — decrypted plaintext is attacker-controlled.
    div.innerHTML=`<span class="sr-sender">${esc(r.fromName)}</span><span class="sr-time">${fmt(r.timestamp)}</span><div class="sr-text">${highlightEsc(r.plain.slice(0,120),q)}</div>`;
    div.addEventListener('click',()=>{closeSearch();scrollToMsg(r.id);document.getElementById(`msg-${r.id}`)?.classList.add('search-match');});
    res.appendChild(div);
  });
}

// ── Encrypted backup (export / restore) ───────────────────────────────────
// The readable history is exported as one file encrypted with a passphrase:
// PBKDF2-SHA256 (600k) → AES-256-GCM. Nothing about the passphrase is stored.
const historyRows=list=>list.map(m=>`<tr><td>${fmt(m.time)}</td><td>${esc(m.from)}</td><td>${esc(m.text||'—')}</td></tr>`).join('');
function historyHtml(title,note,rows){
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>body{font-family:monospace;background:#000;color:#00ff41;padding:20px;}table{width:100%;border-collapse:collapse;}th{background:#001400;color:#00ff41;padding:8px;text-align:left;border-bottom:2px solid #00ff41;}td{padding:8px;border-bottom:1px solid #002200;vertical-align:top;}</style></head><body><h1>🔐 ${esc(title)}</h1><p style="color:#555">${esc(note)}</p><table><thead><tr><th>TIME</th><th>FROM</th><th>MESSAGE</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
async function collectHistory(){
  const snap=await db.ref(`rooms/${S.room}/messages`).orderByChild('timestamp').once('value');
  const msgs=[]; snap.forEach(c=>{const d=c.val();if(d)msgs.push({id:c.key,...d});});
  const out=[];
  for(const m of msgs){
    if(!canView(m)) continue;
    let text='';
    if(m.content) text=await decryptMsg(m,m.id);
    else if(m.type==='image') text=`[IMAGE: ${m.fileName||'image'}]`;
    else if(m.type==='voice') text='[VOICE NOTE]';
    else if(m.type==='poll')  text=`[POLL: ${m.question}]`;
    else if(m.type==='location') text=`[LOCATION: ${m.lat?.toFixed(4)},${m.lng?.toFixed(4)}]`;
    else if(m.type==='contact')  text=`[CONTACT: ${m.contactName} ${m.phone||''}]`;
    out.push({time:m.timestamp,from:m.fromName||'?',type:m.type||'text',text});
  }
  return out;
}
function openBackup(){
  $('backup-pass').value='';
  const st=$('backup-status'); st.textContent=''; st.style.color='';
  $('backup-modal').classList.remove('hidden');
}
function closeBackup(){ $('backup-modal').classList.add('hidden'); }
async function backupExport(){
  if(!S.canDownload){toast('No download permission','error');return;}
  const pass=$('backup-pass').value, st=$('backup-status');
  if(pass.length<8){toast('Passphrase must be at least 8 characters','error');return;}
  st.textContent='Encrypting history…'; st.style.color='var(--tx2)';
  try{
    const rows=await collectHistory();
    const payload=JSON.stringify({v:1,app:'VoidChat',room:S.room,exportedAt:Date.now(),messages:rows});
    const data=await Envelope.backupSeal(payload,pass);
    const file=JSON.stringify({v:1,alg:'PBKDF2-SHA256-600k|AES-256-GCM',data});
    const a=ce('a'); a.href=URL.createObjectURL(new Blob([file],{type:'application/json'}));
    a.download=`voidchat-${S.room}.vcbackup`; a.click();
    st.textContent=`✓ Encrypted backup downloaded (${rows.length} messages)`;
    st.style.color='#00ff41';
  }catch(e){console.error(e);st.textContent='✕ Backup failed';st.style.color='#ff2244';}
}
async function backupImport(){
  const picker=$('backup-file'), file=picker.files&&picker.files[0];
  if(!file)return;
  picker.value='';
  const pass=$('backup-pass').value, st=$('backup-status');
  if(pass.length<8){toast('Enter the backup passphrase first','error');return;}
  st.textContent='Decrypting…'; st.style.color='var(--tx2)';
  // Open the tab now: after the awaits the click gesture is gone and popup
  // blockers would reject window.open.
  const outWin=window.open('','_blank');
  try{
    const wrap=JSON.parse(await file.text());
    if(!wrap||!wrap.data)throw new Error('not a VoidChat backup');
    const data=JSON.parse(await Envelope.backupOpen(wrap.data,pass));
    const html=historyHtml(`VOIDCHAT BACKUP — ${data.room||''}`,`Exported: ${new Date(data.exportedAt||0).toLocaleString()}`,historyRows(data.messages||[]));
    const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
    if(outWin) outWin.location=url;
    else{const a=ce('a');a.href=url;a.download=`voidchat-backup-${data.room||'room'}.html`;a.click();}
    st.textContent='✓ Backup opened in a new tab'; st.style.color='#00ff41';
  }catch(e){console.error(e);if(outWin)outWin.close();st.textContent='✕ Wrong passphrase or corrupted file';st.style.color='#ff2244';}
}

// ── Download ───────────────────────────────────────────────────────────────
async function downloadChat(){
  if(!S.canDownload){toast('No download permission','error');return;}
  toast('Preparing…','info');
  const html=historyHtml(`VOIDCHAT — ${S.room}`,`Downloaded: ${new Date().toLocaleString()}`,historyRows(await collectHistory()));
  const a=ce('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'})); a.download=`voidchat-${S.room}.html`; a.click();
  toast('Downloaded!','success');
}

// ── Voice Call (WebRTC) ────────────────────────────────────────────────────
// Connection lifecycle is explicit: ringing → connecting → connected, with a
// bounded wait at every step. 'disconnected' is usually a transient network
// flap, so it gets a grace period; 'failed' triggers one ICE restart from the
// caller before the call is torn down with a visible reason — instead of the
// panel hanging on "Calling…" forever with the microphone still hot.
const CALL_RING_MS=35000, CALL_CONNECT_MS=20000, CALL_RECONNECT_MS=8000;

function callTimer(name,ms,fn){
  clearCallTimer(name);
  S.callTimers[name]=setTimeout(()=>{ delete S.callTimers[name]; fn(); },ms);
}
function clearCallTimer(name){
  if(S.callTimers[name]){ clearTimeout(S.callTimers[name]); delete S.callTimers[name]; }
}
function clearCallTimers(){ Object.values(S.callTimers).forEach(clearTimeout); S.callTimers={}; }
function setCallStatus(text,kind){
  const el=$('call-status'); if(!el)return;
  el.textContent=text;
  el.classList.toggle('call-warn',kind==='warn');
  el.classList.toggle('call-error',kind==='error');
}
function micErrorMessage(e){
  switch(e&&e.name){
    case 'NotAllowedError': case 'SecurityError':
      return 'Microphone permission denied — allow the mic and try again';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'No microphone found on this device';
    case 'NotReadableError': case 'TrackStartError':
      return 'Microphone is in use by another app';
    case 'OverconstrainedError':
      return 'This microphone cannot provide audio';
    default:
      return 'Microphone unavailable: '+((e&&e.message)||'unknown error');
  }
}
function openMic(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)
    return Promise.reject(new Error('Voice calls need HTTPS (or localhost)'));
  return navigator.mediaDevices.getUserMedia({audio:true,video:false});
}
function createPeer(role){
  const pc=new RTCPeerConnection(RTC_CONFIG);
  S.peerRole=role;
  pc.ontrack=e=>{
    let a=document.getElementById('remote-audio');
    if(!a){a=ce('audio');a.id='remote-audio';a.autoplay=true;document.body.appendChild(a);}
    a.srcObject=e.streams[0];
  };
  pc.onicecandidate=e=>{
    if(!e.candidate||!S.callId)return;
    db.ref(`rooms/${S.room}/candidates/${S.callId}/${role}`).push(e.candidate.toJSON())
      .catch(err=>console.warn('ICE candidate send failed',err));
  };
  pc.onicecandidateerror=e=>console.warn('ICE candidate error',e.errorCode,e.url,e.errorText);
  pc.oniceconnectionstatechange=()=>onIceState(pc);
  pc.onconnectionstatechange=()=>{
    if(pc!==S.peerConn)return;
    if(pc.connectionState==='failed')failCall('Connection failed');
  };
  return pc;
}
// Candidates that arrive before setRemoteDescription cannot be added yet —
// they are queued and flushed, never dropped (a dropped candidate pair is one
// of the ways ICE ends up in the 'failed' state).
function queueRemoteCandidate(cand){
  const pc=S.peerConn; if(!pc||!S.callId||!cand)return;
  if(!pc.remoteDescription||!pc.remoteDescription.type){ S.pendingCandidates.push(cand); return; }
  pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e=>console.warn('ICE candidate rejected',e));
}
async function flushRemoteCandidates(){
  const pc=S.peerConn; if(!pc||!pc.remoteDescription)return;
  const queued=S.pendingCandidates; S.pendingCandidates=[];
  for(const cand of queued){
    try{ await pc.addIceCandidate(new RTCIceCandidate(cand)); }
    catch(e){ console.warn('ICE candidate rejected',e); }
  }
}
function listenCandidates(remoteRole,callId){
  const ref=db.ref(`rooms/${S.room}/candidates/${callId}/${remoteRole}`);
  const onCand=snap=>{ const c=snap.val(); if(c)queueRemoteCandidate(c); };
  ref.on('child_added',onCand);
  S.offCandidates=()=>ref.off('child_added',onCand);
  S.listeners.push(S.offCandidates);
}
function onIceState(pc){
  if(pc!==S.peerConn||!S.inCall)return;
  const st=pc.iceConnectionState;
  if(st==='connected'||st==='completed'){
    clearCallTimers();
    setCallStatus(S.peerName?`In call with ${S.peerName}`:'In call');
    return;
  }
  if(st==='disconnected'){
    setCallStatus('Reconnecting…','warn');
    callTimer('reconnect',CALL_RECONNECT_MS,()=>{
      if(S.peerConn!==pc||!S.inCall)return;
      const now=pc.iceConnectionState;
      if(now!=='connected'&&now!=='completed')
        failCall(now==='failed'?'Connection failed':'Connection lost');
    });
    return;
  }
  if(st==='failed'){
    if(S.peerRole==='caller'&&!S.iceRestarted){ restartIce(); return; }
    failCall('Connection failed');
  }
}
async function restartIce(){
  const pc=S.peerConn; if(!pc||!S.inCall)return;
  S.iceRestarted=true;
  setCallStatus('Reconnecting…','warn');
  toast('Connection lost — retrying…','info');
  try{
    const offer=await pc.createOffer({iceRestart:true});
    await pc.setLocalDescription(offer);
    await db.ref(`rooms/${S.room}/call`).update({status:'renegotiate',offer:{type:offer.type,sdp:offer.sdp}});
    callTimer('connect',CALL_CONNECT_MS,()=>failCall('Connection failed'));
  }catch(e){
    console.error('ICE restart failed',e);
    failCall('Connection failed');
  }
}
function failCall(reason){
  if(!S.inCall)return;
  console.warn('call failed:',reason);
  S.inCall=false;   // stop further ICE events from re-entering the failure path
  endCall(true,reason);
}
async function startCall(){
  if(S.inCall)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    toast('Voice calls need HTTPS (or localhost)','error'); return;
  }
  let stream;
  try{ stream=await openMic(); }
  catch(e){ console.error(e); toast(micErrorMessage(e),'error'); return; }
  S.localStream=stream;
  try{
    S.callId=genCode(); S.peerName=null; S.iceRestarted=false; S.pendingCandidates=[];
    S.peerConn=createPeer('caller');
    stream.getTracks().forEach(t=>S.peerConn.addTrack(t,stream));
    listenCandidates('callee',S.callId);
    const offer=await S.peerConn.createOffer();
    await S.peerConn.setLocalDescription(offer);
    await db.ref(`rooms/${S.room}/call`).set({callId:S.callId,caller:S.uid,callerName:S.name,offer:{type:offer.type,sdp:offer.sdp},status:'calling'});
    S.inCall=true;
    $('call-panel').classList.remove('hidden'); setCallStatus('Calling…');
    toast('📞 Calling…','info');
    callTimer('ring',CALL_RING_MS,()=>{
      if(S.inCall&&S.peerConn&&!S.peerConn.remoteDescription)failCall('No answer');
    });
  }catch(e){
    console.error('startCall failed',e);
    releaseCall();
    toast('Call failed: '+(e.message||'unknown error'),'error');
  }
}
async function handleCallSignal(data){
  if(!data||data.caller===S.uid)return;
  if(data.caller&&!S.roomUsers[data.caller])return;   // ignore signalling from non-members
  if(data.status==='calling'&&!S.inCall){
    $('incoming-call-from').textContent=data.callerName||'Unknown';
    $('incoming-call-panel').classList.remove('hidden');
    S.callId=data.callId; S.peerName=data.callerName||'Unknown';
    callTimer('incoming',CALL_RING_MS,()=>{
      $('incoming-call-panel').classList.add('hidden');
      S.callId=null; S.peerName=null;
      toast('📞 Missed call','info');
    });
  }
  if(data.status==='answered'&&S.inCall&&data.answer&&S.peerConn&&S.peerRole==='caller'){
    clearCallTimer('ring'); clearCallTimer('incoming');
    try{
      await S.peerConn.setRemoteDescription(new RTCSessionDescription(data.answer));
      await flushRemoteCandidates();
      if(data.calleeName)S.peerName=data.calleeName;
      setCallStatus(`Connecting to ${S.peerName||'user'}…`);
      callTimer('connect',CALL_CONNECT_MS,()=>failCall('Connection timed out'));
    }catch(e){
      console.error('answer apply failed',e);
      failCall('Connection failed');
    }
  }
  // Someone else answered: stop ringing for every other member in the room.
  if(data.status==='answered'&&!S.inCall){
    clearCallTimer('incoming');
    $('incoming-call-panel').classList.add('hidden');
    S.callId=null; S.peerName=null;
  }
  // Caller restarted ICE: take the fresh offer and reply with a new answer.
  if(data.status==='renegotiate'&&S.inCall&&S.peerRole==='callee'&&S.peerConn&&data.offer){
    try{
      await S.peerConn.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushRemoteCandidates();
      const answer=await S.peerConn.createAnswer();
      await S.peerConn.setLocalDescription(answer);
      await db.ref(`rooms/${S.room}/call`).update({status:'answered',answer:{type:answer.type,sdp:answer.sdp}});
      setCallStatus('Reconnecting…','warn');
      callTimer('connect',CALL_CONNECT_MS,()=>failCall('Connection timed out'));
    }catch(e){
      console.error('renegotiation failed',e);
      failCall('Connection failed');
    }
  }
  if(data.status==='ended'){
    clearCallTimer('incoming');
    if(S.inCall) endCall(false);
    else{
      $('incoming-call-panel').classList.add('hidden');
      S.callId=null; S.peerName=null;
    }
  }
}
async function answerCall(){
  $('incoming-call-panel').classList.add('hidden');
  clearCallTimer('incoming');
  if(S.inCall)return;
  let callData;
  try{ callData=(await db.ref(`rooms/${S.room}/call`).once('value')).val(); }
  catch(e){ console.error(e); toast('Call is no longer available','error'); return; }
  if(!callData||callData.status!=='calling'||!callData.offer||callData.caller===S.uid){
    toast('Call is no longer available','error');
    S.callId=null; return;
  }
  let stream;
  try{ stream=await openMic(); }
  catch(e){ console.error(e); toast(micErrorMessage(e),'error'); return; }
  S.localStream=stream;
  try{
    S.callId=callData.callId; S.iceRestarted=false; S.pendingCandidates=[];
    S.peerConn=createPeer('callee');
    stream.getTracks().forEach(t=>S.peerConn.addTrack(t,stream));
    listenCandidates('caller',S.callId);
    await S.peerConn.setRemoteDescription(new RTCSessionDescription(callData.offer));
    await flushRemoteCandidates();
    const answer=await S.peerConn.createAnswer();
    await S.peerConn.setLocalDescription(answer);
    await db.ref(`rooms/${S.room}/call`).update({status:'answered',callee:S.uid,calleeName:S.name,answer:{type:answer.type,sdp:answer.sdp}});
    S.inCall=true;
    $('call-panel').classList.remove('hidden');
    setCallStatus(`Connecting to ${S.peerName||'caller'}…`);
    callTimer('connect',CALL_CONNECT_MS,()=>failCall('Connection timed out'));
  }catch(e){
    console.error('answerCall failed',e);
    releaseCall();
    toast('Call failed: '+(e.message||'unknown error'),'error');
  }
}
function rejectCall(){
  $('incoming-call-panel').classList.add('hidden');
  clearCallTimer('incoming');
  S.callId=null; S.peerName=null;
  endCall(true);   // tells the caller the call is over
}
function releaseCall(){
  clearCallTimers();
  if(S.offCandidates){ try{S.offCandidates();}catch(e){} S.offCandidates=null; }
  if(S.peerConn){
    S.peerConn.onicecandidate=null; S.peerConn.ontrack=null;
    S.peerConn.oniceconnectionstatechange=null; S.peerConn.onconnectionstatechange=null;
    try{S.peerConn.close();}catch(e){}
    S.peerConn=null;
  }
  if(S.localStream){ S.localStream.getTracks().forEach(t=>{try{t.stop();}catch(e){}}); S.localStream=null; }
  S.inCall=false; S.callId=null; S.peerRole=null; S.peerName=null;
  S.iceRestarted=false; S.pendingCandidates=[];
  $('call-panel')?.classList.add('hidden');
  $('incoming-call-panel')?.classList.add('hidden');
  const ra=document.getElementById('remote-audio'); if(ra){ra.srcObject=null;ra.remove();}
  const callBtn=$('btn-voice-call');
  if(callBtn){
    const others=Object.entries(S.roomUsers||{}).filter(([uid,u])=>uid!==S.uid&&u&&u.online).length;
    callBtn.classList.toggle('hidden',others===0);
  }
}
async function endCall(notify=true,reason=null){
  const wasActive=S.inCall||!!S.peerConn;
  releaseCall();   // free the mic, audio element and panel immediately
  if(reason) toast(reason,'error');
  else if(wasActive) toast('Call ended','info');
  if(notify&&S.room){
    try{ await db.ref(`rooms/${S.room}/call`).set({status:'ended'}); }
    catch(e){ console.warn('call end signal failed',e); }
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function toggleSidebar(){S.sidebarOpen=!S.sidebarOpen;$('sidebar').classList.toggle('open',S.sidebarOpen);$('sb-overlay').classList.toggle('active',S.sidebarOpen);}
function closeSidebar(){S.sidebarOpen=false;$('sidebar').classList.remove('open');$('sb-overlay').classList.remove('active');}
async function leaveRoom(){
  if(!S.room)return;
  cleanup(); await db.ref(`rooms/${S.room}/users/${S.uid}/online`).set(false);
  clearSess(); S.room=null; S.isOwner=false; $('messages-list').innerHTML=''; showScreen('screen-landing'); toast('Disconnected','info');
}
async function closeRoom(auto=false){
  if(!S.isOwner||!S.room)return;
  if(!auto&&!confirm('Close room and delete all messages?'))return;
  const room=S.room;   // S.room is nulled below; the timeout must not read it later
  await db.ref(`rooms/${room}/closed`).set(true);
  await db.ref(`rooms/${room}/messages`).remove();
  await db.ref(`rooms/${room}/scheduled`).remove();
  await db.ref(`rooms/${room}/pinned`).remove();
  setTimeout(()=>db.ref(`rooms/${room}`).remove(),2000);
  cleanup(); clearSess(); S.room=null; $('messages-list').innerHTML=''; showScreen('screen-landing');
  if(!auto)toast('Room purged','info');
}
function forceLeave(msg){cleanup();clearSess();S.room=null;$('messages-list').innerHTML='';showScreen('screen-landing');toast(msg||'Room closed','info');}
function cleanup(){
  releaseCall();
  S.listeners.forEach(o=>o()); S.listeners=[];
  Object.values(S.timers).forEach(clearTimeout); S.timers={};
  Object.values(S.schedTimers).forEach(clearTimeout); S.schedTimers={};
  if(S.sessInterval){clearInterval(S.sessInterval);S.sessInterval=null;}
  S.revealed.clear(); S.msgCache={}; S.roomUsers={}; S.pubs={}; S.myPriv=null; S.trust={}; S.keyModalUid=null; S.sendTimes=[]; S.pinnedMsgId=null; S.replyTo=null;
  $('key-modal')?.classList.add('hidden'); $('key-alarm')?.classList.add('hidden'); $('backup-modal')?.classList.add('hidden');
  stopWatermark(); curtainOff();
}

// ── SCREEN PROTECTION ─────────────────────────────────────────────────────
// No web API can block an OS-level screenshot (Print Screen, Win+Shift+S,
// Cmd+Shift+3/4, phone buttons): capture happens below the browser sandbox.
// These layers are deterrence and best-effort detection instead:
//   1. privacy curtain   — re-hide ALL plaintext the moment focus is lost
//   2. capture warning   — tell the user why the screen went dark
//   3. forensic watermark — every frame carries the viewer's identity
//   4. copy locks        — context menu / selection / drag of chat content
const chatActive = () => !!$('screen-chat') && $('screen-chat').classList.contains('active');

function hideAllRevealed(){
  for(const id of [...S.revealed]){
    const el=document.getElementById(`mc-${id}`);
    if(el){
      const raw=decodeURIComponent(el.dataset.raw||'');
      el.textContent=EmojiCipher.shortDisplay(raw);
      el.classList.remove('revealed','reveal-timer');
      el.dataset.state='encrypted';
      const b=el.nextElementSibling; if(b&&b.classList.contains('btn-reveal'))b.textContent='👁 REVEAL';
    }
    S.revealed.delete(id);
  }
}
function buildWatermark(){
  if(!S.wmOn){stopWatermark();return;}
  const el=$('watermark-layer'); if(!el||!S.room)return;
  // Attribution only — the room code is deliberately NOT included: a screenshot
  // must not hand the room code to whoever sees the image.
  const idt=`VoidChat · ${S.name||'?'} · ${String(S.uid||'').slice(0,8)}`;
  el.textContent='';
  const cols=Math.ceil(window.innerWidth/300)+2, rows=Math.ceil(window.innerHeight/96)+2;
  const frag=document.createDocumentFragment();
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const s=ce('span'); s.className='wm-cell';
    s.style.left=(c*300-120)+'px'; s.style.top=(r*96-70)+'px';
    s.textContent=idt; frag.appendChild(s);
  }
  el.appendChild(frag); el.classList.add('on');
}
function stopWatermark(){ $('watermark-layer')?.classList.remove('on'); }
function toggleWatermark(el){
  S.wmOn=!!el.checked;
  try{localStorage.setItem('vc_wm',S.wmOn?'1':'0');}catch(e){}
  if(S.wmOn&&chatActive()&&S.room)buildWatermark(); else stopWatermark();
  toast(S.wmOn?'Identity watermark on':'Identity watermark off','info');
}
function curtainOn(){
  if(!chatActive()||S.curtainOn)return;
  S.curtainOn=true;
  hideAllRevealed();
  const c=$('privacy-curtain');
  if(c){ const i=$('pc-id'); if(i)i.textContent=`${S.name||''} · ${String(S.uid||'').slice(0,8)} · ${S.room||''}`; c.classList.add('on'); }
  const now=Date.now();
  if(!S.curtainToastAt||now-S.curtainToastAt>5000){ S.curtainToastAt=now; toast('⚠ Privacy curtain engaged — messages hidden'); }
}
function curtainOff(){ if(!S.curtainOn)return; S.curtainOn=false; $('privacy-curtain')?.classList.remove('on'); }
// Best-effort screenshot deterrence. The OS captures the framebuffer below the
// browser, so nothing here can guarantee a block — it races the grab by hiding
// every revealed message the instant a capture shortcut is seen.
function captureBlocked(){
  if(!chatActive())return;
  hideAllRevealed();
  curtainOn();
  const sub=document.querySelector('#privacy-curtain .pc-sub');
  const prev=sub?sub.textContent:'';
  if(sub)sub.textContent='Screenshot attempt detected — content hidden';
  clearTimeout(S.captureTimer);
  S.captureTimer=setTimeout(()=>{
    if(sub)sub.textContent=prev;
    if(document.hasFocus())curtainOff();
  },1500);
  toast('⚠ Screenshot attempt detected — messages hidden','error');
}
function initScreenProtection(){
  document.addEventListener('visibilitychange',()=>{ document.visibilityState==='hidden'?curtainOn():curtainOff(); });
  window.addEventListener('blur',curtainOn);
  window.addEventListener('focus',curtainOff);
  // PrintScreen (Windows/Linux) and Cmd+Shift+3/4/5 (macOS). Android fires no
  // event for a hardware screenshot, so only the focus curtain covers that.
  document.addEventListener('keydown',e=>{
    if(!chatActive())return;
    const k=(e.key||'').toLowerCase();
    const printKey=e.code==='PrintScreen'||k==='printscreen'||k==='snapshot';
    const macShot=e.metaKey&&e.shiftKey&&['3','4','5'].includes(k);
    if(printKey||macShot){ e.preventDefault(); captureBlocked(); }
  });
  document.addEventListener('contextmenu',e=>{ if(chatActive()&&!e.target.closest('input,textarea'))e.preventDefault(); });
  document.addEventListener('copy',e=>{
    if(!chatActive())return;
    const sel=window.getSelection(); const n=sel?sel.anchorNode:null;
    const node=n&&n.nodeType===3?n.parentNode:n;
    if(node&&node.closest&&node.closest('#messages-list,#search-results,#lightbox')){ e.preventDefault(); toast('Copying disabled in secure view','info'); }
  });
  document.addEventListener('dragstart',e=>{ if(chatActive()&&e.target.closest('#messages-list,#lightbox'))e.preventDefault(); });
  let wmRT=null;
  window.addEventListener('resize',()=>{ if(!chatActive()||!S.room)return; clearTimeout(wmRT); wmRT=setTimeout(buildWatermark,300); });
}

// ── Chat init ──────────────────────────────────────────────────────────────
function initChat(){
  $('btn-copy-code').addEventListener('click',()=>copyText(S.room));
  $('btn-hamburger').addEventListener('click',toggleSidebar);
  $('sb-overlay').addEventListener('click',closeSidebar);
  $('btn-leave').addEventListener('click',leaveRoom);
  $('btn-close-room').addEventListener('click',()=>closeRoom(false));
  $('btn-schedule').addEventListener('click',e=>{e.stopPropagation();toggleSchedulePanel();});
  $('btn-destruct').addEventListener('click',e=>{e.stopPropagation();toggleDestructPanel();});
  $('btn-apply-schedule').addEventListener('click',applySchedule);
  $('btn-apply-destruct').addEventListener('click',applyDestruct);
  $('btn-apply-reveal').addEventListener('click',applyRevealTimer);
  $('btn-permissions').addEventListener('click',()=>{$('owner-perm-panel').classList.toggle('hidden');$('my-privacy-panel').classList.add('hidden');});
  $('btn-my-privacy').addEventListener('click',()=>{$('my-privacy-panel').classList.toggle('hidden');$('owner-perm-panel').classList.add('hidden');});
  $('btn-download-chat').addEventListener('click',downloadChat);
  $('btn-voice-call').addEventListener('click',startCall);
  $('btn-end-call').addEventListener('click',()=>endCall(true));
  $('btn-answer-call').addEventListener('click',answerCall);
  $('btn-reject-call').addEventListener('click',rejectCall);
  $('btn-search').addEventListener('click',openSearch);
  $('btn-close-search').addEventListener('click',closeSearch);
  $('btn-reply-clear').addEventListener('click',clearReply);
  $('pinned-bar').addEventListener('click',scrollToPinned);
  $('btn-unpin').addEventListener('click',e=>{e.stopPropagation();unpinFromBar();});
  $('toggle-reveal').addEventListener('change',e=>{
    S.globalReveal=e.target.checked;
    if(S.globalReveal) document.querySelectorAll('.msg-content:not(.revealed)').forEach(el=>{
      const id=el.dataset.id,raw=decodeURIComponent(el.dataset.raw||'');
      if(id&&raw){const cached=S.msgCache[id]||{};decryptMsg({content:raw,wrapped:cached.wrapped,from:cached.from},id).then(p=>{
        if(p&&p!=='🔒'){
          el.textContent=p; el.classList.add('revealed'); S.revealed.add(id);
          if(S.msgCache[id]) S.msgCache[id].plainText=p;
          const btn=el.nextElementSibling; if(btn?.classList.contains('btn-reveal'))btn.textContent='🔒 HIDE';
        }
      });}
    });
  });
  $('btn-send').addEventListener('click',handleSend);
  $('msg-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}});
  $('btn-cancel-poll').addEventListener('click',()=>$('poll-builder').classList.add('hidden'));
  $('btn-cancel-check').addEventListener('click',()=>$('check-builder').classList.add('hidden'));
  $('btn-cancel-contact').addEventListener('click',()=>$('contact-builder').classList.add('hidden'));
  $('btn-send-poll').addEventListener('click',sendPoll);
  $('btn-add-poll-opt').addEventListener('click',addPollOption);
  $('btn-send-check').addEventListener('click',sendChecklist);
  $('btn-add-check-item').addEventListener('click',addCheckItem);
  $('btn-send-contact').addEventListener('click',sendContact);
  document.addEventListener('click',e=>{
    if(!e.target.closest('.rx-picker')&&!e.target.closest('.btn-react'))document.querySelectorAll('.rx-picker').forEach(p=>p.remove());
    if(!e.target.closest('#attach-menu')&&!e.target.closest('#btn-attach'))$('attach-menu')?.classList.add('hidden');
    if(!e.target.closest('#emoji-picker-wrap')&&!e.target.closest('#btn-emoji')){$('emoji-picker-wrap')?.classList.add('hidden');$('btn-emoji')?.classList.remove('btn-active');}
    if(!e.target.closest('#schedule-panel')&&!e.target.closest('#btn-schedule'))$('schedule-panel')?.classList.add('hidden');
    if(!e.target.closest('#destruct-panel')&&!e.target.closest('#btn-destruct'))$('destruct-panel')?.classList.add('hidden');
  });
}
