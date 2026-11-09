// Sign-in with Google, access control, protected content and cloud sync (Firebase Auth + Realtime Database).
//
// ACCESS: the site is usable only by approved emails (access/allowed, access/admins in the database; enforced by the
// security rules in firebase/database.rules.json). Question banks, answers, explanations, test data and the image key
// live under content/ in the database and are readable only by approved users.
//
// PROGRESS: localStorage stays the working copy and every change is also written to
//   users/<uid>/kv/<key>       {v: JSON string, t: ms}   bookmarks, badges, Drill bests, marks, leg progress, ...
//   users/<uid>/results/<id>   {v: JSON string, t: ms}   one row per result (test, leg, Knowledge, Drill)
//   users/<uid>/details/<id>   {v: JSON string, t: ms}   graded debrief of a Full Test / timed leg
// On sign-in, whatever is in this browser is merged into the account (nothing is lost); on sign-out the account's
// copy is removed from this browser (it stays in the account), so a shared computer doesn't show it to the next person.
import { firebaseConfig, FIREBASE_SDK } from './firebase-config.js';
import { store, setSyncHook, keyStamp, rawSet, rawDel, mergeKey } from './util.js';

export const cloud = { user: null, status: 'off', error: null, listeners: [], ready: false,
  access: 'unknown',   // unknown | checking | approved | denied | error
  admin: false, contentMeta: null };
const emit = () => { for (const fn of cloud.listeners) try { fn(cloud); } catch (e) { console.error(e); } };
export const onCloud = fn => { cloud.listeners.push(fn); };

let fb = null;       // { app, auth, db, mod: {auth, database} }
let syncing = false, lastPull = 0;
const pending = new Map();   // remote path -> value | null
let flushTimer = null;

// RTDB keys may not contain . $ # [ ] /
const ekey = k => encodeURIComponent(k).replace(/\./g, '%2E');
const dkey = k => decodeURIComponent(k);
const wrap = (v, t) => ({ v: JSON.stringify(v), t: t || Date.now() });
const unwrap = n => { try { return JSON.parse(n.v); } catch { return undefined; } };

