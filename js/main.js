// Hash router, header account menu, home screen and sign-in page.
import { h, clear, api, results, store, gauge, inkTabs, fmtClock, downloadBackup, importProgress, clearProgress, storageAvailable } from './util.js';
import { fullTestCover, fullTestRun, debrief } from './fulltest.js';
import { knowledgeSetup, knowledgeStudy, knowledgeDrill } from './knowledge.js';
import { legYears, legList, legRun } from './legs.js';
import { installFx, soundButton } from './fx.js';
import { cloud, initCloud, onCloud, signInGoogle, signOutGoogle, syncDown, eraseAccount, getContent, listAccess, setAllowed, setAdmin, uploadBundle } from './cloud.js';
import { setContentSource, clearContentCaches } from './util.js';
setContentSource(getContent);

installFx();
const sndBtn = soundButton();

const app = document.getElementById('app');
let leaveFns = [];
const ctx = { onLeave(fn) { leaveFns.push(fn); } };

// ------------------------------------------------------------------ header: sound, sign-in, progress
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function toast(msg, kind = '') {
  const t = h('div', { class: 'app-toast ' + kind, role: 'status' }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 5200);
}
async function doSignOut() {
  await signOutGoogle(); clearContentCaches();
  toast('Signed out. Your progress is saved in your account.');
  location.hash = '#/'; route();
}
async function doSignIn() {
  try { await signInGoogle(); } catch (e) { toast(e.message, 'bad'); }
}
const PERSON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const STATUS = { synced: 'Progress synced to your account', syncing: 'Syncing…', error: 'Sync problem', off: '', unavailable: '' };
function drawAccount() {
  const slot = document.getElementById('account');
  if (!slot) return;
  const parts = [sndBtn];
  if (cloud.user) {
    const u = cloud.user;
    const avatar = u.photo ? h('img', { class: 'avatar', src: u.photo, alt: '', referrerpolicy: 'no-referrer' })
      : h('span', { class: 'avatar initial' }, (u.name || '?').trim().charAt(0).toUpperCase());
    parts.push(h('details', { class: 'acct-menu' },
      h('summary', { title: STATUS[cloud.status] || cloud.error || '' }, avatar, h('span', { class: 'acct-name' }, u.name.split(' ')[0]),
        h('span', { class: 'sync-dot s-' + cloud.status, 'aria-label': STATUS[cloud.status] || 'sync status' })),
      h('div', { class: 'acct-pop' },
        h('div', { class: 'acct-full' }, h('b', {}, u.name)),
        h('div', { class: 'muted small' }, cloud.status === 'error' ? cloud.error : STATUS[cloud.status]),
        h('a', { class: 'btn small', href: '#/progress' }, 'My progress'),
        cloud.admin ? h('a', { class: 'btn small', href: '#/admin' }, 'Admin') : null,
        h('button', { class: 'btn small', onclick: doSignOut }, 'Sign out'))));
  } else {
    if (cloud.ready && cloud.status !== 'unavailable') parts.push(h('button', { class: 'btn small google-btn', onclick: doSignIn, html: GOOGLE_G + '<span>Sign in with Google</span>' }));
  }
  clear(slot).append(...parts);
  for (const a of document.querySelectorAll('.topbar nav a')) {
    const target = a.getAttribute('href');
    const hsh = location.hash || '#/';
    const on = target === '#/' ? hsh === '#/' : target === '#/knowledge' ? hsh.startsWith('#/knowledge') && !hsh.startsWith('#/knowledge/ppl') : hsh.startsWith(target);
    a.classList.toggle('on', on);
  }
}
onCloud(drawAccount);
// re-render pages that show saved progress when the account data arrives (never in the middle of a test or leg)
const SAFE_TO_REFRESH = /^#?\/?$|^#\/(progress|knowledge(\/(scan|ppl))?|legs(\/\d{4})?)$/;
window.addEventListener('scan-cloud-merged', () => { toast('Signed in. This browser’s progress is merged into your account.', 'ok'); if (SAFE_TO_REFRESH.test(location.hash || '#/')) route(); });
window.addEventListener('scan-cloud-updated', () => { if (SAFE_TO_REFRESH.test(location.hash || '#/')) route(); });

