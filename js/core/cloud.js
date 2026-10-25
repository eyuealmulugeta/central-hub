// Thin adapter over Firebase (Auth + Firestore). The store talks only to this
// small interface, so tests can swap in an in-memory fake. The SDK is loaded
// from Google's CDN on demand; nothing here runs when the app is in local mode.

const VERSION = '10.12.2';
const sdk = name => import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-${name}.js`);
const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch
const LINK_KEY = 'sf:link';        // the address an activation link was asked for, and when
const LINK_MS = 5 * 60 * 1000;     // an activation link is accepted for five minutes

export async function connectCloud(config) {
  const [{ initializeApp }, A, F] = await Promise.all([sdk('app'), sdk('auth'), sdk('firestore')]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);

  // Offline cache: reads work without signal and writes queue until it returns.
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    db = F.getFirestore(app);
  }
  const ref = path => F.doc(db, path);

  return {
    onUser(fn) {
      return A.onAuthStateChanged(auth, u => fn(u ? { email: (u.email || '').toLowerCase(), name: u.displayName || u.email || '', verified: u.emailVerified === true, via: u.providerData.map(p => p.providerId).join(', ') } : null));
    },
    /** stay = true remembers the sign-in on this device; false only until the browser tab is closed. */
    async signIn(stay = true) {
      await A.setPersistence(auth, stay ? A.browserLocalPersistence : A.browserSessionPersistence);
      return A.signInWithPopup(auth, new A.GoogleAuthProvider());
    },
    signOut: () => A.signOut(auth),
    /** Fetch a fresh sign-in token. One issued the moment an address was confirmed can still say "not confirmed". */
    refresh: async () => { await auth.currentUser?.getIdToken(true); },
    /** Email an activation link to the address. It signs in the browser that asked for it. */
    async sendLink(email, stay = true) {
      email = email.trim().toLowerCase();
      await A.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
      localStorage.setItem(LINK_KEY, JSON.stringify({ email, at: Date.now(), stay }));
    },
    /**
     * If the page was opened from an activation link, finish the sign-in.
     * Returns null (not a link), 'ok', 'expired' (older than five minutes) or 'other' (not asked from this browser).
     */
    async finishLink() {
      const href = location.href;
      if (!A.isSignInWithEmailLink(auth, href)) return null;
      history.replaceState(null, '', location.pathname);   // the code in the address is used once
      let asked = null;
      try { asked = JSON.parse(localStorage.getItem(LINK_KEY)); } catch { /* treated as not asked from here */ }
      localStorage.removeItem(LINK_KEY);
      if (!asked?.email) return 'other';
      if (Date.now() - asked.at > LINK_MS) return 'expired';
      await A.setPersistence(auth, asked.stay === false ? A.browserSessionPersistence : A.browserLocalPersistence);
      await A.signInWithEmailLink(auth, asked.email, href);
      return 'ok';
    },

    async get(path) { const snap = await F.getDoc(ref(path)); return snap.exists() ? snap.data() : null; },
    set: (path, data) => F.setDoc(ref(path), data),
    remove: path => F.deleteDoc(ref(path)),
    async list(path) { return (await F.getDocs(F.collection(db, path))).docs.map(d => d.data()); },

    /** ops: [{ path, data }], data null = delete */
    async batch(ops) {
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const b = F.writeBatch(db);
        for (const op of ops.slice(i, i + BATCH_LIMIT)) op.data === null ? b.delete(ref(op.path)) : b.set(ref(op.path), op.data);
        // not awaited one by one while offline: commits resolve only once the server confirms
        const commit = b.commit();
        if (i + BATCH_LIMIT < ops.length) await commit; else return commit;
      }
    },

    /** Call a server function (functions/index.js, europe-west1) with this person's sign-in. Loaded on first use. */
    async call(name, data) {
      const Fn = await sdk('functions');
      return (await Fn.httpsCallable(Fn.getFunctions(app, 'europe-west1'), name)(data)).data;
    },

    watchDoc: (path, fn, onError) => F.onSnapshot(ref(path), snap => fn(snap.exists() ? snap.data() : null), onError),
    /** `where` = [field, op, value] limits the collection; the rules need it for records only some people may read. */
    watchCol: (path, fn, onError, where) => F.onSnapshot(where ? F.query(F.collection(db, path), F.where(...where)) : F.collection(db, path), snap => fn(snap.docs.map(d => d.data())), onError),
  };
}
