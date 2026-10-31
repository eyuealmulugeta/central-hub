// Thin adapter over Firebase (Auth + Firestore). The store talks only to this
// small interface, so tests can swap in an in-memory fake. The SDK is loaded
// from Google's CDN on demand; nothing here runs when the app is in local mode.

const VERSION = '10.12.2';
const sdk = name => import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-${name}.js`);
const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch

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
    /** Google sign-in. Everyone stays signed in on their device until Sign out (v0.23.2). */
    async signIn() {
      await A.setPersistence(auth, A.browserLocalPersistence);
      return A.signInWithPopup(auth, new A.GoogleAuthProvider());
    },
    signOut: () => A.signOut(auth),
    /** Fetch a fresh sign-in token. One issued the moment an address was confirmed can still say "not confirmed". */
    refresh: async () => { await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); },
    /** v0.24.0: email and password, in place of the activation link. */
    async signInPassword(email, password) {
      await A.setPersistence(auth, A.browserLocalPersistence);
      return A.signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    },
    /** First time: make the password, then the address is confirmed by the email Firebase sends. */
    async createPassword(email, password) {
      await A.setPersistence(auth, A.browserLocalPersistence);
      const cred = await A.createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await A.sendEmailVerification(cred.user, { url: location.origin + location.pathname });
      return cred;
    },
    /** The confirmation email again, for the person signed in now. */
    sendConfirm: () => A.sendEmailVerification(auth.currentUser, { url: location.origin + location.pathname }),
    /** Forgotten password, or an account first made with an activation link: Firebase emails a link to set one. */
    resetPassword: email => A.sendPasswordResetEmail(auth, email.trim().toLowerCase(), { url: location.origin + location.pathname }),

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
