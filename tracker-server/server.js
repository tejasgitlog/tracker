const admin = require('firebase-admin');
const cron  = require('node-cron');
const http  = require('http');
const https = require('https');

// ── Secure credentials from environment variable (base64 encoded) ──
let serviceAccount;
try {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 not set');
  serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  console.log('✅ Credentials loaded for project:', serviceAccount.project_id);
} catch(e) {
  console.error('❌ Failed to load credentials:', e.message);
  process.exit(1);
}

// ── Known users (fallback when Firestore collection scan fails) ──
const KNOWN_USERS = ['lRb3wB6dz2PjJ4gxoGmpxxsmSQ62'];

// ── Firebase init ──
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});
const db  = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const msg = admin.messaging();
console.log('✅ Daily Tracker notification server started');

// ── Helpers ──
function today() {
  const ist = new Date(Date.now() + 5.5*60*60*1000);
  return ist.toISOString().slice(0,10);
}
function istNow() {
  return new Date(Date.now() + 5.5*60*60*1000);
}
function minsUntil(ds) {
  if(!ds) return null;
  const str = ds.includes('T') ? ds : ds+'T23:59:00';
  const due = str.includes('Z')||str.includes('+') ? new Date(str) : new Date(str+'+05:30');
  return Math.floor((due - new Date()) / 60000);
}
function daysUntil(ds) {
  if(!ds) return null;
  const str = ds.includes('T') ? ds : ds+'T23:59:00';
  const due = str.includes('Z')||str.includes('+') ? new Date(str) : new Date(str+'+05:30');
  return Math.floor((due - new Date()) / 86400000);
}
function fmt(ds) {
  const str = ds.includes('T') ? ds : ds+'T00:00:00';
  const due = str.includes('Z')||str.includes('+') ? new Date(str) : new Date(str+'+05:30');
  return due.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
}

// ── Deduplication via Firestore (survives restarts) ──
async function canSend(key) {
  try {
    const ref = db.doc(`notifSent/${key.replace(/[^a-zA-Z0-9]/g,'-')}`);
    const snap = await ref.get();
    if(snap.exists) return false;
    await ref.set({ sentAt: new Date().toISOString() });
    setTimeout(async()=>{ try{ await ref.delete(); }catch(e){} }, 2*60*60*1000);
    return true;
  } catch(e) { return true; }
}

// ── Send FCM notification ──
async function sendToUser(tokens, title, body, tag) {
  for(const token of tokens) {
    try {
      await msg.send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            title, body,
            icon: 'https://mellow-dodol-c4c062.netlify.app/favicon.ico',
            tag, renotify: true, vibrate: [200,100,200]
          },
          fcmOptions: { link: 'https://mellow-dodol-c4c062.netlify.app/' }
        }
      });
      console.log(`📨 "${title}" → ...${token.slice(-8)}`);
    } catch(e) {
      if(e.code !== 'messaging/registration-token-not-registered') {
        console.error(`❌ FCM: ${e.message}`);
      }
    }
  }
}

