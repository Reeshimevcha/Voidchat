/**
 * VoidChat v5 — Fixed: voice notes (base64), full emoji display,
 * no-read shows encrypted emojis, auto-hide by text length,
 * group access control, removed broken file upload
 */

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const RTC_CONFIG = {
  iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]
};

const S = {
  uid: localStorage.getItem('vc_uid') || crypto.randomUUID(),
  name:null,room:null,type:null,isOwner:false,
  canRead:false,canDownload:false,myVisibleTo:null,
  roomExpires:null,listeners:[],timers:{},schedTimers:{},
  sessInterval:null,revealed:new Set(),globalReveal:false,
  schedTime:null,destructSecs:0,revealSecs:0,sidebarOpen:false,
  recorder:null,recordingChunks:[],isRecording:false,recordTimer:null,
  peerConn:null,localStream:null,callId:null,inCall:false,
  emojiPickerOpen:false,pollOptions:['',''],checkItems:[''],
};
localStorage.setItem('vc_uid',S.uid);

const $=id=>document.getElementById(id);
const ce=t=>document.createElement(t);
const fmt=ts=>new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const fmtDT=ts=>new Date(ts).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtSz=b=>b<1024?`${b}B`:b<1048576?`${(b/1024).toFixed(1)}KB`:`${(b/1048576).toFixed(1)}MB`;
const fmtDur=ms=>{const s=Math.floor(ms/1000),m=Math.floor(s/60);if(m>0)return`${m}m ${s%60}s`;return`${s}s`;};
const fmtSecs=s=>s<60?`${s}s`:s<3600?`${Math.floor(s/60)}m ${s%60}s`:`${Math.floor(s/3600)}h`;
const hue=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;};
const genCode=()=>{const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join('');};
const avatarBg=name=>`hsl(${hue(name)},70%,45%)`;
const avatarLetter=name=>(name||'?').charAt(0).toUpperCase();

