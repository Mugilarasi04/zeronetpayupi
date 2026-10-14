// Thin re-export so legacy call sites `import { store } from './store.js'`
// transparently go through the AES-GCM-at-rest secure store.
//
// The old plaintext IndexedDB implementation lived here until v27. The
// migration is forward-only: on first run after upgrade, any plaintext
// rows in the 'tokens' store are returned by listTokens() (secure-store
// detects them via !row._enc && !row._plain and treats them as plain),
// then on the next addTokens() they're overwritten with ciphertext.

export { store } from './secure-store.js';
