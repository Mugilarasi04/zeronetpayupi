// Background sync for escrow-relationship status changes.
//
// When Alice sends an escrow request to Bob, we remember the request id
// in localStorage. The next time the app polls, if Bob has approved or
// rejected it, we toast Alice (whatever screen she's on) and clear the
// local marker. This closes the "I sent the request and nothing seems
// to happen" UX gap.

import { api } from './api.js';
import { toast } from './util.js';

const KEY = 'znp.pendingEscrowRequests';

function readList() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}
function writeList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function addPendingEscrowRequest(entry) {
  const list = readList();
  if (list.find((x) => x.id === entry.id)) return;
  list.push({
    id: entry.id,
    escrowUpiId: entry.escrowUpiId,
    escrowPhone: entry.escrowPhone,
    requestedAt: entry.requestedAt || Date.now(),
  });
  writeList(list);
}

export function removePendingEscrowRequest(id) {
  writeList(readList().filter((x) => x.id !== id));
}

export function getPendingEscrowRequests() { return readList(); }

// Poll the user's outgoing escrow requests; if any marked-local request
// has transitioned to approved/rejected, toast and remove it.
export async function syncEscrowRequests(userId) {
  const local = readList();
  if (!local.length) return { changed: 0 };

  let rows;
  try {
    const r = await api.escrowOutgoing(userId);
    rows = r.rows || [];
  } catch (_) {
    return { changed: 0 };
  }

  let changed = 0;
  for (const entry of local) {
    const row = rows.find((r) => r.id === entry.id);
    if (!row) {
      // Server lost the row (DB wipe) — drop the local marker silently.
      removePendingEscrowRequest(entry.id);
      continue;
    }
    if (row.status === 'approved') {
      removePendingEscrowRequest(entry.id);
      changed++;
      toast('✓ ' + (entry.escrowUpiId || row.escrow_upi) + ' approved you — they are now your escrow', 'good');
    } else if (row.status === 'rejected') {
      removePendingEscrowRequest(entry.id);
      changed++;
      toast('✗ ' + (entry.escrowUpiId || row.escrow_upi) + ' rejected your escrow request', 'bad');
    } else if (row.status === 'revoked') {
      removePendingEscrowRequest(entry.id);
    }
    // else still 'requested' — leave as-is, try again next tick
  }
  return { changed };
}
