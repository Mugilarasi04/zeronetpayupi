// Thin wrapper around the JSON REST API.
//
// The API base URL is read from window.ZNP_CONFIG (set by /config.js).
// This lets us deploy the frontend to Cloudflare Pages and point it at a
// completely different backend host (Render / Railway / etc.) without a rebuild.
//
// Silent re-registration: Render's free tier wipes SQLite on restart.
// When any user-scoped endpoint returns "user not found", we quietly
// re-register the device with the UPI ID stored in localStorage and
// retry the original call. The user never sees a popup. If retry also
// fails, we throw a normal error so the caller can decide what to do.

const BASE =
  (typeof window !== 'undefined' &&
    window.ZNP_CONFIG &&
    window.ZNP_CONFIG.apiBase) ||
  '/api';

async function rawCall(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch (err) {
    const e = new Error('offline');
    e.code = 'offline';
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = (data && data.error) || `HTTP ${res.status}`;
    const e = new Error(err);
    e.status = res.status;
    e.body = data;
    throw e;
  }
  return data;
}

function isMissingUserError(err) {
  if (!err) return false;
  if (err.status !== 404 && err.status !== 400 && err.status !== 401) return false;
  const msg = String(err.message || '');
  return /user.*not.*found|receiver.*not.*found|invalid.*user|no.*such.*user/i.test(msg);
}

async function silentReRegister() {
  // Read stashed identity from localStorage.
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem('znp.user') || 'null');
  } catch (_) { /* ignore */ }
  if (!stored || !stored.upiId || !stored.deviceId) return null;
  try {
    const r = await rawCall('POST', '/auth/register', {
      upiId: stored.upiId,
      deviceId: stored.deviceId,
    });
    if (r && r.user) {
      // The server assigned a new id — update localStorage.
      localStorage.setItem('znp.user', JSON.stringify(r.user));
      if (window.ZNP && window.ZNP.state) window.ZNP.state.user = r.user;
      return r.user;
    }
  } catch (_) { /* fall through */ }
  return null;
}

async function call(method, path, body) {
  try {
    return await rawCall(method, path, body);
  } catch (err) {
    if (!isMissingUserError(err)) throw err;

    // Server doesn't know this user — probably a Render restart wiped the DB.
    // Silently re-register with the stashed UPI + device fingerprint, then
    // retry once with the new user id patched into the body if needed.
    const newUser = await silentReRegister();
    if (!newUser) throw err;

    // If the body references an old userId / receiverId, swap it for the new one.
    let retryBody = body;
    if (body && typeof body === 'object') {
      retryBody = { ...body };
      if ('userId' in retryBody) retryBody.userId = newUser.id;
      if ('receiverId' in retryBody) retryBody.receiverId = newUser.id;
    }
    try {
      return await rawCall(method, path, retryBody);
    } catch (retryErr) {
      throw retryErr;
    }
  }
}

export const api = {
  register: (upiId, deviceId, phone) =>
    call('POST', '/auth/register', { upiId, deviceId, phone }),
  lookup: (deviceId) =>
    call('GET', '/auth/lookup?deviceId=' + encodeURIComponent(deviceId)),
  createLoadOrder: (userId, amount) =>
    call('POST', '/load/create', { userId, amount }),
  confirmLoad: (orderId, proofDataUrl) =>
    call('POST', '/load/confirm', { orderId, proofDataUrl }),
  loadStatus: (orderId) => call('GET', '/load/status/' + orderId),
  redeem: (receiverId, tokens, senderDevice) =>
    call('POST', '/redeem', { receiverId, tokens, senderDevice }),
  preflight: (tokens) => call('POST', '/preflight', { tokens }),
  audit: () => call('GET', '/audit'),
  health: () => call('GET', '/health'),
  history: (userId) => call('GET', '/user/' + userId + '/history'),
  getSettings: () => call('GET', '/settings'),
  saveSettings: (data) => call('PUT', '/settings', data),
  pendingDisbursements: () => call('GET', '/disburse/pending'),
  markDisbursed: (id, ref) => call('POST', `/disburse/${id}/mark-paid`, { ref }),
  unmarkDisbursed: (id) => call('POST', `/disburse/${id}/unmark`),
  myCashouts: (receiverId) => call('GET', `/disburse/mine/${receiverId}`),
  raiseComplaint: (id, note) => call('POST', `/disburse/${id}/complaint`, { note }),
  confirmReceived: (id, receiverId, ref) =>
    call('POST', `/disburse/${id}/confirm-received`, { receiverId, ref }),
  createPairCode: (payload) => call('POST', '/pair/create', { payload }),
  fetchPairCode: (code) => call('GET', `/pair/${code}`),
  consumePairCode: (code) => call('DELETE', `/pair/${code}`),
};