// ------------------------------------------------------------------ home
const pct = r => r?.score?.percent ?? (r?.answered ? (100 * r.correct) / r.answered : null);
const KIND_LABEL = { full_test: 'Full Test', leg: 'Leg Practice', knowledge_study: 'SCAN knowledge · Study', knowledge_drill: 'SCAN knowledge · Drill',
  ppl_study: 'PPL · Study', ppl_drill: 'PPL · Drill' };

async function home() {
  const idx = await api.index();
  const mine = await results.list().catch(() => []);
  const ft = mine.filter(r => r.kind === 'full_test'), legs = mine.filter(r => r.kind === 'leg');
  const kn = mine.filter(r => /_study$/.test(r.kind)), dr = mine.filter(r => /_drill$/.test(r.kind));
  const avg = rs => { const v = rs.map(pct).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const answered = kn.reduce((a, r) => a + (r.answered || 0), 0), correct = kn.reduce((a, r) => a + (r.correct || 0), 0);
  const bestAlt = dr.reduce((m, r) => Math.max(m, r.alt || 0), 0);
  const first = cloud.user ? cloud.user.name.split(' ')[0] : null;
  clear(app).append(h('section', { class: 'home' },
    h('div', { class: 'hero' },
      heroFlight(),
      h('img', { class: 'hero-logo', src: 'img/skybroncos_512.png', alt: 'Western Michigan University Sky Broncos logo' }),
      h('div', { class: 'hero-text' },
        h('p', { class: 'eyebrow' }, 'WMU Sky Broncos · SAFECON SCAN'),
        h('h1', { class: 'tagline-head' }, 'Wear the ', h('span', { class: 't-brown' }, 'brown'), '. Win the ', h('span', { class: 't-gold' }, 'gold'), '.'),
        h('p', { class: 'tagline' }, `Every Regional SCAN test from ${idx.years[0].year} to ${idx.years.at(-1).year}, exactly as printed, with the briefing packets, sectionals and official answers. Plan it, fly it, debrief it.`),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary', href: '#/test/' + idx.years.at(-1).year }, `Take the ${idx.years.at(-1).year} test`),
          h('a', { class: 'btn', href: '#/knowledge/scan' }, 'Study knowledge')))),
    h('div', { class: 'band gold' }, h('div', { class: 'band-inner' },
      first
        ? h('div', {}, h('h2', {}, `Welcome back, ${first}.`), h('p', {}, 'Your progress is saved to your account and synced on every device you sign in on.'))
        : h('div', {}, h('h2', {}, 'Keep your progress on every device'), h('p', {}, 'Sign in with Google to sync results, leg progress and badges. Or just start: progress is saved in this browser.')),
      first ? h('a', { class: 'btn', href: '#/progress' }, 'My progress')
        : (cloud.status === 'unavailable' ? h('a', { class: 'btn', href: '#/progress' }, 'My progress') : h('button', { class: 'btn google-btn', onclick: doSignIn, html: GOOGLE_G + '<span>Sign in with Google</span>' })))),
    h('div', { class: 'section-title' }, h('h2', {}, 'Choose your training'), h('p', {}, 'Three ways to practice, all graded against the official SCAN keys.')),
    h('div', { class: 'modes' },
      h('article', { class: 'mode-card feature' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Full Test'), gauge(ft.length ? pct(ft[0]) : null, 'last test', { size: 84 })),
        h('p', {}, 'One year’s complete set, timed like the real event, with the Briefing Packet and the chart.'),
        h('div', { class: 'year-grid small' }, idx.years.map(y => {
          const last = ft.find(r => r.year === y.year);
          return h('a', { class: 'year-card', href: `#/test/${y.year}` }, h('b', {}, y.year),
            h('span', { class: 'muted small' }, `${y.questions} Q${y.time_limit_minutes ? ' · ' + y.time_limit_minutes + ' min' : ''}`),
            last ? h('span', { class: 'yc-score mono' }, `${last.score.correct}/${last.score.scored}`) : null);
        }))),
      h('article', { class: 'mode-card feature' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Knowledge'), gauge(answered ? (100 * correct) / answered : null, 'study accuracy', { size: 84 })),
        h('p', {}, 'SCAN knowledge questions and the Private Pilot quiz. Study at your own pace, or Drill against the clock.'),
        h('div', { class: 'stat-row' }, h('span', {}, h('b', { class: 'mono' }, answered || 0), ' answered'), h('span', {}, h('b', { class: 'mono' }, bestAlt ? bestAlt.toLocaleString() + ' ft' : '--'), ' best Drill')),
        h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/knowledge/scan' }, 'SCAN knowledge'), h('a', { class: 'btn', href: '#/knowledge/ppl' }, 'PPL quiz'))),
      h('article', { class: 'mode-card feature' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Leg Practice'), gauge(avg(legs.slice(0, 10)), 'recent legs', { size: 84 })),
        h('p', {}, 'Fly one leg at a time: briefing, nav log with official checks, and the leg’s questions.'),
        h('div', { class: 'stat-row' }, h('span', {}, h('b', { class: 'mono' }, legs.length), ' legs flown')),
        h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/legs' }, 'Pick a year')))),
    h('div', { class: 'section-title' }, h('h2', {}, 'Your recent results'), h('p', {}, first ? 'Saved to your account.' : 'Saved in this browser.')),
    h('section', { class: 'history' },
      mine.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'hist' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Mode'), h('th', {}, 'Year / leg'), h('th', {}, 'Result'), h('th', {}, ''))),
        h('tbody', {}, mine.slice(0, 12).map(r => h('tr', {},
          h('td', { class: 'mono small' }, new Date(r.created * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })),
          h('td', {}, KIND_LABEL[r.kind] || r.kind),
          h('td', {}, r.year ? String(r.year) : '', r.leg ? ` · ${r.leg}` : ''),
          h('td', { class: 'mono' }, r.score ? `${r.score.correct}/${r.score.scored}` : r.alt != null ? `${r.alt.toLocaleString()} ft · ${r.correct}/${r.asked}` : r.answered != null ? `${r.correct}/${r.answered}` : '',
            r.seconds ? ` · ${fmtClock(r.seconds)}` : ''),
          h('td', {}, r.kind === 'full_test' && r.has_detail !== false ? h('a', { href: `#/debrief/${r.id}` }, 'Debrief') : ''))))))
        : h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Nothing yet. Take a test or study a few questions and your results show up here.'))));
}

// a small airplane flying a dashed route across the hero (decorative)
function heroFlight() {
  const NS = 'http://www.w3.org/2000/svg';
  const wrap = document.createElement('div');
  wrap.className = 'hero-flight'; wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg viewBox="0 0 1000 300" preserveAspectRatio="none" xmlns="${NS}">
    <path id="hero-route" d="M-40 46 C 180 18, 360 40, 560 24 S 860 8, 1060 30" fill="none" stroke="rgba(230,178,58,.5)" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round"/>
    <g class="hero-plane"><path d="M14 0 L-8 -3 L-12 -12 L-16 -12 L-13 -2.5 L-20 -2 L-23 -6 L-26 -6 L-24 0 L-26 6 L-23 6 L-20 2 L-13 2.5 L-16 12 L-12 12 L-8 3 Z" fill="#f6e7c4"/>
      <animateMotion dur="14s" repeatCount="indefinite" rotate="auto"><mpath href="#hero-route"/></animateMotion></g>
    <circle r="3" fill="#e6b23a"><animate attributeName="opacity" values="1;.2;1" dur="1.4s" repeatCount="indefinite"/><animateMotion dur="14s" repeatCount="indefinite"><mpath href="#hero-route"/></animateMotion></circle>
  </svg>`;
  return wrap;
}

// ------------------------------------------------------------------ progress: backup, restore, reset
async function progressPage() {
  const mine = await results.list();
  const msg = h('p', { class: 'form-msg', role: 'status' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  let mode = 'merge';
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const n = importProgress(JSON.parse(await f.text()), mode);
      msg.className = 'form-msg ok'; msg.textContent = `Imported ${n} item(s) from ${f.name}.`;
      setTimeout(progressPage, 900);
    } catch (e) { msg.className = 'form-msg'; msg.textContent = e.message || 'Could not read that file.'; }
    file.value = '';
  });
  const counts = {};
  for (const r of mine) counts[r.kind] = (counts[r.kind] || 0) + 1;
  clear(app).append(h('section', { class: 'panel narrow progress-page' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › My progress'),
    h('h1', {}, 'My progress'),
    storageAvailable() ? null : h('p', { class: 'note warn' }, 'This browser is blocking site storage (private window?), so progress will be lost when you close the tab.'),
    cloud.user
      ? h('div', { class: 'acct-box' }, cloud.user.photo ? h('img', { class: 'avatar big', src: cloud.user.photo, alt: '', referrerpolicy: 'no-referrer' }) : null,
          h('div', {}, h('b', {}, cloud.user.name), h('div', { class: 'muted small' }, cloud.status === 'error' ? cloud.error : (STATUS[cloud.status] || '')),
            h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: async () => { await syncDown(false); toast(cloud.status === 'synced' ? 'Synced.' : (cloud.error || 'Sync failed.'), cloud.status === 'synced' ? 'ok' : 'bad'); } }, '⟳ Sync now'),
              h('button', { class: 'btn small', onclick: async () => { await signOutGoogle(); location.hash = '#/'; } }, 'Sign out'))))
      : h('div', { class: 'acct-box' }, h('div', {}, h('b', {}, 'Not signed in.'), ' Progress is saved in this browser only.',
          cloud.status === 'unavailable' ? h('div', { class: 'muted small' }, cloud.error) :
            h('div', { class: 'actions' }, h('button', { class: 'btn gold google-btn', onclick: doSignIn, html: GOOGLE_G + '<span>Sign in with Google</span>' })),
          h('div', { class: 'muted small' }, 'Signing in merges what is saved here into your account and keeps it in sync on every device you sign in on.'))),
    h('p', {}, 'Saved progress covers test results and debriefs, leg progress, Knowledge and Drill scores, badges, bookmarks, and chart and packet marks. ',
      cloud.user ? 'It is stored in your account and kept in this browser while you are signed in.' : 'Clearing your browser data erases it, so sign in or export a backup now and then.'),
    h('div', { class: 'stat-row' }, h('span', {}, h('b', { class: 'mono' }, mine.length), ' results saved'),
      h('span', {}, h('b', { class: 'mono' }, counts.full_test || 0), ' Full Tests'), h('span', {}, h('b', { class: 'mono' }, counts.leg || 0), ' legs')),
    h('div', { class: 'rwy-divider', 'aria-hidden': 'true' }),
    h('h2', {}, 'Back up'),
    h('p', { class: 'muted' }, 'Downloads a .json file with all of your progress. Keep it somewhere safe, or open it on another device with Import.'),
    h('button', { class: 'btn primary', onclick: () => { downloadBackup(); msg.className = 'form-msg ok'; msg.textContent = 'Backup downloaded.'; } }, '⬇ Export progress'),
    h('h2', {}, 'Restore'),
    h('div', { class: 'chk-grid' },
      h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'imode', checked: true, onchange: () => { mode = 'merge'; } }), ' Merge with what is here'),
      h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'imode', onchange: () => { mode = 'replace'; } }), ' Replace everything here')),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => file.click() }, '⬆ Import a backup…'), file),
    msg,
    h('h2', {}, 'Start over'),
    cloud.user
      ? h('button', { class: 'btn danger-btn', onclick: async () => {
          if (confirm('Erase ALL progress in your account, on every device? This cannot be undone. Export a backup first if you might want it back.')) {
            try { await eraseAccount(); toast('All progress erased.'); } catch (e) { toast(e.message || 'Could not erase.', 'bad'); }
            progressPage();
          } } }, 'Erase all progress in my account')
      : h('button', { class: 'btn danger-btn', onclick: () => {
          if (confirm('Erase ALL progress saved in this browser? Export a backup first if you might want it back.')) { clearProgress(); progressPage(); }
        } }, 'Erase all progress in this browser')));
}

// ------------------------------------------------------------------ gate: landing, restricted, admin
function setGate(state) {
  document.body.dataset.gate = state;   // out | checking | restricted | in
}
function tagline() {
  return h('p', { class: 'gate-tagline' }, 'Wear the ', h('span', { class: 't-brown' }, 'brown'), '. Win the ', h('span', { class: 't-gold' }, 'gold'), '.');
}
function landingPage() {
  clear(app).append(h('section', { class: 'gate-page' },
    h('img', { class: 'gate-logo', src: 'img/skybroncos_512.png', alt: 'Western Michigan University Sky Broncos logo' }),
    h('h1', { class: 'gate-title' }, 'SCAN Prep'),
    tagline(),
    cloud.status === 'unavailable'
      ? h('p', { class: 'note warn' }, 'Sign-in could not load. Check your connection and reload the page.')
      : h('button', { class: 'btn google-btn gate-btn', onclick: doSignIn, html: GOOGLE_G + '<span>Sign in with Google</span>' }),
    h('p', { class: 'muted small' }, 'For WMU Sky Broncos team members.')));
}
function restrictedPage() {
  clear(app).append(h('section', { class: 'gate-page' },
    h('img', { class: 'gate-logo small', src: 'img/skybroncos_128.png', alt: '' }),
    h('p', { class: 'gate-msg', role: 'alert' }, 'Access restricted, you’re not supposed to be here.'),
    h('button', { class: 'btn', onclick: doSignOut }, 'Sign out')));
}
function checkingPage(msg = 'Checking access…') {
  clear(app).append(h('div', { class: 'loader', role: 'status' }, h('span', {}, msg)));
}
function noContentPage() {
  clear(app).append(h('section', { class: 'panel narrow' }, h('h1', {}, 'Almost ready'),
    h('p', {}, 'The question banks have not been uploaded yet. An admin needs to upload them from the Admin page.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: doSignOut }, 'Sign out'))));
}

let adminFlash = null;   // survives the re-render that follows a content upload
async function adminPage() {
  if (!cloud.admin) { clear(app).append(h('section', { class: 'panel narrow' }, h('h1', {}, 'Admins only'), h('a', { href: '#/' }, 'Home'))); return; }
  const msg = h('p', { class: 'form-msg', role: 'status' });
  const say = (t, ok = true) => { msg.className = 'form-msg' + (ok ? ' ok' : ''); msg.textContent = t; };
  if (adminFlash) { say(adminFlash); adminFlash = null; }
  let acc = { allowed: [], admins: [], seeded: false };
  try { acc = await listAccess(); } catch (e) { say('Could not read the access list: ' + (e.message || e), false); }
  const meta = cloud.contentMeta;
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const bar = h('div', { class: 'fuse', hidden: true }, h('div', { class: 'fuse-fill', style: { width: '0%' } }));
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try {
      bar.hidden = false; say('Reading ' + f.name + '…');
      const bundle = JSON.parse(await f.text());
      adminFlash = 'Content uploaded. Everyone approved can now use the site.';
      await uploadBundle(bundle, (d, n) => { bar.firstChild.style.width = (100 * d / n) + '%'; say(`Uploading ${d} / ${n}…`); });
      if (adminFlash) { say(adminFlash); adminFlash = null; }
      if (location.hash !== '#/admin') location.hash = '#/admin';
    } catch (e) { adminFlash = null; say(e.message || String(e), false); }
    file.value = '';
  });
  const emailIn = h('input', { type: 'text', placeholder: 'name@example.com', autocomplete: 'off', 'aria-label': 'Email to allow' });
  const adminIn = h('input', { type: 'text', placeholder: 'name@example.com', autocomplete: 'off', 'aria-label': 'Email to make admin' });
  const act = (fn, ok) => async () => { try { await fn(); say(typeof ok === 'function' ? ok() : ok); acc = await listAccess(); drawLists(); } catch (e) { say(e.message || String(e), false); } };
  const lists = h('div', {});
  function drawLists() {
    const me = (cloud.user?.email || '').toLowerCase();
    clear(lists).append(
      h('h2', {}, 'Allowed people'),
      h('p', { class: 'muted small' }, 'Only these Google accounts can use the site (admins are always allowed).'),
      h('ul', { class: 'access-list' }, acc.allowed.map(e => h('li', {}, h('span', { class: 'mono' }, e), acc.admins.includes(e) ? h('span', { class: 'tag' }, 'admin') : null,
        e === me ? h('span', { class: 'muted small' }, ' (you)') : h('button', { class: 'btn small danger-btn', onclick: act(() => setAllowed(e, false), `Removed ${e}.`) }, 'Remove')))),
      h('div', { class: 'add-row' }, emailIn, h('button', { class: 'btn primary small', onclick: act(() => setAllowed(emailIn.value, true), () => `Allowed ${emailIn.value.trim().toLowerCase()}.`) }, 'Allow')),
      h('h2', {}, 'Admins'),
      h('p', { class: 'muted small' }, 'Admins can change this list and upload content.'),
      h('ul', { class: 'access-list' }, acc.admins.map(e => h('li', {}, h('span', { class: 'mono' }, e),
        e === me ? h('span', { class: 'muted small' }, ' (you)') : h('button', { class: 'btn small danger-btn', onclick: act(() => setAdmin(e, false), `${e} is no longer an admin.`) }, 'Remove admin')))),
      h('div', { class: 'add-row' }, adminIn, h('button', { class: 'btn primary small', onclick: act(() => setAdmin(adminIn.value, true), () => `${adminIn.value.trim().toLowerCase()} is now an admin.`) }, 'Make admin')));
  }
  drawLists();
  clear(app).append(h('section', { class: 'panel admin-page' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › Admin'),
    h('h1', {}, 'Admin'),
    msg,
    h('h2', {}, 'Content'),
    meta ? h('p', {}, 'Uploaded ', h('b', {}, new Date(meta.uploaded_at).toLocaleString()), meta.by ? ` by ${meta.by}` : '', ` · build ${meta.version} · ${meta.files} files.`)
      : h('p', { class: 'note warn' }, acc.seeded ? 'No content uploaded yet.' : 'First-time setup: upload private/content-bundle.json. This also adds the starting list of allowed people.'),
    h('p', { class: 'muted small' }, 'Upload private/content-bundle.json from the project folder (made by tools/build_site.py). It replaces the question banks, answers and test data that approved people can read.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => file.click() }, '⬆ Upload content bundle…'), file),
    bar,
    h('div', { class: 'rwy-divider', 'aria-hidden': 'true' }),
    lists));
}

// ------------------------------------------------------------------ router
const routes = [
  [/^#?\/?$/, () => home()],
  [/^#\/progress$/, () => progressPage()],
  [/^#\/admin$/, () => adminPage()],
  [/^#\/account$/, () => { location.replace('#/progress'); }],
  [/^#\/test\/(\d{4})$/, m => fullTestCover(app, +m[1])],
  [/^#\/test\/(\d{4})\/run$/, m => fullTestRun(app, +m[1], ctx)],
  [/^#\/debrief\/([\w-]+)$/, m => debrief(app, m[1])],
  [/^#\/knowledge$/, () => knowledgeSetup(app)],
  [/^#\/knowledge\/(scan|ppl)$/, m => knowledgeSetup(app, m[1])],
  [/^#\/knowledge\/(scan|ppl)\/study$/, m => knowledgeStudy(app, ctx, m[1])],
  [/^#\/knowledge\/(scan|ppl)\/drill$/, m => knowledgeDrill(app, ctx, m[1])],
  [/^#\/knowledge\/(study|drill)$/, m => { location.replace(`#/knowledge/scan/${m[1]}`); }],
  [/^#\/ppl(?:\/(study|drill))?$/, m => { location.replace(m[1] ? `#/knowledge/ppl/${m[1]}` : '#/knowledge/ppl'); }],
  [/^#\/legs$/, () => legYears(app)],
  [/^#\/legs\/(\d{4})$/, m => legList(app, +m[1])],
  [/^#\/legs\/(\d{4})\/(\w+)$/, m => legRun(app, +m[1], m[2], ctx)],
];

let lastGate = '';
async function route() {
  for (const fn of leaveFns) try { fn(); } catch (e) { console.error(e); }
  leaveFns = [];
  const hash = location.hash || '#/';
  // ---- access gate: nothing but the landing page until signed in and approved
  if (!cloud.ready) { setGate('checking'); checkingPage('Starting engine…'); drawAccount(); return; }
  if (!cloud.user) { setGate('out'); drawAccount(); landingPage(); return; }
  if (cloud.access === 'checking' || cloud.access === 'unknown') { setGate('checking'); drawAccount(); checkingPage(); return; }
  if (cloud.access === 'denied') { setGate('restricted'); drawAccount(); restrictedPage(); return; }
  if (cloud.access === 'error') { setGate('restricted'); drawAccount();
    clear(app).append(h('section', { class: 'panel narrow' }, h('p', {}, cloud.error || 'Could not check access.'), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again'), h('button', { class: 'btn', onclick: doSignOut }, 'Sign out')))); return; }
  setGate('in');
  if (!cloud.contentMeta && hash !== '#/admin') { drawAccount(); if (cloud.admin) { location.hash = '#/admin'; return; } noContentPage(); return; }
  document.body.dataset.route = /\/drill$/.test(hash) ? 'drill' : (hash.split('/')[1] || 'home');
  drawAccount();
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(m); const first = app.firstElementChild; if (first) { first.classList.remove('page-enter'); void first.offsetWidth; first.classList.add('page-enter'); } } catch (e) { console.error(e); clear(app).append(h('div', { class: 'panel' }, h('h2', {}, 'Something went wrong'), h('pre', {}, String(e.stack || e)), h('a', { href: '#/' }, 'Home'))); }
      window.scrollTo(0, 0);
      return;
    }
  }
  clear(app).append(h('p', { class: 'panel' }, 'Not found. ', h('a', { href: '#/' }, 'Home')));
}
window.addEventListener('hashchange', route);
// re-route when the sign-in / access state changes (not on every sync status change)
onCloud(() => {
  const g = [cloud.ready, cloud.user?.uid, cloud.access, cloud.admin, cloud.contentMeta?.version].join('|');
  if (g !== lastGate) { lastGate = g; route(); }
});
window.addEventListener('scan-storage-full', () => alert('This browser is out of storage space for SCAN Prep. Export a backup from My progress, then erase old results.'));
route();
initCloud();
