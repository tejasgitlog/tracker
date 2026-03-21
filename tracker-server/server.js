const admin = require('firebase-admin');
const cron  = require('node-cron');
const http  = require('http');

// ── Hardcoded credentials (avoids env variable parsing issues) ──
const serviceAccount = {
  type: "service_account",
  project_id: "daily-tracker-6319c",
  private_key_id: "8cd7460f98be14a710949272c25c361a8d41516b",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC0CFteRnwnht/a\n25K8oL2OlC/4EgTsPLw44QuyU1kxzMWqn57JOGCqRB7y203t2aRHRjExqyKmUmlD\nzgyIVSGmoxLLZB5p5GqH2gZc+VZ3xjQoG9QbOqudMwqqdo7AXny94x3H+k819fhA\nNVVxMA7pe8zgFYYPQhYRI+oAhwalgCKzpHkaywCDy0fLWC8/x8jTyiXkJn4UyjQa\nXaDEeC9++plXfAMZhSUVUx6YwOEce7KMLavZT33OWZcASCR3Ey0CU1+XNZicPt5l\nB4L5ESxu2Ed9WK2l2lSkBifr5pKUG+zThcMCSAD1JomfgAhlK8uj/qz6nrjsUXCG\n1QyFtZcPAgMBAAECggEAPoUUbcXegb+F57QO3jCYA3aUvfpL+VoSJ1KHxFLLi87H\n6jvqYYiRkS986+uawXmuYg4PMWdz7fx6j9Bza7jcqcjB0x4erblkAW+GfC0eiROs\nsy0O2LHkPQAnuRDY/BcUDMFda0AS1/NmVa3v0RHWa+DRQhRXbN8PWL53Gd3KQhiL\nCa9enLtfcj0ISGfvs0gkHvwaXPnDiKqBlvJPEJOde1oEXCeGJIh8P+heEJmUA/J7\ncvT0ee93Kzylh9lr1yYMy0XMy0Aampl0qgHLn3ZULTYQCSMoSnbDf9rvGQ3spwGv\n7E5t+4u3ctPQbKDyNvqWLlt/j8D33AQMnkjliKKJqQKBgQDk+uXTxEjkifdYaZ17\n/FAmg2IJYtJ+Hh/ORgxHqq77hwsu268jRajEnxs4tzGpGz8uXAEeUckDA3WtRMX3\nkfrLIzYXsmU/7xDmVklOc4m1Fl/Q50VxrIFZWOsHlCMEK+WEw1tRdIQ+HFuNekMg\nHawtDoH0mHucSPbGxpsKlu/T/QKBgQDJRtcBnij5y/OxxRgjfyFMf9l3wCA9nzLK\nsBDOIRnXZTfTEX5ypqWZnCbkDyn/6jd+wvWzhwIv8D96DcSQ+dDa42pxgw5ZQOQ7\nwYHLcsdfMH3NqxW0PrzbDH45cBrebaFg66k+DE+5R5jQkIgAsz+JPx14d7pZfdeU\nXTaZ8o0W+wKBgQCv4TPVREiFGqAdjgpEKNrbqkEMWpa5/qOJim52QdlkJCdn16Af\n5KqsVFXRa40+ikoubscBJerTYL3r2A6DieJsU+CBtSpmQFfnxNFL7B0TNltkl6/U\nj59PJKhqytNWqe0C3BdxaqEFID0GX6ndqk0M0r7pRJJ1yembZwPBz4vpdQKBgHXH\nvF03/eZe0JXALeXnqMapMcp/ZN5qYEB3Uv4sJIEEu+wJGqNgnRsMYz2lGgClQCAv\nWbPaVw9SWPLFR7dGWE8eMNWHyUe1T1kgXSF+Yuhy6csGSEcXR1AvOVXHIhHyuTKL\n9JdYgPZ8zRGO4eb2/UEE6+vos+VWXGZ3PVJMuv8tAoGBAM9DUGZnL0qF38XebtUb\nW4TPIuvMtlpkoleaukoaGQrzDL0J1nDBsYT8qVbrTtW67p/xrEwgta9l8enVjeBd\ngTWLXXvHT4Ly8ZY+I/tIShcU6Zv0k7L36oDGpH11ZMzbwf0687OuVfTBRrvzxmRK\nXrb56gU59BTN/1efhEpik462\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-fbsvc@daily-tracker-6319c.iam.gserviceaccount.com",
  client_id: "114694382540795028267",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'daily-tracker-6319c',
});
const db = admin.firestore();
db.settings({ 
  ignoreUndefinedProperties: true,
  host: 'firestore.googleapis.com',
  ssl: true
});
const msg = admin.messaging();
console.log('✅ Firebase initialized for project: daily-tracker-6319c');