function toast(msg,type='info'){
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t=ce('div');t.className=`toast toast-${type}`;
  t.innerHTML=`<span class="ti">${{success:'✓',error:'✗',info:'i'}[type]||'i'}</span><span>${msg}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},3000);
}
function copyText(text){navigator.clipboard.writeText(text).then(()=>toast('Copied!','success'));}
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));const s=$(id);if(s)s.classList.add('active');}

document.addEventListener('DOMContentLoaded',async()=>{
  initLanding();initChat();initEmojiPicker();initAttachMenu();initVoiceNote();
  await tryRestore();
});

async function tryRestore(){
  const sv=JSON.parse(localStorage.getItem('vc_sess')||'null');if(!sv)return;
  try{
    const snap=await db.ref(`rooms/${sv.room}`).once('value');
    if(!snap.exists()||snap.val().closed){clearSess();return;}
    const r=snap.val();if(r.expiresAt&&Date.now()>r.expiresAt){clearSess();return;}
    S.name=sv.name;S.room=sv.room;S.type=sv.type;S.isOwner=sv.isOwner;
    S.canRead=sv.canRead||S.isOwner;S.roomExpires=r.expiresAt||null;
    await db.ref(`rooms/${S.room}/users/${S.uid}`).update({online:true,name:S.name});
    db.ref(`rooms/${S.room}/users/${S.uid}/online`).onDisconnect().set(false);
    enterChat();toast('Session restored','success');
  }catch(e){clearSess();}
}
function saveSess(){localStorage.setItem('vc_sess',JSON.stringify({name:S.name,room:S.room,type:S.type,isOwner:S.isOwner,canRead:S.canRead}));}
function clearSess(){localStorage.removeItem('vc_sess');}

// ── Landing ───────────────────────────────────────────────────────────────
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
  const name=$('username-create').value.trim();
  if(!name){toast('Enter codename','error');return;}
  const tc=document.querySelector('.type-card.selected');
  const type=tc?tc.dataset.type:'duo';
  const maxUsers=type==='group'?($('max-unlimited').checked?0:parseInt($('max-users-val').value)||0):2;
  const sessMin=parseInt($('session-duration').value)||0;
  S.name=name;S.isOwner=true;S.type=type;S.room=genCode();S.canRead=true;
  const expiresAt=sessMin>0?Date.now()+sessMin*60*1000:null;S.roomExpires=expiresAt;
  await db.ref(`rooms/${S.room}`).set({type,maxUsers,owner:S.uid,created:Date.now(),expiresAt,closed:false});
  await db.ref(`rooms/${S.room}/users/${S.uid}`).set({name,online:true,joinedAt:Date.now(),canRead:true,canDownload:true,myVisibleTo:null});
  db.ref(`rooms/${S.room}/users/${S.uid}/online`).onDisconnect().set(false);
  saveSess();enterChat();
}
async function handleJoin(){
  const name=$('username-join').value.trim();
  const code=$('room-code-join').value.trim().toUpperCase();
  if(!name){toast('Enter codename','error');return;}
  if(code.length!==6){toast('Room code must be 6 chars','error');return;}
  const snap=await db.ref(`rooms/${code}`).once('value');
  if(!snap.exists()){toast('Room not found','error');return;}
  const r=snap.val();
  if(r.closed){toast('Room is closed','error');return;}
  if(r.expiresAt&&Date.now()>r.expiresAt){toast('Room expired','error');return;}
  if(r.maxUsers>0){
    const us=await db.ref(`rooms/${code}/users`).once('value');
    if(Object.values(us.val()||{}).filter(u=>u.online).length>=r.maxUsers){toast('Room full','error');return;}
  }
  S.name=name;S.isOwner=false;S.room=code;S.type=r.type;S.canRead=false;S.roomExpires=r.expiresAt||null;
  await db.ref(`rooms/${code}/users/${S.uid}`).set({name,online:true,joinedAt:Date.now(),canRead:false,canDownload:false,myVisibleTo:null});
  db.ref(`rooms/${code}/users/${S.uid}/online`).onDisconnect().set(false);
  saveSess();enterChat();
}

// ── Enter Chat ─────────────────────────────────────────────────────────────
function enterChat(){
  showScreen('screen-chat');
  $('chat-room-code').textContent=S.room;
  $('sb-room-code').textContent=S.room;
  $('room-type-badge').textContent=S.type==='duo'?'⚡ DUO':'◈ GROUP';
  $('btn-close-room').classList.toggle('hidden',!S.isOwner);
  $('btn-permissions').classList.toggle('hidden',!S.isOwner);
  // Hide access control in DUO (only useful for groups)
  if(S.type==='duo')$('btn-permissions').classList.add('hidden');
  listenRoom();
  if(S.roomExpires)startSessTimer();
}

function listenRoom(){
  const root=db.ref(`rooms/${S.room}`);
  const uRef=root.child('users');
  const uL=uRef.on('value',snap=>{
    const users=snap.val()||{};
    renderUsers(users);
    const me=users[S.uid];
    if(me){
      const was=S.canRead;S.canRead=!!me.canRead||S.isOwner;S.canDownload=!!me.canDownload||S.isOwner;
      S.myVisibleTo=me.myVisibleTo||null;
      if(!was&&S.canRead){toast('✅ Read access granted!','success');revealAllVisible();}
      $('btn-download-chat').classList.toggle('hidden',!S.canDownload);
    }
    if(S.isOwner&&S.type==='group')renderOwnerPerms(users);
    renderMyPrivacy(users);
  });
  const mRef=root.child('messages');
  const mAdd=mRef.orderByChild('timestamp').on('child_added',snap=>{const d=snap.val();if(!d)return;renderMessage(snap.key,d);markDelivered(snap.key,d);});
  const mChg=mRef.on('child_changed',snap=>{const d=snap.val();if(!d)return;updateReceipts(snap.key,d);updateReactions(snap.key,d);updatePollUI(snap.key,d);});
  const mDel=mRef.on('child_removed',snap=>removeMsgUI(snap.key));
  const sRef=root.child('scheduled');
  const sAdd=sRef.on('child_added',snap=>{const d=snap.val();if(!d||d.from!==S.uid)return;scheduleDelivery(snap.key,d);});
  root.child('closed').on('value',snap=>{if(snap.val()===true&&!S.isOwner)forceLeave('Room was closed');});
  root.child('call').on('value',snap=>{const d=snap.val();if(d)handleCallSignal(d);});
  S.listeners=[()=>uRef.off('value',uL),()=>mRef.off('child_added',mAdd),()=>mRef.off('child_changed',mChg),()=>mRef.off('child_removed',mDel),()=>sRef.off('child_added',sAdd)];
}

function revealAllVisible(){
  document.querySelectorAll('.msg-content:not(.revealed)').forEach(el=>{
    const id=el.dataset.id,raw=decodeURIComponent(el.dataset.raw||'');
    if(id&&raw){EmojiCipher.decrypt(raw,S.room,id).then(p=>{if(p&&p!=='🔒'){el.textContent=p;el.classList.add('revealed');S.revealed.add(id);const btn=el.nextElementSibling;if(btn?.classList.contains('btn-reveal'))btn.textContent='🔒 HIDE';}});}
  });
}

// ── Session Timer ──────────────────────────────────────────────────────────
function startSessTimer(){
  if(S.sessInterval)clearInterval(S.sessInterval);
  $('session-timer-wrap').classList.remove('hidden');
  const tick=async()=>{
    const rem=S.roomExpires-Date.now();
    if(rem<=0){clearInterval(S.sessInterval);if(S.isOwner)await closeRoom(true);else forceLeave('Session expired');return;}
    $('session-countdown').textContent=fmtDur(rem);
    $('session-timer-wrap').classList.toggle('expiring',rem<300000);
  };
  tick();S.sessInterval=setInterval(tick,1000);
}

// ── Users ──────────────────────────────────────────────────────────────────
function renderUsers(users){
  const list=$('users-list');list.innerHTML='';
  let online=0;
  for(const[uid,u]of Object.entries(users)){
    if(!u)continue;if(u.online)online++;
    const li=ce('li');li.className=`user-item ${u.online?'online':'offline'}`;
    const bg=avatarBg(u.name||'?');
    const isOwner=u.canRead&&u.canDownload; // owner has both
    li.innerHTML=`<div class="ua" style="background:${bg}">${avatarLetter(u.name||'?')}</div>
    <div class="um"><span class="un">${u.name||'?'}${uid===S.uid?' <span class="you-tag">YOU</span>':''}${uid===S.uid&&S.isOwner?' 👑':''}</span>
    <span class="us">${u.online?'● ONLINE':'○ OFFLINE'} · ${u.canRead?'🔓':'🔒'}</span></div>`;
    list.appendChild(li);
  }
  $('online-count').textContent=online;
  const othersOnline=Object.entries(users).filter(([uid,u])=>uid!==S.uid&&u?.online).length;
  $('btn-voice-call').classList.toggle('hidden',othersOnline===0||S.inCall);
}

// ── Permissions (Owner → Group only) ──────────────────────────────────────
function renderOwnerPerms(users){
  const p=$('owner-perm-list');if(!p)return;p.innerHTML='';
  let has=false;
  for(const[uid,u]of Object.entries(users)){
    if(!u||uid===S.uid)continue;has=true;
    const row=ce('div');row.className='perm-row';
    const bg=avatarBg(u.name||'?');
    row.innerHTML=`
      <div class="pa" style="background:${bg}">${avatarLetter(u.name||'?')}</div>
      <div class="pm">
        <span class="pn">${u.name||'?'}</span>
        <span class="ps ${u.online?'online':'offline'}">${u.online?'● ONLINE':'○ OFFLINE'}</span>
      </div>
      <div class="pt">
        <div class="ptr">
          <span class="ptl">Read</span>
          <label class="toggle-switch"><input type="checkbox" ${u.canRead?'checked':''} onchange="setPerm('${uid}','canRead',this.checked)"><span class="tt"></span></label>
        </div>
        <div class="ptr">
          <span class="ptl">Download</span>
          <label class="toggle-switch"><input type="checkbox" ${u.canDownload?'checked':''} onchange="setPerm('${uid}','canDownload',this.checked)"><span class="tt"></span></label>
        </div>
      </div>`;
    p.appendChild(row);
  }
  if(!has)p.innerHTML='<div class="perm-empty">Waiting for members…</div>';
}
async function setPerm(uid,field,val){
  await db.ref(`rooms/${S.room}/users/${uid}/${field}`).set(val);
  toast(`${field==='canRead'?'Read':'Download'} ${val?'granted':'revoked'}`,'success');
}

function renderMyPrivacy(users){
  const p=$('my-privacy-list');if(!p)return;p.innerHTML='';
  for(const[uid,u]of Object.entries(users)){
    if(!u||uid===S.uid)continue;
    const allowed=S.myVisibleTo===null||(Array.isArray(S.myVisibleTo)&&S.myVisibleTo.includes(uid));
    const row=ce('div');row.className='perm-row';
    const bg=avatarBg(u.name||'?');
    row.innerHTML=`<div class="pa" style="background:${bg}">${avatarLetter(u.name||'?')}</div>
    <div class="pm"><span class="pn">${u.name||'?'}</span><span class="ps ${u.online?'online':'offline'}">${u.online?'● ONLINE':'○ OFFLINE'}</span></div>
    <label class="toggle-switch"><input type="checkbox" ${allowed?'checked':''} onchange="toggleMyVis('${uid}',this.checked)"><span class="tt"></span></label>`;
    p.appendChild(row);
  }
  if(!p.children.length)p.innerHTML='<div class="perm-empty">No other users yet…</div>';
}
async function toggleMyVis(uid,allow){
  const snap=await db.ref(`rooms/${S.room}/users/${S.uid}/myVisibleTo`).once('value');
  let list=snap.val();
  if(list===null){const us=await db.ref(`rooms/${S.room}/users`).once('value');list=Object.keys(us.val()||{}).filter(k=>k!==S.uid);}
  if(!Array.isArray(list))list=[];
  if(allow){if(!list.includes(uid))list.push(uid);}else{list=list.filter(k=>k!==uid);}
  const us=await db.ref(`rooms/${S.room}/users`).once('value');
  const all=Object.keys(us.val()||{}).filter(k=>k!==S.uid);
  const isAll=all.every(k=>list.includes(k));
  S.myVisibleTo=isAll?null:list;
  await db.ref(`rooms/${S.room}/users/${S.uid}/myVisibleTo`).set(isAll?null:list);
  toast(allow?'Visible to user':'Hidden from user','info');
}

// ── Schedule ───────────────────────────────────────────────────────────────
function toggleSchedulePanel(){
  const p=$('schedule-panel');const o=!p.classList.contains('hidden');
  closeInputPanels();
  if(!o){
    if(!$('sched-dt').value){const n=new Date(Date.now()+3600000);const pad=x=>String(x).padStart(2,'0');$('sched-dt').value=`${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;}
    p.classList.remove('hidden');$('btn-schedule').classList.add('btn-active');
  }
}
function toggleDestructPanel(){
  const p=$('destruct-panel');const o=!p.classList.contains('hidden');
  closeInputPanels();
  if(!o){p.classList.remove('hidden');$('btn-destruct').classList.add('btn-active');}
}
function closeInputPanels(){
  ['schedule-panel','destruct-panel','attach-menu','emoji-picker-wrap'].forEach(id=>{const el=$(id);if(el)el.classList.add('hidden');});
  ['btn-schedule','btn-destruct','btn-attach','btn-emoji'].forEach(id=>{const el=$(id);if(el)el.classList.remove('btn-active');});
}
function applySchedule(){
  const v=$('sched-dt').value;if(!v){toast('Pick date/time','error');return;}
  const ts=new Date(v).getTime();if(ts<=Date.now()){toast('Must be future time','error');return;}
  S.schedTime=ts;$('btn-schedule').classList.add('btn-set');$('btn-schedule').title=`Scheduled: ${fmtDT(ts)}`;
  closeInputPanels();toast(`Scheduled: ${fmtDT(ts)}`,'success');
}
function applyDestruct(){
  const v=parseInt($('destruct-sel').value)||0;S.destructSecs=v;
  $('btn-destruct').classList.toggle('btn-set',v>0);
  closeInputPanels();if(v>0)toast(`Self-destruct: ${fmtSecs(v)}`,'success');
}
function applyRevealTimer(){
  const v=parseInt($('reveal-timer-sel').value)||0;S.revealSecs=v;
  closeInputPanels();if(v>0)toast(`Auto-hide after: ${fmtSecs(v)}`,'success');
}
function clearSchedule(){S.schedTime=null;$('btn-schedule').classList.remove('btn-set');}
function clearDestruct(){S.destructSecs=0;$('btn-destruct').classList.remove('btn-set');}