async function loadFirebase() {
  if (fb) return fb;
  if (window.__SCAN_FAKE__) { fb = await window.__SCAN_FAKE__.init(); return fb; }  // test harness only
  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`), import(`${FIREBASE_SDK}/firebase-auth.js`), import(`${FIREBASE_SDK}/firebase-database.js`)]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { app, auth: authMod.getAuth(app), db: dbMod.getDatabase(app), A: authMod, D: dbMod };
  return fb;
}

export async function initCloud() {
  try {
    await loadFirebase();
  } catch (e) {
    cloud.status = 'unavailable'; cloud.error = 'Sign-in could not load (offline or blocked).'; cloud.ready = true; emit();
    return;
  }
  setSyncHook(onLocalChange);
  fb.A.onAuthStateChanged(fb.auth, async user => {
    contentCache.clear();
    cloud.user = user ? { uid: user.uid, email: (user.email || '').toLowerCase(), name: user.displayName || user.email || 'Signed in', photo: user.photoURL || null } : null;
    cloud.admin = false; cloud.contentMeta = null;
    if (!user) { cloud.access = 'unknown'; cloud.status = 'off'; cloud.ready = true; emit(); return; }
    cloud.access = 'checking'; cloud.ready = true; emit();
    await checkAccess();
    emit();
    if (cloud.access === 'approved') await syncDown(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cloud.user && Date.now() - lastPull > 30000) syncDown(false);
  });
  window.addEventListener('pagehide', () => { if (pending.size) flush(); });
}

export async function signInGoogle() {
  await loadFirebase();
  const provider = new fb.A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await fb.A.signInWithPopup(fb.auth, provider); }
  catch (e) {
    const code = e.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/popup-blocked') throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
    if (code === 'auth/unauthorized-domain') throw new Error('This website address is not authorized for sign-in yet (Firebase → Authentication → Settings → Authorized domains).');
    if (code === 'auth/operation-not-allowed') throw new Error('Google sign-in is not enabled in the Firebase project (Authentication → Sign-in method → Google).');
    throw new Error(e.message || 'Sign-in failed.');
  }
}

// ---------------------------------------------------------------- access + protected content
export const emailKey = e => String(e || '').trim().toLowerCase().replace(/\./g, ',');
const denied = e => /permission|denied|PERMISSION_DENIED/i.test(String(e && (e.code || e.message || e)));

async function checkAccess() {
  try {
    const meta = await fb.D.get(fb.D.ref(fb.db, 'content/meta'));
    cloud.contentMeta = meta.val();
    cloud.access = 'approved';
  } catch (e) {
    cloud.access = denied(e) ? 'denied' : 'error';
    if (cloud.access === 'error') cloud.error = `Could not check access (${e.code || e.message || e}).`;
    return;
  }
  try { await fb.D.get(fb.D.ref(fb.db, 'access/allowed')); cloud.admin = true; } catch { cloud.admin = false; }
}

const contentCache = new Map();
// one content file (e.g. 'index', '2026/questions', 'ppl', 'tilekey'), parsed; cached for this session
export function getContent(name) {
  if (!contentCache.has(name)) {
    const p = (async () => {
      if (!fb || cloud.access !== 'approved') throw new Error('Sign in with an approved account to load this.');
      const snap = await fb.D.get(fb.D.ref(fb.db, 'content/files/' + name.replace(/\//g, '_')));
      const v = snap.val();
      if (v == null) throw new Error(`Content "${name}" has not been uploaded yet (Admin page).`);
      return name === 'tilekey' ? v : JSON.parse(v);
    })();
    contentCache.set(name, p);
    p.catch(() => contentCache.delete(name));
  }
  return contentCache.get(name);
}

// ---------------------------------------------------------------- admin
export async function listAccess() {
  const [a, b, s] = await Promise.all(['access/allowed', 'access/admins', 'access/seeded'].map(k => fb.D.get(fb.D.ref(fb.db, k))));
  const keys = o => Object.keys(o || {}).filter(k => o[k] === true).map(k => k.replace(/,/g, '.')).sort();
  return { allowed: keys(a.val()), admins: keys(b.val()), seeded: !!s.val() };
}
export async function setAllowed(email, on) {
  const k = emailKey(email);
  if (!/^[^\s@]+@[^\s@]+,[^\s@]+$/.test(k)) throw new Error('Enter a full email address.');
  await fb.D.update(fb.D.ref(fb.db), { [`access/allowed/${k}`]: on ? true : null, ...(on ? {} : { [`access/admins/${k}`]: null }) });
}
export async function setAdmin(email, on) {
  const k = emailKey(email);
  if (!/^[^\s@]+@[^\s@]+,[^\s@]+$/.test(k)) throw new Error('Enter a full email address.');
  if (!on && k === emailKey(cloud.user?.email)) throw new Error('You cannot remove your own admin access.');
  await fb.D.update(fb.D.ref(fb.db), { [`access/admins/${k}`]: on ? true : null, ...(on ? { [`access/allowed/${k}`]: true } : {}) });
}
// upload private/content-bundle.json: every content file, the image key, and (first time) the starting access list
export async function uploadBundle(bundle, onProgress = () => {}) {
  if (!bundle || bundle.format !== 'scan-prep-content' || typeof bundle.files !== 'object' || !bundle.tilekey) throw new Error('That file is not a SCAN Prep content bundle (private/content-bundle.json).');
  const names = Object.keys(bundle.files);
  let done = 0;
  for (const n of names) {
    await fb.D.set(fb.D.ref(fb.db, 'content/files/' + n.replace(/\//g, '_')), bundle.files[n]);
    onProgress(++done, names.length + 1);
  }
  await fb.D.set(fb.D.ref(fb.db, 'content/files/tilekey'), bundle.tilekey);
  await fb.D.set(fb.D.ref(fb.db, 'content/meta'), { version: bundle.version, key_id: bundle.key_id || null, files: names.length, uploaded_at: Date.now(), by: cloud.user?.email || null });
  onProgress(names.length + 1, names.length + 1);
  const seeded = (await fb.D.get(fb.D.ref(fb.db, 'access/seeded'))).val();
  if (!seeded && bundle.access) {
    const up = { 'access/seeded': true };
    for (const e of bundle.access.allowed || []) up[`access/allowed/${emailKey(e)}`] = true;
    for (const e of bundle.access.admins || []) { up[`access/admins/${emailKey(e)}`] = true; up[`access/allowed/${emailKey(e)}`] = true; }
    await fb.D.update(fb.D.ref(fb.db), up);
  }
  contentCache.clear();
  await checkAccess(); emit();
}

export async function signOutGoogle() {
  await flush();
  if (fb) await fb.A.signOut(fb.auth);
  // the account's progress stays in the account; remove its copy from this browser
  for (const k of store.keys()) rawDel(k);
  contentCache.clear();
  cloud.user = null; cloud.status = 'off'; cloud.access = 'unknown'; cloud.admin = false; emit();
}

// ---------------------------------------------------------------- local -> cloud
function onLocalChange(kind, key, value) {
  if (!cloud.user || syncing || cloud.access !== 'approved') return;
  const base = `users/${cloud.user.uid}`;
  if (key === 'results') {
    for (const r of value || []) if (!uploadedResults.has(r.id)) { pending.set(`${base}/results/${ekey(r.id)}`, wrap(r)); uploadedResults.add(r.id); }
  } else if (key.startsWith('detail:')) {
    pending.set(`${base}/details/${ekey(key.slice(7))}`, kind === 'del' ? null : wrap(value));
  } else {
    pending.set(`${base}/kv/${ekey(key)}`, kind === 'del' ? null : wrap(value, keyStamp(key)));
  }
  clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700);
}
const uploadedResults = new Set();

async function flush() {
  clearTimeout(flushTimer); flushTimer = null;
  if (!pending.size || !fb || !cloud.user) return;
  const batch = Object.fromEntries(pending); pending.clear();
  try {
    for (const chunk of chunks(batch, 150)) await fb.D.update(fb.D.ref(fb.db), chunk);
    if (cloud.status !== 'synced') { cloud.status = 'synced'; cloud.error = null; emit(); }
  } catch (e) { fail(e); for (const [k, v] of Object.entries(batch)) if (!pending.has(k)) pending.set(k, v); }
}
function chunks(obj, n) {
  const ent = Object.entries(obj), out = [];
  for (let i = 0; i < ent.length; i += n) out.push(Object.fromEntries(ent.slice(i, i + n)));
  return out;
}
function fail(e) {
  cloud.status = 'error';
  cloud.error = /permission/i.test(String(e && (e.code || e.message)))
    ? 'Cloud sync is blocked by the database security rules. Your progress is still saved in this browser.'
    : `Cloud sync failed (${e.code || e.message || e}). Your progress is still saved in this browser.`;
  emit();
}

// ---------------------------------------------------------------- cloud <-> local merge
// first=true on sign-in: everything in this browser is merged into the account.
export async function syncDown(first = false) {
  if (!cloud.user || !fb || syncing || cloud.access !== 'approved') return;
  syncing = true; cloud.status = 'syncing'; emit();
  const uid = cloud.user.uid, base = `users/${uid}`;
  try {
    const snap = await fb.D.get(fb.D.ref(fb.db, base));
    const remote = snap.val() || {};
    lastPull = Date.now();
    const up = {};
    // results: union by id
    const localRes = store.get('results', []);
    const byId = new Map(localRes.map(r => [r.id, r]));
    for (const [k, n] of Object.entries(remote.results || {})) { const r = unwrap(n); if (r && !byId.has(r.id)) byId.set(r.id, r); uploadedResults.add(dkey(k)); }
    for (const r of localRes) if (!uploadedResults.has(r.id)) { up[`${base}/results/${ekey(r.id)}`] = wrap(r); uploadedResults.add(r.id); }
    const merged = [...byId.values()].sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 500);
    rawSet('results', merged);
    // debrief details: union
    const remoteDet = new Set(Object.keys(remote.details || {}).map(dkey));
    for (const [k, n] of Object.entries(remote.details || {})) { const id = dkey(k); if (store.get('detail:' + id, undefined) === undefined) { const v = unwrap(n); if (v !== undefined) rawSet('detail:' + id, v); } }
    for (const k of store.keys()) if (k.startsWith('detail:') && !remoteDet.has(k.slice(7))) up[`${base}/details/${ekey(k.slice(7))}`] = wrap(store.get(k));
    // everything else: per key (sets are unioned, bests keep the max, otherwise the newer write wins)
    const remoteKv = {};
    for (const [k, n] of Object.entries(remote.kv || {})) remoteKv[dkey(k)] = n;
    const keys = new Set([...Object.keys(remoteKv), ...store.keys().filter(k => k !== 'results' && !k.startsWith('detail:'))]);
    for (const k of keys) {
      const r = remoteKv[k], rv = r ? unwrap(r) : undefined, rt = r ? r.t || 0 : -1;
      const lv = store.get(k, undefined), lt = lv === undefined ? -1 : keyStamp(k);
      if (lv === undefined) { rawSet(k, rv, rt); continue; }
      if (rv === undefined) { up[`${base}/kv/${ekey(k)}`] = wrap(lv, lt || Date.now()); continue; }
      const m = mergeKey(k, lv, lt, rv, rt);
      if (JSON.stringify(m.value) !== JSON.stringify(lv)) rawSet(k, m.value, m.t);
      if (JSON.stringify(m.value) !== JSON.stringify(rv)) up[`${base}/kv/${ekey(k)}`] = wrap(m.value, m.t);
    }
    for (const chunk of chunks(up, 150)) await fb.D.update(fb.D.ref(fb.db), chunk);
    cloud.status = 'synced'; cloud.error = null;
    if (first) window.dispatchEvent(new CustomEvent('scan-cloud-merged'));
    else window.dispatchEvent(new CustomEvent('scan-cloud-updated'));
  } catch (e) { fail(e); }
  finally { syncing = false; emit(); }
}

// erase the signed-in account's progress everywhere (and this browser's copy)
export async function eraseAccount() {
  if (!cloud.user || !fb) return;
  pending.clear();
  await fb.D.remove(fb.D.ref(fb.db, `users/${cloud.user.uid}`));
  uploadedResults.clear();
  for (const k of store.keys()) rawDel(k);
  emit();
}

// Test hook: run the real sync code against an in-memory stand-in for Firebase (used by app/tests/e2e.py).
export const __test = {
  install(fake, user) { fb = fake; cloud.user = user; uploadedResults.clear(); setSyncHook(onLocalChange); },
  flush,
};
