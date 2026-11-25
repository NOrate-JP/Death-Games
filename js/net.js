// 通信層：Firebase Realtime Database（匿名ログイン） / オフライン練習用のローカル実装
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
let fb = null; // { db, uid, api }

export function firebaseConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR_');
}

export async function initFirebase() {
  if (fb) return fb;
  const [{ initializeApp }, auth, db] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-database.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  const cred = await auth.signInAnonymously(a);
  fb = { db: db.getDatabase(app), uid: cred.user.uid, api: db };
  return fb;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const genCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

// 共通インターフェース
// subscribe(cb) / unsubscribe() / setMember(uid,data) / updateMember(uid,patch) / removeMember(uid)
// updateSettings(patch) / updateMeta(patch) / setGame(obj|null) / transactGame(fn) / now()

export class FirebaseRoom {
  constructor(code) { this.code = code; this.f = fb; this.api = fb.api; this.offset = 0; }
  r(p = '') { return this.api.ref(this.f.db, `rooms/${this.code}${p ? '/' + p : ''}`); }

  static async create(meta, settings) {
    const f = await initFirebase();
    for (let i = 0; i < 20; i++) {
      const code = genCode();
      const snap = await f.api.get(f.api.ref(f.db, `rooms/${code}/meta`));
      if (snap.exists()) continue;
      await f.api.set(f.api.ref(f.db, `rooms/${code}`), { meta: { ...meta, createdAt: Date.now() }, settings });
      return new FirebaseRoom(code);
    }
    throw new Error('部屋コードを作れませんでした');
  }
  static async open(code) {
    const f = await initFirebase();
    const snap = await f.api.get(f.api.ref(f.db, `rooms/${code}/meta`));
    if (!snap.exists()) throw new Error('部屋が見つかりません');
    return new FirebaseRoom(code);
  }
  get uid() { return this.f.uid; }
  subscribe(cb) {
    this._u = this.api.onValue(this.r(), (snap) => cb(snap.val()));
    this._o = this.api.onValue(this.api.ref(this.f.db, '.info/serverTimeOffset'), (s) => { this.offset = s.val() || 0; });
  }
  unsubscribe() { this._u && this._u(); this._o && this._o(); }
  now() { return Date.now() + this.offset; }
  async setMember(uid, data) {
    await this.api.set(this.r(`members/${uid}`), data);
    if (uid === this.uid) {
      const od = this.api.onDisconnect(this.r(`members/${uid}/online`));
      await od.set(false);
      this._conn = this.api.onValue(this.api.ref(this.f.db, '.info/connected'), (s) => {
        if (s.val()) { this.api.set(this.r(`members/${uid}/online`), true).catch(() => {}); this.api.onDisconnect(this.r(`members/${uid}/online`)).set(false); }
      });
    }
  }
  updateMember(uid, patch) { return this.api.update(this.r(`members/${uid}`), patch); }
  removeMember(uid) { return this.api.remove(this.r(`members/${uid}`)); }
  updateSettings(patch) { return this.api.update(this.r('settings'), patch); }
  updateMeta(patch) { return this.api.update(this.r('meta'), patch); }
  setGame(obj) { return this.api.set(this.r('game'), obj ? { json: JSON.stringify(obj), eid: obj.eid } : null); }
  async transactGame(fn) {
    let ok = false;
    await this.api.runTransaction(this.r('game'), (cur) => {
      if (!cur || !cur.json) return cur;
      let m;
      try { m = fn(JSON.parse(cur.json)); } catch (e) { console.warn('[tx abort]', e.message); return; }
      if (!m) return;
      ok = true;
      return { json: JSON.stringify(m), eid: m.eid };
    });
    return ok;
  }
  leave() { this._conn && this._conn(); return this.removeMember(this.uid).catch(() => {}); }
}

// ---- オフライン（CPU練習） ----
export class LocalRoom {
  constructor(meta, settings) {
    this.code = 'LOCAL';
    this.data = { meta: { ...meta, createdAt: Date.now() }, settings, members: {}, game: null };
    this.cbs = [];
    this._uid = 'me_' + Math.random().toString(36).slice(2, 8);
  }
  get uid() { return this._uid; }
  emit() { const snap = JSON.parse(JSON.stringify(this.data)); setTimeout(() => this.cbs.forEach((cb) => cb(snap)), 0); }
  subscribe(cb) { this.cbs.push(cb); this.emit(); }
  unsubscribe() { this.cbs = []; }
  now() { return Date.now(); }
  async setMember(uid, d) { this.data.members[uid] = d; this.emit(); }
  async updateMember(uid, p) { Object.assign(this.data.members[uid] || {}, p); this.emit(); }
  async removeMember(uid) { delete this.data.members[uid]; this.emit(); }
  async updateSettings(p) {
    for (const [k, v] of Object.entries(p)) {
      const ks = k.split('/'); let o = this.data.settings;
      ks.slice(0, -1).forEach((x) => { o = o[x] = o[x] || {}; });
      o[ks[ks.length - 1]] = v;
    }
    this.emit();
  }
  async updateMeta(p) { Object.assign(this.data.meta, p); this.emit(); }
  async setGame(obj) { this.data.game = obj ? { json: JSON.stringify(obj), eid: obj.eid } : null; this.emit(); }
  async transactGame(fn) {
    const cur = this.data.game; if (!cur) return false;
    let m;
    try { m = fn(JSON.parse(cur.json)); } catch (e) { console.warn('[tx abort]', e.message); return false; }
    if (!m) return false;
    this.data.game = { json: JSON.stringify(m), eid: m.eid }; this.emit();
    return true;
  }
  leave() {}
}
