const admin = require('firebase-admin');
const cron  = require('node-cron');

// ── Firebase init using environment variable ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'daily-tracker-6319c'
});

const db  = admin.firestore();
const msg = admin.messaging();

console.log('✅ Daily Tracker notification server started');

// ── Helpers ──
function today() {
  return new Date().toISOString().slice(0, 10);
}

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
  const validTokens = Object.keys(tokens);
  if (validTokens.length === 0) return;

  for (const token of validTokens) {
    try {
      await msg.send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            title, body,
            icon: 'https://mellow-dodol-c4c062.netlify.app/favicon.ico',
            tag,
            renotify: true,
            vibrate: [200, 100, 200]
          },
          fcmOptions: { link: 'https://mellow-dodol-c4c062.netlify.app/' }
        }
      });
      console.log(`📨 Sent "${title}" to token ...${token.slice(-6)}`);
    } catch (e) {
      if (e.code === 'messaging/registration-token-not-registered') {
        console.log(`🗑 Removing stale token ...${token.slice(-6)}`);
        // Remove stale token from Firestore
        await db.collection('users').doc(tokens[token]).collection('fcmTokens').doc(token).delete().catch(()=>{});
      } else {
        console.warn(`⚠ FCM error for token ...${token.slice(-6)}:`, e.message);
      }
    }
  }
}

// ── Main check — runs every minute ──
async function checkAndNotify() {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayStr = today();

  try {
    // Get all users
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // Get user data
      const dataSnap = await db.doc(`users/${uid}/data/tracker`).get();
      if (!dataSnap.exists) continue;
      const data = dataSnap.data();
      const tasks   = data.tasks   || [];
      const habits  = data.habits  || [];
      const notifEnabled = data.notifEnabled || false;
      if (!notifEnabled) continue;

      // Get FCM tokens for this user
      const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
      if (tokensSnap.empty) continue;
      const tokens = {}; // token -> uid mapping
      tokensSnap.forEach(d => { tokens[d.id] = uid; });

      // ── Per-task notifications ──
      for (const task of tasks) {
        if (task.done || !task.dueDateTime) continue;
        const mins = minsUntil(task.dueDateTime);
        if (mins === null) continue;

        // 30 min warning (fire between 29-31 mins to account for cron timing)
        if (mins >= 29 && mins <= 31) {
          await sendToUser(tokens,
            'Due in 30 minutes ⏰',
            `"${task.name}" is due at ${fmt(task.dueDateTime)}`,
            `warn30-${task.id}`
          );
        }

        // Exact due time (fire between -1 and +1 min)
        if (mins >= -1 && mins <= 1) {
          await sendToUser(tokens,
            'Task due now! 🚨',
            `"${task.name}" — time is up! Mark it done.`,
            `due-${task.id}`
          );
        }

        // 1 hour overdue reminder
        if (mins >= -61 && mins <= -59) {
          await sendToUser(tokens,
            'Still overdue! ⚠️',
            `"${task.name}" was due at ${fmt(task.dueDateTime)}. Please complete it.`,
            `ov1h-${task.id}`
          );
        }
      }

      // ── Daily 8:00am ──
      if (nowMins === 480) { // 8 * 60
        const pending  = tasks.filter(t => !t.done).length;
        const dueToday = tasks.filter(t => !t.done && t.dueDate === todayStr).length;
        if (dueToday > 0 || pending > 0) {
          await sendToUser(tokens,
            'Good morning! ☀️',
            dueToday > 0
              ? `${dueToday} task${dueToday > 1 ? 's' : ''} due today. Let's go!`
              : `${pending} pending task${pending > 1 ? 's' : ''}. Start strong!`,
            'daily-morning'
          );
        }
      }

      // ── Daily 7:00pm ──
      if (nowMins === 1140) { // 19 * 60
        const overdue   = tasks.filter(t => !t.done && (t.dueDateTime || t.dueDate) && minsUntil(t.dueDateTime || t.dueDate) < 0);
        const dueTmr    = tasks.filter(t => !t.done && t.dueDate && daysUntil(t.dueDate) === 1);
        if (overdue.length > 0) {
          await sendToUser(tokens,
            'Overdue tasks! 📋',
            `${overdue.slice(0, 2).map(t => t.name).join(', ')} ${overdue.length > 1 ? 'are' : 'is'} overdue.`,
            'daily-overdue'
          );
        } else if (dueTmr.length > 0) {
          await sendToUser(tokens,
            'Due tomorrow ⏰',
            `${dueTmr.slice(0, 2).map(t => t.name).join(', ')} due tomorrow.`,
            'daily-tomorrow'
          );
        }
      }

      // ── Daily 9:00pm ──
      if (nowMins === 1260) { // 21 * 60
        const allHabits = habits.length > 0 && habits.every(h => h.log && h.log[todayStr]);
        const anyActivity = tasks.some(t => t.done && t.created === todayStr) ||
                            habits.some(h => h.log && h.log[todayStr]);
        if (allHabits) {
          await sendToUser(tokens, 'All habits done! 🔥', 'Amazing work today! Keep the streak going.', 'daily-evening');
        } else if (!anyActivity) {
          await sendToUser(tokens, 'Daily check-in 🌙', 'Don\'t forget to log today\'s activities!', 'daily-checkin');
        }
      }

      // ── Sunday 8:00pm weekly report ──
      if (now.getDay() === 0 && nowMins === 1200) { // Sunday, 20 * 60
        const weekStart = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0,10); })();
        const weekDone  = tasks.filter(t => t.done && t.created >= weekStart).length;
        await sendToUser(tokens,
          'Weekly Report 📊',
          `This week: ${weekDone} tasks completed. Great work!`,
          'weekly-report'
        );
      }
    }
  } catch (e) {
    console.error('❌ Check error:', e.message);
  }
}

// ── Run every minute ──
cron.schedule('* * * * *', () => {
  console.log(`⏰ Check at ${new Date().toLocaleTimeString()}`);
  checkAndNotify();
});

// Also run once immediately on start
checkAndNotify();