// ── Attach Menu (no file/image upload — removed broken Storage) ────────────
function initAttachMenu(){
  $('btn-attach').addEventListener('click',e=>{
    e.stopPropagation();
    const open=!$('attach-menu').classList.contains('hidden');
    closeInputPanels();
    if(!open)$('attach-menu').classList.remove('hidden');
  });
  $('attach-poll').addEventListener('click',()=>{openPollBuilder();closeInputPanels();});
  $('attach-checklist').addEventListener('click',()=>{openChecklistBuilder();closeInputPanels();});
  $('attach-location').addEventListener('click',()=>{shareLocation();closeInputPanels();});
  $('attach-contact').addEventListener('click',()=>{openContactForm();closeInputPanels();});
  // Image via base64 (max 2MB)
  $('attach-photo').addEventListener('click',()=>{$('file-input').accept='image/*';$('file-input').click();closeInputPanels();});
  $('file-input').addEventListener('change',handleImageSelect);
}

function handleImageSelect(e){
  const file=e.target.files[0];if(!file)return;
  if(!file.type.startsWith('image/')){toast('Images only','error');return;}
  if(file.size>2*1024*1024){toast('Max 2MB for images','error');return;}
  const reader=new FileReader();
  reader.onload=async()=>{
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'image',fileUrl:reader.result,fileName:file.name,fileSize:file.size,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
    toast('Image sent!','success');
  };
  reader.readAsDataURL(file);
  e.target.value='';
}

// ── Emoji Picker ──────────────────────────────────────────────────────────
const EMOJI_CATS = {
  '😀':['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','🙂','🤗','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','😷','🤒','🤕','🤢','🤧','🥵','🥶','😵','🤯','🤠','🥳','🤓'],
  '👍':['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👋','🤚','🖐','✋','🖖','💪','🤲','👐','🙌','👏','🤝','🙏','✍️','💅','🫶'],
  '❤️':['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','🔥','⭐','🌟','✨','💫','🎉','🎊','🎈','🚀','💯','✅','❌','⚡'],
  '🐶':['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄'],
  '🍎':['🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥕','🌽','🍕','🍔','🍟','🌭','🥪','🌮','🥗','🍜','🍣','🍦','🎂'],
};

