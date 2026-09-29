// Where a restaurant table is in its evening, and what someone should do about it next.
//
// Every table walks the same four steps — Order, Kitchen, Serve, Bill — and a waiter's
// whole job is moving each one forward. The floor used to say only "Occupied ₹1,240",
// which left the waiter to remember, table by table, whether the order had gone in,
// whether the food was up, and whether they were waiting on the bill. This reads it off
// the order itself so every tile can say it out loud.
//
// Pure and import-free so the backend tests can load it as-is.

export const STEPS = ['order', 'kitchen', 'serve', 'bill'];

// How long before a wait is worth flagging. Twenty minutes for food is the point a table
// starts looking round for the waiter; a round still not sent after ten is usually forgotten.
export const LATE_KITCHEN_MINUTES = 20;
export const LATE_UNSENT_MINUTES = 10;

function minutesBetween(from, now) {
  const t = new Date(from).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

/**
 * The stage of one floor table.
 *
 *   free      nobody here — tap to seat
 *   reserved  booked for later
 *   seated    guests sat down, nothing ordered yet — go take the order
 *   ordering  items typed but not sent to the kitchen — send the KOT
 *   cooking   the kitchen has it
 *   ready     food is up at the pass — go and serve it
 *   eating    everything served — the bill is next
 *
 * When a table is in two states at once (dessert typed while the mains are cooking), the
 * one that needs a person soonest wins: food going cold beats an unsent round, which beats
 * food still on the stove.
 */
export function tableStage(order, table, now = Date.now()) {
  if (!order) {
    return { key: table?.reservation ? 'reserved' : 'free', step: -1, counts: null, minutes: 0, late: false };
  }
  const items = order.items || [];
  const counts = { total: items.length, notSent: 0, cooking: 0, ready: 0, served: 0 };
  let oldestCooking = null;
  let oldestReady = null;
  for (const item of items) {
    if (!item.sentToKitchen) counts.notSent += 1;
    else if (item.kitchenStatus === 'ready') {
      counts.ready += 1;
      if (item.firedAt && (!oldestReady || new Date(item.firedAt) < new Date(oldestReady))) oldestReady = item.firedAt;
    } else if (item.kitchenStatus === 'served') counts.served += 1;
    else {
      counts.cooking += 1;
      if (item.firedAt && (!oldestCooking || new Date(item.firedAt) < new Date(oldestCooking))) oldestCooking = item.firedAt;
    }
  }

  let key;
  let minutes;
  let late = false;
  if (counts.total === 0) {
    key = 'seated';
    minutes = minutesBetween(order.createdAt, now);
    late = minutes >= LATE_UNSENT_MINUTES;
  } else if (counts.ready > 0) {
    key = 'ready';
    minutes = oldestReady ? minutesBetween(oldestReady, now) : 0;
  } else if (counts.notSent > 0) {
    key = 'ordering';
    minutes = minutesBetween(order.updatedAt || order.createdAt, now);
    late = minutes >= LATE_UNSENT_MINUTES;
  } else if (counts.cooking > 0) {
    key = 'cooking';
    minutes = oldestCooking ? minutesBetween(oldestCooking, now) : 0;
    late = minutes >= LATE_KITCHEN_MINUTES;
  } else {
    key = 'eating';
    minutes = minutesBetween(order.createdAt, now);
  }

  const step = { seated: 0, ordering: 0, cooking: 1, ready: 2, eating: 3 }[key];
  return { key, step, counts, minutes, late };
}

// How soon a table needs a person — lower is sooner. Food waiting at the pass first
// (it is going cold), then anything running late, then rounds not sent, then tables not
// yet ordered. Free, reserved, eating and on-time cooking need nobody, so they never rank.
function urgency(stage) {
  if (stage.key === 'ready') return 0;
  if (stage.late) return 1;
  if (stage.key === 'ordering') return 2;
  if (stage.key === 'seated') return 3;
  return null;
}

/** The few tables that need a person right now, most urgent first, longest wait first. */
export function tablesNeedingAction(entries, limit = 4) {
  return entries
    .filter(({ stage }) => urgency(stage) !== null)
    .sort((a, b) => urgency(a.stage) - urgency(b.stage) || b.stage.minutes - a.stage.minutes)
    .slice(0, limit);
}

/**
 * A table several groups share shows the stage of whichever group needs a person soonest —
 * one group's food waiting at the pass must colour the tile even while the other is eating.
 */
export function mostUrgentStage(stages) {
  if (stages.length <= 1) return stages[0];
  const rank = (s) => {
    const u = urgency(s);
    if (u !== null) return u;
    return s.key === 'cooking' ? 4 : 5;
  };
  return stages.slice().sort((a, b) => rank(a) - rank(b) || b.minutes - a.minutes)[0];
}

/**
 * Chairs already taken at a table, and how many are left for a new group. A group whose
 * head-count was never entered takes one chair — the same rule the server seats by, so the
 * screen never offers a seat the server would refuse.
 */
export function seatsAtTable(capacity, orders) {
  const taken = (orders || []).reduce((sum, o) => sum + (Number(o.guestCount) > 0 ? Number(o.guestCount) : 1), 0);
  return { taken, free: Math.max(0, (Number(capacity) || 0) - taken), unknown: (orders || []).some((o) => !(Number(o.guestCount) > 0)) };
}
