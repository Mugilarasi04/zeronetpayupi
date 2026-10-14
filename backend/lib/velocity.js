// In-memory sliding-window velocity caps on redemption.
//
// Max redeems/min per sender device, max rupees/24h per receiver user,
// and max tokens-per-call. Returns a plain {ok, reason, retryAfter}
// shape so callers can forward it as a 429.
//
// For a horizontally-scaled production backend this would be backed by
// Redis — one in-memory map per container is fine for Render single-node.

const WINDOW_MIN = 60_000;
const WINDOW_DAY = 24 * 60 * 60 * 1000;

const MAX_PER_MIN_PER_DEVICE   = 10;         // redeem calls / minute / device
const MAX_PER_DAY_PER_USER     = 10_000_00;  // paise = ₹10,000 / 24h / user
const MAX_TOKENS_PER_CALL      = 500;        // hard cap on batch size

const perDevice = new Map(); // deviceId -> [ts, ts, ...] (last minute)
const perUser   = new Map(); // userId -> [{ts, paise}, ...] (last 24h)

function prune(arr, cutoff) {
  while (arr.length && arr[0] < cutoff) arr.shift();
}
function pruneObj(arr, cutoff) {
  while (arr.length && arr[0].ts < cutoff) arr.shift();
}

function check({ deviceId, userId, tokenCount, totalPaise }) {
  const now = Date.now();

  if (tokenCount > MAX_TOKENS_PER_CALL) {
    return {
      ok: false,
      reason: 'batch_too_large',
      message: `Max ${MAX_TOKENS_PER_CALL} tokens per redemption; split into smaller batches.`,
      retryAfter: 1,
    };
  }

  if (deviceId) {
    const arr = perDevice.get(deviceId) || [];
    prune(arr, now - WINDOW_MIN);
    if (arr.length >= MAX_PER_MIN_PER_DEVICE) {
      const retry = Math.max(1, Math.ceil((WINDOW_MIN - (now - arr[0])) / 1000));
      return {
        ok: false,
        reason: 'device_rate',
        message: `This device has made too many redemptions in the last minute. Retry in ${retry}s.`,
        retryAfter: retry,
      };
    }
  }

  if (userId) {
    const arr = perUser.get(userId) || [];
    pruneObj(arr, now - WINDOW_DAY);
    const sum = arr.reduce((s, x) => s + x.paise, 0);
    if (sum + totalPaise > MAX_PER_DAY_PER_USER) {
      return {
        ok: false,
        reason: 'daily_cap',
        message: `Daily cash-out cap of ₹${MAX_PER_DAY_PER_USER / 100} reached. Spent ₹${sum / 100} in last 24h.`,
        retryAfter: 3600,
      };
    }
  }

  return { ok: true };
}

function record({ deviceId, userId, totalPaise }) {
  const now = Date.now();
  if (deviceId) {
    const arr = perDevice.get(deviceId) || [];
    arr.push(now);
    prune(arr, now - WINDOW_MIN);
    perDevice.set(deviceId, arr);
  }
  if (userId) {
    const arr = perUser.get(userId) || [];
    arr.push({ ts: now, paise: totalPaise });
    pruneObj(arr, now - WINDOW_DAY);
    perUser.set(userId, arr);
  }
}

module.exports = {
  check,
  record,
  MAX_PER_MIN_PER_DEVICE,
  MAX_PER_DAY_PER_USER,
  MAX_TOKENS_PER_CALL,
};