function initEmojiPicker(){
  const wrap=$('emoji-picker-wrap');wrap.innerHTML='';
  for(const[cat,emojis]of Object.entries(EMOJI_CATS)){
    const sec=ce('div');sec.className='ep-sec';
    const title=ce('div');title.className='ep-title';title.textContent=cat;
    const grid=ce('div');grid.className='ep-grid';
    emojis.forEach(e=>{const btn=ce('button');btn.className='ep-btn';btn.textContent=e;btn.addEventListener('click',()=>insertEmoji(e));grid.appendChild(btn);});
    sec.appendChild(title);sec.appendChild(grid);wrap.appendChild(sec);
  }
  $('btn-emoji').addEventListener('click',e=>{
    e.stopPropagation();
    const open=!wrap.classList.contains('hidden');
    closeInputPanels();
    if(!open){wrap.classList.remove('hidden');$('btn-emoji').classList.add('btn-active');}
  });
}
function insertEmoji(e){
  const inp=$('msg-input');const start=inp.selectionStart,end=inp.selectionEnd;
  inp.value=inp.value.slice(0,start)+e+inp.value.slice(end);
  inp.selectionStart=inp.selectionEnd=start+e.length;inp.focus();
}

// ── Voice Note (base64 — no Firebase Storage needed) ──────────────────────
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
    S.localStream=stream;S.recordingChunks=[];
    S.recorder=new MediaRecorder(stream);
    S.recorder.ondataavailable=e=>{if(e.data.size>0)S.recordingChunks.push(e.data);};
    S.recorder.start();S.isRecording=true;
    $('btn-voice-note').classList.add('recording');
    $('rec-indicator').classList.remove('hidden');
    let secs=0;
    S.recordTimer=setInterval(()=>{secs++;$('rec-time').textContent=fmtSecs(secs);if(secs>=120)stopRecording();},1000);
  }catch(e){toast('Microphone access denied','error');}
}
async function stopRecording(){
  if(!S.isRecording)return;
  clearInterval(S.recordTimer);S.isRecording=false;
  $('btn-voice-note').classList.remove('recording');
  $('rec-indicator').classList.add('hidden');$('rec-time').textContent='0s';
  S.recorder.stop();
  S.localStream?.getTracks().forEach(t=>t.stop());
  await new Promise(r=>S.recorder.onstop=r);
  const blob=new Blob(S.recordingChunks,{type:'audio/webm'});
  if(blob.size<1000){toast('Too short — hold longer','error');return;}
  if(blob.size>5*1024*1024){toast('Recording too long (max ~60s)','error');return;}
  toast('Sending voice note…','info');
  // Convert to base64 — no Storage needed
  const reader=new FileReader();
  reader.onloadend=async()=>{
    const base64=reader.result;
    const dur=Math.round(blob.size/8000);
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    await msgRef.set({
      from:S.uid,fromName:S.name,timestamp:Date.now(),
      type:'voice',voiceUrl:base64,duration:dur,
      readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},
      visibleTo:S.myVisibleTo
    });
    toast('🎙 Voice note sent!','success');
  };
  reader.readAsDataURL(blob);
}

// ── Poll Builder ───────────────────────────────────────────────────────────
function openPollBuilder(){S.pollOptions=['',''];$('poll-question').value='';renderPollOptions();$('poll-builder').classList.remove('hidden');$('poll-builder').scrollIntoView({behavior:'smooth'});}
function renderPollOptions(){
  const c=$('poll-options-list');c.innerHTML='';
  S.pollOptions.forEach((opt,i)=>{
    const row=ce('div');row.className='builder-row';
    row.innerHTML=`<input class="fi" value="${opt}" placeholder="Option ${i+1}" oninput="S.pollOptions[${i}]=this.value">${S.pollOptions.length>2?`<button class="del-btn" onclick="S.pollOptions.splice(${i},1);renderPollOptions()">✕</button>`:''}`;
    c.appendChild(row);
  });
}
function addPollOption(){if(S.pollOptions.length<8){S.pollOptions.push('');renderPollOptions();}}
async function sendPoll(){
  const q=$('poll-question').value.trim();const opts=S.pollOptions.filter(o=>o.trim());
  if(!q){toast('Enter question','error');return;}if(opts.length<2){toast('Add at least 2 options','error');return;}
  const msgRef=db.ref(`rooms/${S.room}/messages`).push();
  await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'poll',question:q,options:opts,votes:{},readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
  $('poll-builder').classList.add('hidden');toast('Poll sent!','success');
}

// ── Checklist Builder ──────────────────────────────────────────────────────
function openChecklistBuilder(){S.checkItems=[''];$('check-title').value='';renderCheckItems();$('check-builder').classList.remove('hidden');$('check-builder').scrollIntoView({behavior:'smooth'});}
function renderCheckItems(){
  const c=$('check-items-list');c.innerHTML='';
  S.checkItems.forEach((item,i)=>{
    const row=ce('div');row.className='builder-row';
    row.innerHTML=`<input class="fi" value="${item}" placeholder="Item ${i+1}" oninput="S.checkItems[${i}]=this.value">${S.checkItems.length>1?`<button class="del-btn" onclick="S.checkItems.splice(${i},1);renderCheckItems()">✕</button>`:''}`;
    c.appendChild(row);
  });
}
function addCheckItem(){S.checkItems.push('');renderCheckItems();}
async function sendChecklist(){
  const title=$('check-title').value.trim();const items=S.checkItems.filter(i=>i.trim()).map(t=>({text:t,checked:false}));
  if(!items.length){toast('Add at least one item','error');return;}
  const msgRef=db.ref(`rooms/${S.room}/messages`).push();
  await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'checklist',title:title||'Checklist',items,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
  $('check-builder').classList.add('hidden');toast('Checklist sent!','success');
}
async function toggleCheckItem(msgId,index){
  const snap=await db.ref(`rooms/${S.room}/messages/${msgId}/items/${index}/checked`).once('value');
  await db.ref(`rooms/${S.room}/messages/${msgId}/items/${index}/checked`).set(!snap.val());
}

// ── Location ───────────────────────────────────────────────────────────────
function shareLocation(){
  if(!navigator.geolocation){toast('Geolocation not supported','error');return;}
  toast('Getting location…','info');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const{latitude:lat,longitude:lng}=pos.coords;
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'location',lat,lng,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
    toast('Location shared!','success');
  },()=>toast('Could not get location','error'));
}

// ── Contact Form ───────────────────────────────────────────────────────────
function openContactForm(){$('contact-builder').classList.remove('hidden');$('contact-builder').scrollIntoView({behavior:'smooth'});}
async function sendContact(){
  const name=$('contact-name').value.trim();const phone=$('contact-phone').value.trim();const email=$('contact-email').value.trim();
  if(!name&&!phone){toast('Enter name or phone','error');return;}
  const msgRef=db.ref(`rooms/${S.room}/messages`).push();
  await msgRef.set({from:S.uid,fromName:S.name,timestamp:Date.now(),type:'contact',contactName:name,phone,email,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},visibleTo:S.myVisibleTo});
  $('contact-builder').classList.add('hidden');
  $('contact-name').value='';$('contact-phone').value='';$('contact-email').value='';
  toast('Contact shared!','success');
}

