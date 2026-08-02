// Thin wrapper around the JSON REST API. All calls return parsed JSON
// or throw an Error with a friendly message.
//
// The API base URL is read from window.ZNP_CONFIG (set by /config.js).
// This lets us deploy the frontend to Firebase Hosting and point it at a
// completely different backend host (e.g. Railway) without a rebuild.

const BASE =
  (typeof window !== 'undefined' &&
    window.ZNP_CONFIG &&
    window.ZNP_CONFIG.apiBase) ||
  '/api';

async function call(method, path, body) {
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
    const e = new Error((data && data.error) || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  register: (upiId, deviceId) =>
    call('POST', '/auth/register', { upiId, deviceId }),
  lookup: (deviceId) =>
    call('GET', '/auth/lookup?deviceId=' + encodeURIComponent(deviceId)),
  createLoadOrder: (userId, amount) =>
    call('POST', '/load/create', { userId, amount }),
  confirmLoad: (orderId) => call('POST', '/load/confirm', { orderId }),
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
};