// ── Main notification check ──
async function checkAndNotify(forceTest=false) {
  const ist      = istNow();
  const nowMins  = ist.getUTCHours()*60 + ist.getUTCMinutes();
  const todayStr = today();

  try {
    // Try collection scan first, fall back to known UIDs
    let uids = [...KNOWN_USERS];
    try {
      const snap = await db.collection('users').get();
      if(snap.size > 0) uids = snap.docs.map(d=>d.id);
    } catch(e) {}

    for(const uid of uids) {
      const dataSnap = await db.doc(`users/${uid}/data/tracker`).get();
      if(!dataSnap.exists) continue;
      const data = dataSnap.data();
      if(!data.notifEnabled && !forceTest) continue;

      const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
      if(tokensSnap.empty) continue;
      const tokens = tokensSnap.docs.map(d=>d.data().token||d.id);

      const tasks  = data.tasks  || [];
      const habits = data.habits || [];

      // ── Test mode ──
      if(forceTest) {
        await sendToUser(tokens,'🧪 Test','FCM working! Notifications confirmed ✅','test');
        continue;
      }

      // ── Per-task precise notifications ──
      for(const task of tasks) {
        if(task.done || !task.dueDateTime) continue;
        const mins = minsUntil(task.dueDateTime);
        if(mins===null) continue;

        if(mins>=29&&mins<=31&&await canSend(`w30-${task.id}-${todayStr}`))
          await sendToUser(tokens,'Due in 30 minutes ⏰',`"${task.name}" is due at ${fmt(task.dueDateTime)}`,`w30-${task.id}`);

        if(mins>=-1&&mins<=0&&await canSend(`due-${task.id}-${todayStr}`))
          await sendToUser(tokens,'Task due now! 🚨',`"${task.name}" — time is up! Mark it done.`,`due-${task.id}`);

        if(mins>=-61&&mins<=-59&&await canSend(`ov-${task.id}-${todayStr}`))
          await sendToUser(tokens,'Still overdue! ⚠️',`"${task.name}" was due at ${fmt(task.dueDateTime)}.`,`ov-${task.id}`);
      }

      // ── Daily 8am morning summary ──
      if(nowMins>=480&&nowMins<=481&&await canSend(`morning-${uid}-${todayStr}`)) {
        const pending  = tasks.filter(t=>!t.done).length;
        const dueToday = tasks.filter(t=>!t.done&&t.dueDate===todayStr).length;
        if(dueToday>0||pending>0)
          await sendToUser(tokens,'Good morning! ☀️',
            dueToday>0?`${dueToday} task${dueToday>1?'s':''} due today!`:`${pending} pending task${pending>1?'s':''}. Start strong!`,
            'daily-morning');
      }

      // ── Daily 7pm overdue check ──
      if(nowMins>=1140&&nowMins<=1141&&await canSend(`evening-${uid}-${todayStr}`)) {
        const overdue = tasks.filter(t=>!t.done&&(t.dueDateTime||t.dueDate)&&minsUntil(t.dueDateTime||t.dueDate)<0);
        const dueTmr  = tasks.filter(t=>!t.done&&t.dueDate&&daysUntil(t.dueDate)===1);
        if(overdue.length>0)
          await sendToUser(tokens,'Overdue tasks! 📋',`${overdue.slice(0,2).map(t=>t.name).join(', ')} overdue.`,'daily-overdue');
        else if(dueTmr.length>0)
          await sendToUser(tokens,'Due tomorrow ⏰',`${dueTmr.slice(0,2).map(t=>t.name).join(', ')} due tomorrow.`,'daily-tomorrow');
      }

      // ── Daily 9pm streak check ──
      if(nowMins>=1260&&nowMins<=1261&&await canSend(`night-${uid}-${todayStr}`)) {
        const allHabits   = habits.length>0&&habits.every(h=>h.log&&h.log[todayStr]);
        const anyActivity = tasks.some(t=>t.done&&t.created===todayStr)||habits.some(h=>h.log&&h.log[todayStr]);
        if(allHabits)
          await sendToUser(tokens,'All habits done! 🔥','Amazing work today! Keep the streak going.','daily-evening');
        else if(!anyActivity)
          await sendToUser(tokens,'Daily check-in 🌙',"Don't forget to log today's activities!",'daily-checkin');
      }

      // ── Sunday 8pm weekly report ──
      if(ist.getUTCDay()===0&&nowMins>=1200&&nowMins<=1201&&await canSend(`weekly-${uid}-${todayStr}`)) {
        const ws=(()=>{ const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
        const done=tasks.filter(t=>t.done&&t.created>=ws).length;
        await sendToUser(tokens,'Weekly Report 📊',`This week: ${done} tasks done. Great work!`,'weekly-report');
      }
    }
  } catch(e) {
    console.error('❌ Error:', e.message);
  }
}

// ── HTTP server ──
const PORT = process.env.PORT||3000;
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://tracker-u4h8.onrender.com';

http.createServer(async(req,res)=>{
  if(req.url==='/test') {
    await checkAndNotify(true);
    res.writeHead(200); res.end('Test sent! Check your device.'); return;
  }
  res.writeHead(200); res.end('Daily Tracker Notification Server ✅');
}).listen(PORT, ()=>console.log(`🌐 Running on port ${PORT}`));

// ── Self-ping every 14 mins to prevent Render sleep ──
setInterval(()=>{
  https.get(SERVER_URL, ()=>{}).on('error', ()=>{});
}, 14*60*1000);

// ── Run every minute ──
cron.schedule('* * * * *', ()=>checkAndNotify());
checkAndNotify();