// ── Send Message ───────────────────────────────────────────────────────────
async function handleSend(){
  const text=$('msg-input').value.trim();
  if(!text)return;
  closeInputPanels();$('btn-send').disabled=true;
  try{
    if(S.schedTime){
      const schedRef=db.ref(`rooms/${S.room}/scheduled`).push();
      const enc=await EmojiCipher.encrypt(text,S.room,schedRef.key);
      await schedRef.set({from:S.uid,fromName:S.name,timestamp:S.schedTime,scheduledFor:S.schedTime,sent:false,content:enc,type:'text',expiresAt:S.destructSecs>0?S.schedTime+S.destructSecs*1000:null,revealSecs:S.revealSecs,visibleTo:S.myVisibleTo});
      toast(`Scheduled: ${fmtDT(S.schedTime)}`,'success');
      clearSchedule();clearDestruct();
    }else{
      const msgRef=db.ref(`rooms/${S.room}/messages`).push();
      const msgId=msgRef.key;
      const enc=await EmojiCipher.encrypt(text,S.room,msgId);
      let data={from:S.uid,fromName:S.name,timestamp:Date.now(),expiresAt:S.destructSecs>0?Date.now()+S.destructSecs*1000:null,revealSecs:S.revealSecs||0,oneTimeView:$('toggle-otv').checked,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},type:'text',content:enc,visibleTo:S.myVisibleTo};
      if(data.oneTimeView)data.viewedBy=null;
      await msgRef.set(data);
      clearDestruct();
    }
    $('msg-input').value='';$('msg-input').style.height='auto';
  }catch(e){toast('Send failed','error');console.error(e);}
  $('btn-send').disabled=false;$('msg-input').focus();
}

// ── Scheduled Delivery ─────────────────────────────────────────────────────
function scheduleDelivery(schedId,data){
  const delay=Math.max(0,data.scheduledFor-Date.now());
  S.schedTimers[schedId]=setTimeout(async()=>{
    const msgRef=db.ref(`rooms/${S.room}/messages`).push();
    const msgId=msgRef.key;
    let content=data.content;
    if(content){const plain=await EmojiCipher.decrypt(content,S.room,schedId);content=await EmojiCipher.encrypt(plain,S.room,msgId);}
    await msgRef.set({from:data.from,fromName:data.fromName,timestamp:Date.now(),expiresAt:data.expiresAt,revealSecs:data.revealSecs||0,readBy:{[S.uid]:Date.now()},delivered:{[S.uid]:Date.now()},type:data.type||'text',content,wasScheduled:true,visibleTo:data.visibleTo||null});
    await db.ref(`rooms/${S.room}/scheduled/${schedId}`).remove();
    delete S.schedTimers[schedId];
    toast('⏰ Scheduled message delivered!','success');
  },delay);
}

// ── Render Message ─────────────────────────────────────────────────────────
function renderMessage(id,data){
  if(data.expiresAt&&Date.now()>data.expiresAt){db.ref(`rooms/${S.room}/messages/${id}`).remove();return;}
  if(document.getElementById(`msg-${id}`))return;
  const isMine=data.from===S.uid;
  const canSee=isMine||canView(data);
  const list=$('messages-list');
  const empty=list.querySelector('.empty-state');if(empty)empty.remove();
  const wrap=ce('div');wrap.id=`msg-${id}`;wrap.className=`msg-wrap ${isMine?'mine':'theirs'}`;wrap.dataset.ts=data.timestamp;
  const timerBar=data.expiresAt?`<div class="destruct-bar" style="--dur:${Math.max(0,data.expiresAt-Date.now())}ms"></div>`:'';
  const bg=avatarBg(data.fromName||'?');
  const body=buildMessageBody(id,data,isMine,canSee);
  wrap.innerHTML=`
    <div class="ma" style="background:${bg}" title="${data.fromName||'?'}">${avatarLetter(data.fromName||'?')}</div>
    <div class="mc">
      ${!isMine?`<span class="msender">${data.fromName}</span>`:''}
      <div class="mb">
        ${timerBar}
        ${data.wasScheduled?'<span class="sched-tag-msg">⏰ SCHEDULED</span>':''}
        ${data.oneTimeView&&!isMine?'<span class="otv-badge">👁 ONE-TIME VIEW</span>':''}
        ${body}
        <div class="mf">
          <span class="mt">${fmt(data.timestamp)}</span>
          ${data.expiresAt?'<span class="bomb-tag">💣</span>':''}
          ${data.oneTimeView?'<span class="otv-tag">👁</span>':''}
          ${isMine?buildReceipt(data):''}
        </div>
      </div>
      <div class="reactions" id="rx-${id}"></div>
      <div class="mha"><button class="btn-react" onclick="openRxPicker('${id}',this)">+</button></div>
    </div>`;
  let ins=false;
  for(const ex of list.querySelectorAll('.msg-wrap')){if(parseInt(ex.dataset.ts)>data.timestamp){list.insertBefore(wrap,ex);ins=true;break;}}
  if(!ins)list.appendChild(wrap);

  if((isMine||canSee)&&data.content)autoRevealMessage(id,data);
  markRead(id);
  if(!isMine&&data.oneTimeView)handleOTV(id,data);
  list.scrollTop=list.scrollHeight;
  if(data.expiresAt){
    const bar=wrap.querySelector('.destruct-bar');
    if(bar)requestAnimationFrame(()=>bar.classList.add('running'));
    S.timers[id]=setTimeout(()=>db.ref(`rooms/${S.room}/messages/${id}`).remove(),Math.max(0,data.expiresAt-Date.now()));
  }
  if(data.reactions)updateReactions(id,data);
}

function buildMessageBody(id,data,isMine,canSee){
  switch(data.type){
    case 'image':   return buildImageMsg(id,data);
    case 'voice':   return buildVoiceMsg(data);
    case 'poll':    return buildPollMsg(id,data);
    case 'checklist':return buildChecklistMsg(id,data);
    case 'location':return buildLocationMsg(data);
    case 'contact': return buildContactMsg(data);
    default:        return buildTextMsg(id,data,isMine,canSee);
  }
}