// Debug with known user ID from Firestore
async function debugFirestore() {
  try {
    console.log('🔍 Testing Firestore...');
    // Direct access to known user
    const knownUID = 'LlAT3yCuKkhWYQBVcZ2MZr3OUAA3';
    const directDoc = await db.doc(`users/${knownUID}/data/tracker`).get();
    console.log('📄 Direct doc exists:', directDoc.exists);
    if(directDoc.exists) {
      const d = directDoc.data();
      console.log('✅ Tasks count:', (d.tasks||[]).length);
      console.log('✅ notifEnabled:', d.notifEnabled);
    }
    // Also try listing users
    const cols = await db.listCollections();
    console.log('📁 Top collections:', cols.map(c=>c.id));
    const users = await db.collection('users').get();
    console.log('👥 Users found:', users.size);
  } catch(e) {
    console.error('🔥 Error:', e.code, e.message);
  }
}
debugFirestore();

// ── Helpers ──
function today() { return new Date().toISOString().slice(0, 10); }
function minsUntil(ds) {
  if (!ds) return null;
  return Math.floor((new Date(ds.includes('T') ? ds : ds + 'T23:59:00') - new Date()) / 60000);
}
function daysUntil(ds) {
  if (!ds) return null;
  return Math.floor((new Date(ds.includes('T') ? ds : ds + 'T23:59:00') - new Date()) / 86400000);
}
function fmt(ds) {
  return new Date(ds).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Track sent notifications to avoid duplicates ──
const sentNotifs = new Set();
function alreadySent(key) {
  if (sentNotifs.has(key)) return true;
  sentNotifs.add(key);
  // Clear after 2 hours to prevent memory leak
  setTimeout(() => sentNotifs.delete(key), 2 * 60 * 60 * 1000);
  return false;
}

// ── Send FCM ──
async function sendToUser(tokens, title, body, tag) {
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
      console.log(`📨 "${title}" → ...${token.slice(-8)}`);
    } catch (e) {
      console.error(`❌ FCM [${e.code}]: ${e.message}`);
    }
  }
}

