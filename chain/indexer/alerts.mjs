// Operator alerts on Telegram: every "!!" line the server logs (ops halted, ops wallet low on SOL, a claim that won't settle,
// missing secrets…) is also sent to your Telegram chat. Optional: set TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID.
// The same message is sent at most once an hour, and at most 20 messages an hour in total.
export function startAlerts({ token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID, name = 'treid' } = {}) {
  if (!token || !chat) return { on: false, send() {} };
  const last = new Map(); let hour = 0, n = 0;
  async function send(text) {
    const now = Date.now(), key = String(text).replace(/\d+(\.\d+)?/g, '#').slice(0, 120);   // numbers don't make a message "new"
    if (now - (last.get(key) || 0) < 36e5) return; if (now - hour > 36e5) { hour = now; n = 0; } if (++n > 20) return; last.set(key, now);
    if (last.size > 500) last.clear();
    try { await fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: chat, text: '⚠️ ' + name + ': ' + String(text).replace(/^!!\s*/, '').slice(0, 900), disable_web_page_preview: true }) }); } catch {}
  }
  const err0 = console.error.bind(console);
  console.error = (...a) => { err0(...a); const line = a.map((x) => (typeof x === 'string' ? x : x?.message || JSON.stringify(x))).join(' '); if (/^!!/.test(line)) send(line); };
  return { on: true, send };
}
export const ALERTS = startAlerts();   // started on import, before any other module logs