// ── Text message: show encrypted emojis when no access ────────────────────
function buildTextMsg(id,data,isMine,canSee){
  if(!data.content)return'';
  // Check message-level visibility (sender chose to hide from this user)
  if(!isMine&&data.visibleTo&&!data.visibleTo.includes(S.uid)){
    return'<div class="msg-content msg-encrypted-only">🔒 PRIVATE</div>';
  }
  // No read permission — show encrypted emojis (can't decrypt)
  if(!isMine&&!S.canRead){
    return`<div class="msg-content msg-encrypted-only" title="Grant read access to decrypt">${EmojiCipher.shortDisplay(data.content)}</div>`;
  }
  // Has access — show encrypted with reveal button
  const display=EmojiCipher.shortDisplay(data.content);
  return`<div class="msg-content" id="mc-${id}" data-id="${id}" data-raw="${encodeURIComponent(data.content)}" data-state="encrypted">${display}</div>
  <button class="btn-reveal" onclick="toggleReveal('${id}')">👁 REVEAL</button>`;
}

function buildImageMsg(id,data){
  return`<div class="msg-image-wrap"><img class="msg-img" src="${data.fileUrl}" alt="${data.fileName||'image'}" loading="lazy" onclick="openLightbox('${data.fileUrl}')" onerror="this.style.display='none'">
  ${data.fileName?`<div class="img-caption">${data.fileName}</div>`:''}
  </div>`;
}

function buildVoiceMsg(data){
  const uid='vc-'+Math.random().toString(36).slice(2);
  return`<div class="voice-msg">
    <button class="voice-play" onclick="toggleAudio('${uid}')">▶</button>
    <div class="voice-info">
      <div class="voice-wave">${Array.from({length:20},(_,i)=>`<span style="height:${Math.sin(i*0.7+1)*50+20}%"></span>`).join('')}</div>
      <span class="voice-dur">${fmtSecs(data.duration||0)}</span>
    </div>
    <audio id="${uid}" src="${data.voiceUrl}" style="display:none"></audio>
  </div>`;
}
function toggleAudio(id){
  const audio=document.getElementById(id);if(!audio)return;
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
    return`<div class="poll-opt ${voted?'voted':''}" onclick="votePoll('${id}','${opt}')">
      <div class="poll-bar" style="width:${pct}%"></div>
      <span class="poll-opt-text">${opt}</span>
      <span class="poll-pct">${pct}% (${count})</span>
    </div>`;
  }).join('');
  return`<div class="poll-msg"><div class="poll-q">📊 ${data.question}</div><div class="poll-opts">${opts}</div><div class="poll-total">${totalVotes} vote${totalVotes!==1?'s':''}</div></div>`;
}
async function votePoll(msgId,option){
  const ref=db.ref(`rooms/${S.room}/messages/${msgId}/votes/${option}/${S.uid}`);
  const snap=await ref.once('value');if(snap.exists())await ref.remove();else await ref.set(Date.now());
}
function updatePollUI(id,data){if(data.type!=='poll')return;const el=document.querySelector(`#msg-${id} .poll-msg`);if(el)el.outerHTML=buildPollMsg(id,data);}

function buildChecklistMsg(id,data){
  const items=data.items||[];const done=items.filter(i=>i.checked).length;
  const itemHTML=items.map((item,idx)=>`<div class="check-item ${item.checked?'done':''}"><button class="check-box" onclick="toggleCheckItem('${id}',${idx})">${item.checked?'☑':'☐'}</button><span>${item.text}</span></div>`).join('');
  return`<div class="checklist-msg"><div class="check-header">☑ ${data.title||'Checklist'} <span class="check-prog">${done}/${items.length}</span></div><div class="check-items">${itemHTML}</div></div>`;
}

function buildLocationMsg(data){
  const url=`https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lng}&zoom=15`;
  return`<div class="location-msg"><div class="loc-header">📍 LOCATION SHARED</div><a href="${url}" target="_blank" class="loc-link"><div class="loc-map-preview">🗺 ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}<br><span>Tap to open map</span></div></a></div>`;
}

function buildContactMsg(data){
  return`<div class="contact-msg">
    <div class="contact-avatar" style="background:${avatarBg(data.contactName||'?')}">${avatarLetter(data.contactName||'?')}</div>
    <div class="contact-info">
      <div class="contact-name">👤 ${data.contactName||'Unknown'}</div>
      ${data.phone?`<div class="contact-detail">📞 <a href="tel:${data.phone}">${data.phone}</a></div>`:''}
      ${data.email?`<div class="contact-detail">✉ <a href="mailto:${data.email}">${data.email}</a></div>`:''}
    </div>
  </div>`;
}

