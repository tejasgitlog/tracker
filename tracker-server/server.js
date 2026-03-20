const admin = require('firebase-admin');
const cron  = require('node-cron');
const http  = require('http');

// ── HTTP server (required for Render free Web Service) ──
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Daily Tracker Notification Server running ✅');
}).listen(PORT, () => console.log(`HTTP server on port ${PORT}`));

// ── Firebase init ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'daily-tracker-6319c'
});
const db  = admin.firestore();
const msg = admin.messaging();
console.log('✅ Daily Tracker notification server started');

// ── Helpers ──
function today() { return new Date().toISOString().slice(0, 10); }
function minsUntil(ds) {
  if (!ds) return null;
  const due = new Date(ds.includes('T') ? ds : ds + 'T23:59:00');
  return Math.floor((due - new Date()) / 60000);
}
function daysUntil(ds) {
  if (!ds) return null;
  const due = new Date(ds.includes('T') ? ds : ds + 'T23:59:00');
  return Math.floor((due - new Date()) / (1000 * 60 * 60 * 24));
}
function fmt(ds) {
  return new Date(ds).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Send FCM to all tokens of a user ──
async function sendToUser(tokens, title, body, tag) {
  if (!tokens || tokens.length === 0) return;
  for (const token of tokens) {
    try {
      await msg.send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            title, body,
            icon: 'https://mellow-dodol-c4c062.netlify.app/favicon.ico',
            tag, renotify: true, vibrate: [200, 100, 200]
          },
          fcmOptions: { link: 'https://mellow-dodol-c4c062.netlify.app/' }
        }
      });
      console.log(`📨 Sent "${title}" → ...${token.slice(-6)}`);
    } catch (e) {
      if (e.code === 'messaging/registration-token-not-registered') {
        console.log(`🗑 Stale token removed ...${token.slice(-6)}`);
      } else {
        console.warn(`⚠ FCM error:`, e.message);
      }
    }
  }
}

// ── Main check ──
async function checkAndNotify() {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayStr = today();

  try {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const dataSnap = await db.doc(`users/${uid}/data/tracker`).get();
      if (!dataSnap.exists) continue;
      const data = dataSnap.data();
      const tasks  = data.tasks   || [];
      const habits = data.habits  || [];
      if (!data.notifEnabled) continue;

      // Get FCM tokens
      const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
      if (tokensSnap.empty) continue;
      const tokens = tokensSnap.docs.map(d => d.id);

      // ── Per-task precise notifications ──
      for (const task of tasks) {
        if (task.done || !task.dueDateTime) continue;
        const mins = minsUntil(task.dueDateTime);
        if (mins === null) continue;
        if (mins >= 29 && mins <= 31)
          await sendToUser(tokens, 'Due in 30 minutes ⏰', `"${task.name}" is due at ${fmt(task.dueDateTime)}`, `w30-${task.id}`);
        if (mins >= -1 && mins <= 1)
          await sendToUser(tokens, 'Task due now! 🚨', `"${task.name}" — time is up! Mark it done.`, `due-${task.id}`);
        if (mins >= -61 && mins <= -59)
          await sendToUser(tokens, 'Still overdue! ⚠️', `"${task.name}" was due at ${fmt(task.dueDateTime)}.`, `ov-${task.id}`);
      }

      // ── Daily 8am ──
      if (nowMins === 480) {
        const pending  = tasks.filter(t => !t.done).length;
        const dueToday = tasks.filter(t => !t.done && t.dueDate === todayStr).length;
        if (dueToday > 0 || pending > 0)
          await sendToUser(tokens, 'Good morning! ☀️',
            dueToday > 0 ? `${dueToday} task${dueToday>1?'s':''} due today. Let's go!`
                         : `${pending} pending task${pending>1?'s':''}. Start strong!`,
            'daily-morning');
      }

      // ── Daily 7pm ──
      if (nowMins === 1140) {
        const overdue = tasks.filter(t => !t.done && (t.dueDateTime||t.dueDate) && minsUntil(t.dueDateTime||t.dueDate) < 0);
        const dueTmr  = tasks.filter(t => !t.done && t.dueDate && daysUntil(t.dueDate) === 1);
        if (overdue.length > 0)
          await sendToUser(tokens, 'Overdue tasks! 📋',
            `${overdue.slice(0,2).map(t=>t.name).join(', ')} ${overdue.length>1?'are':'is'} overdue.`, 'daily-overdue');
        else if (dueTmr.length > 0)
          await sendToUser(tokens, 'Due tomorrow ⏰',
            `${dueTmr.slice(0,2).map(t=>t.name).join(', ')} due tomorrow.`, 'daily-tomorrow');
      }

      // ── Daily 9pm ──
      if (nowMins === 1260) {
        const allHabits   = habits.length > 0 && habits.every(h => h.log && h.log[todayStr]);
        const anyActivity = tasks.some(t => t.done && t.created === todayStr) || habits.some(h => h.log && h.log[todayStr]);
        if (allHabits)
          await sendToUser(tokens, 'All habits done! 🔥', 'Amazing work today! Keep the streak going.', 'daily-evening');
        else if (!anyActivity)
          await sendToUser(tokens, 'Daily check-in 🌙', "Don't forget to log today's activities!", 'daily-checkin');
      }

      // ── Sunday 8pm weekly ──
      if (now.getDay() === 0 && nowMins === 1200) {
        const weekStart = (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
        const weekDone  = tasks.filter(t => t.done && t.created >= weekStart).length;
        await sendToUser(tokens, 'Weekly Report 📊', `This week: ${weekDone} tasks completed. Great work!`, 'weekly-report');
      }
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

// ── Run every minute ──
cron.schedule('* * * * *', () => {
  console.log(`⏰ ${new Date().toLocaleTimeString()}`);
  checkAndNotify();
});

checkAndNotify();