// ── Main check ──
async function checkAndNotify(forceTest = false) {
  const now      = new Date();
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  const todayStr = today();

  try {
    const usersSnap = await db.collection('users').get();
    console.log(`👥 Found ${usersSnap.size} users`);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const dataSnap = await db.doc(`users/${uid}/data/tracker`).get();
      if (!dataSnap.exists) continue;
      const data = dataSnap.data();
      if (!data.notifEnabled && !forceTest) { console.log(`  ${uid}: notifications disabled`); continue; }

      const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
      if (tokensSnap.empty) { console.log(`  ${uid}: no FCM tokens`); continue; }
      const tokens = tokensSnap.docs.map(d => d.data().token || d.id);
      console.log(`  ${uid}: ${tokens.length} token(s)`);

      const tasks  = data.tasks  || [];
      const habits = data.habits || [];

      // ── Test mode ──
      if (forceTest) {
        await sendToUser(tokens, '🧪 Test!', 'FCM working! Server → device confirmed ✅', 'test');
        continue;
      }

      // ── Per-task notifications (wider window handles Render sleep) ──
      for (const task of tasks) {
        if (task.done || !task.dueDateTime) continue;
        const mins = minsUntil(task.dueDateTime);
        if (mins === null) continue;

        // 30 min warning — window: 25-35 mins
        if (mins >= 25 && mins <= 35 && !alreadySent(`w30-${task.id}-${todayStr}`))
          await sendToUser(tokens, 'Due in 30 minutes ⏰', `"${task.name}" is due at ${fmt(task.dueDateTime)}`, `w30-${task.id}`);

        // Due now — window: 0 to -15 mins (catches late wakeup)
        if (mins >= -15 && mins <= 0 && !alreadySent(`due-${task.id}-${todayStr}`))
          await sendToUser(tokens, 'Task due now! 🚨', `"${task.name}" — time is up! Mark it done.`, `due-${task.id}`);

        // 1 hour overdue — window: -55 to -75 mins
        if (mins >= -75 && mins <= -55 && !alreadySent(`ov-${task.id}-${todayStr}`))
          await sendToUser(tokens, 'Still overdue! ⚠️', `"${task.name}" was due at ${fmt(task.dueDateTime)}.`, `ov-${task.id}`);
      }

      // ── Daily 8am (window: 8:00-8:14) ──
      if (nowMins >= 480 && nowMins <= 494 && !alreadySent(`morning-${uid}-${todayStr}`)) {
        const pending  = tasks.filter(t => !t.done).length;
        const dueToday = tasks.filter(t => !t.done && t.dueDate === todayStr).length;
        if (dueToday > 0 || pending > 0)
          await sendToUser(tokens, 'Good morning! ☀️',
            dueToday > 0 ? `${dueToday} task${dueToday>1?'s':''} due today!` : `${pending} pending task${pending>1?'s':''}. Start strong!`,
            'daily-morning');
      }

      // ── Daily 7pm (window: 19:00-19:14) ──
      if (nowMins >= 1140 && nowMins <= 1154 && !alreadySent(`evening-${uid}-${todayStr}`)) {
        const overdue = tasks.filter(t => !t.done && (t.dueDateTime||t.dueDate) && minsUntil(t.dueDateTime||t.dueDate) < 0);
        const dueTmr  = tasks.filter(t => !t.done && t.dueDate && daysUntil(t.dueDate) === 1);
        if (overdue.length > 0)
          await sendToUser(tokens, 'Overdue tasks! 📋', `${overdue.slice(0,2).map(t=>t.name).join(', ')} overdue.`, 'daily-overdue');
        else if (dueTmr.length > 0)
          await sendToUser(tokens, 'Due tomorrow ⏰', `${dueTmr.slice(0,2).map(t=>t.name).join(', ')} due tomorrow.`, 'daily-tomorrow');
      }

      // ── Daily 9pm (window: 21:00-21:14) ──
      if (nowMins >= 1260 && nowMins <= 1274 && !alreadySent(`night-${uid}-${todayStr}`)) {
        const allHabits   = habits.length > 0 && habits.every(h => h.log && h.log[todayStr]);
        const anyActivity = tasks.some(t => t.done && t.created === todayStr) || habits.some(h => h.log && h.log[todayStr]);
        if (allHabits)
          await sendToUser(tokens, 'All habits done! 🔥', 'Amazing work today!', 'daily-evening');
        else if (!anyActivity)
          await sendToUser(tokens, 'Daily check-in 🌙', "Don't forget to log today's activities!", 'daily-checkin');
      }

      // ── Sunday 8pm weekly (window: 20:00-20:14) ──
      if (now.getDay() === 0 && nowMins >= 1200 && nowMins <= 1214 && !alreadySent(`weekly-${uid}-${todayStr}`)) {
        const ws = (() => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
        const weekDone = tasks.filter(t => t.done && t.created >= ws).length;
        await sendToUser(tokens, 'Weekly Report 📊', `This week: ${weekDone} tasks done. Great work!`, 'weekly-report');
      }
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

// ── HTTP server ──
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  if (req.url === '/test') {
    console.log('🧪 Test triggered');
    await checkAndNotify(true);
    res.writeHead(200); res.end('Test sent! Check logs and device.'); return;
  }
  res.writeHead(200); res.end('Daily Tracker Notification Server ✅');
}).listen(PORT, () => console.log(`🌐 Running on port ${PORT}`));

// ── Every minute ──
cron.schedule('* * * * *', () => {
  console.log(`⏰ ${new Date().toLocaleTimeString()}`);
  checkAndNotify();
});
checkAndNotify();