// ── Auto reveal + auto-hide by text length ─────────────────────────────────
async function autoRevealMessage(id,data){
  if(!data.content)return;
  const el=document.getElementById(`mc-${id}`);if(!el)return;
  const plain=await EmojiCipher.decrypt(data.content,S.room,id);
  if(!plain||plain==='🔒')return;
  el.textContent=plain;el.classList.add('revealed');el.dataset.state='revealed';
  S.revealed.add(id);
  const btn=el.nextElementSibling;if(btn?.classList.contains('btn-reveal'))btn.textContent='🔒 HIDE';

  // Determine hide delay: manual revealSecs > 0 overrides; otherwise use text length
  const hideMs=data.revealSecs>0 ? data.revealSecs*1000 : EmojiCipher.calcReadTime(plain);
  el.style.setProperty('--reveal-dur',`${hideMs/1000}s`);
  el.classList.add('reveal-timer');

  setTimeout(()=>{
    if(!S.revealed.has(id))return; // already hidden manually
    S.revealed.delete(id);
    el.textContent=EmojiCipher.shortDisplay(data.content);
    el.classList.remove('revealed','reveal-timer');
    el.dataset.state='encrypted';
    const b=el.nextElementSibling;if(b?.classList.contains('btn-reveal'))b.textContent='👁 REVEAL';
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
  const el=document.getElementById(`mc-${id}`);if(!el)return;
  if(S.revealed.has(id)){
    S.revealed.delete(id);
    const raw=decodeURIComponent(el.dataset.raw||'');
    el.textContent=EmojiCipher.shortDisplay(raw);
    el.classList.remove('revealed','reveal-timer');el.dataset.state='encrypted';
    const btn=el.nextElementSibling;if(btn?.classList.contains('btn-reveal'))btn.textContent='👁 REVEAL';
  }else{
    el.classList.add('decrypting');
    const raw=decodeURIComponent(el.dataset.raw||'');
    const plain=await EmojiCipher.decrypt(raw,S.room,id);
    el.classList.remove('decrypting');
    el.textContent=plain;el.classList.add('revealed');S.revealed.add(id);
    const btn=el.nextElementSibling;if(btn?.classList.contains('btn-reveal'))btn.textContent='🔒 HIDE';
    // Auto-hide by text length
    const hideMs=EmojiCipher.calcReadTime(plain);
    el.style.setProperty('--reveal-dur',`${hideMs/1000}s`);
    el.classList.add('reveal-timer');
    setTimeout(()=>{
      if(!S.revealed.has(id))return;
      S.revealed.delete(id);el.textContent=EmojiCipher.shortDisplay(raw);
      el.classList.remove('revealed','reveal-timer');
      const b=el.nextElementSibling;if(b?.classList.contains('btn-reveal'))b.textContent='👁 REVEAL';
    },hideMs);
  }
}

function canView(data){
  if(data.visibleTo&&!data.visibleTo.includes(S.uid))return false;
  return S.canRead;
}

// ── Receipts ───────────────────────────────────────────────────────────────
function buildReceipt(data){
  const oth=u=>Object.keys(u||{}).filter(k=>k!==S.uid).length;
  const r=oth(data.readBy),d=oth(data.delivered);
  if(r>0)return`<span class="rcpt rcpt-read">✓✓</span>`;
  if(d>0)return`<span class="rcpt rcpt-dlvr">✓✓</span>`;
  return`<span class="rcpt rcpt-sent">✓</span>`;
}
async function markDelivered(msgId,data){if(data.from===S.uid)return;db.ref(`rooms/${S.room}/messages/${msgId}/delivered/${S.uid}`).set(Date.now()).catch(()=>{});}
async function markRead(msgId){db.ref(`rooms/${S.room}/messages/${msgId}/readBy/${S.uid}`).set(Date.now()).catch(()=>{});}
function updateReceipts(id,data){const w=document.getElementById(`msg-${id}`);if(!w||data.from!==S.uid)return;const old=w.querySelector('.rcpt');if(old)old.outerHTML=buildReceipt(data);}

// ── Reactions ──────────────────────────────────────────────────────────────
const REACTS=['❤️','🔥','😂','😮','👍','🎉','🤯','💯','😢','🚀','⚡','🔐'];
function openRxPicker(msgId,btn){
  document.querySelectorAll('.rx-picker').forEach(p=>p.remove());
  const p=ce('div');p.className='rx-picker';
  p.innerHTML=REACTS.map(e=>`<button onclick="doReact('${msgId}','${e}');this.closest('.rx-picker').remove()">${e}</button>`).join('');
  const rect=btn.getBoundingClientRect();
  p.style.cssText=`position:fixed;top:${Math.max(10,rect.top-60)}px;left:${Math.min(Math.max(10,rect.left-70),window.innerWidth-220)}px;z-index:9999`;
  document.body.appendChild(p);requestAnimationFrame(()=>p.classList.add('open'));
}
async function doReact(msgId,emoji){
  const ref=db.ref(`rooms/${S.room}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}/${S.uid}`);
  const snap=await ref.once('value');if(snap.exists())await ref.remove();else await ref.set(Date.now());
}
function updateReactions(id,data){
  const el=document.getElementById(`rx-${id}`);if(!el)return;
  let html='';
  for(const[e,users]of Object.entries(data.reactions||{})){
    const count=Object.keys(users).length;if(!count)continue;
    const mine=!!users[S.uid];
    html+=`<button class="rx-chip${mine?' mine':''}" onclick="doReact('${id}','${decodeURIComponent(e)}')">${decodeURIComponent(e)}<span>${count}</span></button>`;
  }
  el.innerHTML=html;
}

// ── Lightbox ───────────────────────────────────────────────────────────────
function openLightbox(url){
  let lb=document.getElementById('lightbox');
  if(!lb){lb=ce('div');lb.id='lightbox';lb.className='lightbox';lb.innerHTML=`<div class="lb-bg" onclick="closeLightbox()"></div><img class="lb-img"><button class="lb-close" onclick="closeLightbox()">✕</button>`;document.body.appendChild(lb);}
  lb.querySelector('.lb-img').src=url;lb.classList.add('active');
}
function closeLightbox(){const lb=document.getElementById('lightbox');if(lb)lb.classList.remove('active');}

function removeMsgUI(id){
  const el=document.getElementById(`msg-${id}`);
  if(el){el.classList.add('msg-out');setTimeout(()=>el.remove(),300);}
  if(S.timers[id]){clearTimeout(S.timers[id]);delete S.timers[id];}
  S.revealed.delete(id);
}

// ── Download ───────────────────────────────────────────────────────────────
async function downloadChat(){
  if(!S.canDownload){toast('No permission','error');return;}
  toast('Preparing…','info');
  const snap=await db.ref(`rooms/${S.room}/messages`).orderByChild('timestamp').once('value');
  const msgs=[];snap.forEach(c=>{const d=c.val();if(d)msgs.push({id:c.key,...d});});
  let rows='';
  for(const m of msgs){
    let text='';
    if(m.content)text=await EmojiCipher.decrypt(m.content,S.room,m.id);
    else if(m.type==='image')text=`[IMAGE: ${m.fileName||'image'}]`;
    else if(m.type==='voice')text='[VOICE NOTE]';
    else if(m.type==='poll')text=`[POLL: ${m.question}]`;
    else if(m.type==='location')text=`[LOCATION: ${m.lat?.toFixed(4)},${m.lng?.toFixed(4)}]`;
    else if(m.type==='contact')text=`[CONTACT: ${m.contactName} ${m.phone||''}]`;
    rows+=`<tr><td>${fmt(m.timestamp)}</td><td>${m.fromName||'?'}</td><td>${text||'—'}</td></tr>`;
  }
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>VoidChat — ${S.room}</title><style>body{font-family:monospace;background:#000;color:#00ff41;padding:20px;}table{width:100%;border-collapse:collapse;}th{background:#001400;color:#00ff41;padding:8px;text-align:left;border-bottom:2px solid #00ff41;}td{padding:8px;border-bottom:1px solid #002200;vertical-align:top;}</style></head><body><h1>🔐 VOIDCHAT — ${S.room}</h1><table><thead><tr><th>TIME</th><th>FROM</th><th>MESSAGE</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const a=ce('a');a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));a.download=`voidchat-${S.room}.html`;a.click();
  toast('Downloaded!','success');
}

// ── Voice Call (WebRTC) ────────────────────────────────────────────────────
async function startCall(){
  try{
    S.localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    S.peerConn=new RTCPeerConnection(RTC_CONFIG);
    S.localStream.getTracks().forEach(t=>S.peerConn.addTrack(t,S.localStream));
    S.peerConn.ontrack=e=>{let audio=document.getElementById('remote-audio');if(!audio){audio=ce('audio');audio.id='remote-audio';audio.autoplay=true;document.body.appendChild(audio);}audio.srcObject=e.streams[0];};
    S.peerConn.onicecandidate=e=>{if(e.candidate&&S.callId)db.ref(`rooms/${S.room}/call/${S.callId}/callerCandidates`).push(e.candidate.toJSON());};
    const offer=await S.peerConn.createOffer();
    await S.peerConn.setLocalDescription(offer);
    S.callId=genCode();
    await db.ref(`rooms/${S.room}/call`).set({callId:S.callId,caller:S.uid,callerName:S.name,offer:{type:offer.type,sdp:offer.sdp},status:'calling'});
    S.inCall=true;$('call-panel').classList.remove('hidden');$('call-status').textContent='Calling…';
    toast('📞 Calling…','info');
  }catch(e){toast('Call failed: '+e.message,'error');}
}
async function handleCallSignal(data){
  if(!data)return;
  if(data.caller===S.uid)return;
  if(data.status==='calling'&&!S.inCall){$('incoming-call-from').textContent=data.callerName||'Unknown';$('incoming-call-panel').classList.remove('hidden');S.callId=data.callId;}
  if(data.status==='answered'&&S.inCall&&data.answer&&S.peerConn){
    await S.peerConn.setRemoteDescription(new RTCSessionDescription(data.answer));$('call-status').textContent=`In call with ${data.calleeName||'user'}`;
    const cands=await db.ref(`rooms/${S.room}/call/${data.callId}/calleeCandidates`).once('value');
    cands.forEach(c=>{S.peerConn?.addIceCandidate(new RTCIceCandidate(c.val())).catch(()=>{});});
  }
  if(data.status==='ended')endCall(false);
}
async function answerCall(){
  $('incoming-call-panel').classList.add('hidden');
  try{
    const callData=(await db.ref(`rooms/${S.room}/call`).once('value')).val();
    S.localStream=await navigator.mediaDevices.getUserMedia({audio:true});
    S.peerConn=new RTCPeerConnection(RTC_CONFIG);
    S.localStream.getTracks().forEach(t=>S.peerConn.addTrack(t,S.localStream));
    S.peerConn.ontrack=e=>{let audio=document.getElementById('remote-audio');if(!audio){audio=ce('audio');audio.id='remote-audio';audio.autoplay=true;document.body.appendChild(audio);}audio.srcObject=e.streams[0];};
    S.peerConn.onicecandidate=e=>{if(e.candidate&&S.callId)db.ref(`rooms/${S.room}/call/${S.callId}/calleeCandidates`).push(e.candidate.toJSON());};
    await S.peerConn.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const callerCands=await db.ref(`rooms/${S.room}/call/${callData.callId}/callerCandidates`).once('value');
    callerCands.forEach(c=>{S.peerConn?.addIceCandidate(new RTCIceCandidate(c.val())).catch(()=>{});});
    const answer=await S.peerConn.createAnswer();await S.peerConn.setLocalDescription(answer);
    await db.ref(`rooms/${S.room}/call`).update({status:'answered',callee:S.uid,calleeName:S.name,answer:{type:answer.type,sdp:answer.sdp}});
    S.inCall=true;$('call-panel').classList.remove('hidden');$('call-status').textContent=`In call with ${callData.callerName}`;
  }catch(e){toast('Answer failed','error');}
}
function rejectCall(){$('incoming-call-panel').classList.add('hidden');db.ref(`rooms/${S.room}/call`).set({status:'ended'});}
async function endCall(notify=true){
  if(notify)await db.ref(`rooms/${S.room}/call`).set({status:'ended'});
  S.peerConn?.close();S.peerConn=null;
  S.localStream?.getTracks().forEach(t=>t.stop());S.localStream=null;
  S.inCall=false;S.callId=null;
  $('call-panel').classList.add('hidden');$('incoming-call-panel').classList.add('hidden');
  const ra=document.getElementById('remote-audio');if(ra)ra.remove();
  toast('Call ended','info');
}

// ── Sidebar & Navigation ───────────────────────────────────────────────────
function toggleSidebar(){S.sidebarOpen=!S.sidebarOpen;$('sidebar').classList.toggle('open',S.sidebarOpen);$('sb-overlay').classList.toggle('active',S.sidebarOpen);}
function closeSidebar(){S.sidebarOpen=false;$('sidebar').classList.remove('open');$('sb-overlay').classList.remove('active');}

async function leaveRoom(){
  if(!S.room)return;
  cleanup();await db.ref(`rooms/${S.room}/users/${S.uid}/online`).set(false);
  clearSess();S.room=null;S.isOwner=false;$('messages-list').innerHTML='';showScreen('screen-landing');toast('Disconnected','info');
}
async function closeRoom(auto=false){
  if(!S.isOwner||!S.room)return;
  if(!auto&&!confirm('Close room and delete all messages?'))return;
  await db.ref(`rooms/${S.room}/closed`).set(true);
  await db.ref(`rooms/${S.room}/messages`).remove();
  await db.ref(`rooms/${S.room}/scheduled`).remove();
  setTimeout(()=>db.ref(`rooms/${S.room}`).remove(),2000);
  cleanup();clearSess();S.room=null;$('messages-list').innerHTML='';showScreen('screen-landing');
  if(!auto)toast('Room purged','info');
}
function forceLeave(msg){cleanup();clearSess();S.room=null;$('messages-list').innerHTML='';showScreen('screen-landing');toast(msg||'Room closed','info');}
function cleanup(){S.listeners.forEach(o=>o());S.listeners=[];Object.values(S.timers).forEach(clearTimeout);S.timers={};Object.values(S.schedTimers).forEach(clearTimeout);S.schedTimers={};if(S.sessInterval){clearInterval(S.sessInterval);S.sessInterval=null;}S.revealed.clear();}

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
  $('toggle-reveal').addEventListener('change',e=>{
    S.globalReveal=e.target.checked;
    if(S.globalReveal&&S.canRead)revealAllVisible();
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
