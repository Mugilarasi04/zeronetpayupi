// Background sync of submitted load orders.
//
// When Alice submits her UTR, we record the order id in localStorage. A
// background poller (started by app.js) walks every pending order every
// 15s and when Bob confirms it, pulls the newly-minted tokens into the
// wallet — even if Alice closed the Load view, backgrounded the tab,
// or opened the app fresh an hour later.
//
// Nothing here is user-facing by itself; views read `getPendingLoadOrders()`
// to surface a "N loads waiting" tile on home.

import { api } from './api.js';
import { store } from './store.js';
import { toast, rupeesPlain, uuid } from './util.js';

const KEY = 'znp.pendingLoads';

function readList() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch (_) {
    return [];
  }
}
function writeList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {}
}

export function addPendingLoadOrder(entry) {
  const list = readList();
  if (list.find((x) => x.orderId === entry.orderId)) return; // dedupe
  list.push({
    orderId: entry.orderId,
    amount: entry.amount,
    escrowUpiId: entry.escrowUpiId,
    utr: entry.utr,
    submittedAt: entry.submittedAt || Date.now(),
  });
  writeList(list);
}

export function getPendingLoadOrders() {
  return readList();
}

export function removePendingLoadOrder(orderId) {
  writeList(readList().filter((x) => x.orderId !== orderId));
}

// Walk every pending-locally load order. For each, hit /load/status.
//   completed → add tokens, add ledger, remove from list, toast
//   rejected  → remove from list, toast
//   other     → leave as-is
// Returns a summary {imported, rejected, stillWaiting} the caller can log.
export async function syncLoadOrders() {
  const list = readList();
  if (!list.length) return { imported: 0, rejected: 0, stillWaiting: 0 };

  let imported = 0, rejected = 0, stillWaiting = 0;
  for (const entry of list) {
    let s;
    try {
      s = await api.loadStatus(entry.orderId);
    } catch (_) { /* offline — try again next tick */ stillWaiting++; continue; }

    if (s.status === 'completed') {
      // Guard against replaying: once we've imported, remove from list.
      if (s.tokens && s.tokens.length) {
        try {
          await store.addTokens(s.tokens);
          await store.addLedger({
            id: uuid(),
            ts: Date.now(),
            kind: 'load',
            amount: entry.amount,
            ref: entry.orderId,
            note: 'Loaded ' + rupeesPlain(entry.amount * 100) +
                  ' to ' + entry.escrowUpiId +
                  (s.utr ? ' (UTR ' + s.utr + ')' : ''),
          });
        } catch (e) {
          console.warn('[loadsync] addTokens failed', e);
          // Don't remove from list — try again next tick.
          continue;
        }
      }
      removePendingLoadOrder(entry.orderId);
      imported++;
      toast(
        '✓ ' + rupeesPlain(entry.amount * 100) + ' confirmed by ' + entry.escrowUpiId,
        'good',
      );
    } else if (s.status === 'rejected') {
      removePendingLoadOrder(entry.orderId);
      rejected++;
      toast(
        '✗ Load rejected by ' + entry.escrowUpiId +
          (s.rejectionReason ? ' — ' + s.rejectionReason : ''),
        'bad',
      );
    } else {
      stillWaiting++;
    }
  }
  return { imported, rejected, stillWaiting };
}
