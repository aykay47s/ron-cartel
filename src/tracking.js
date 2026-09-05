/* Order tracking with a place attached.
 *
 * "Awaiting payment / Paid / Dispatched" tells someone almost nothing once a
 * bike is actually moving. What people want is the InPost or DPD experience:
 * a running list of what happened, where, and when. So an order event now
 * carries a location, and the shop owner posts updates as things happen.
 *
 * Nothing here invents a position. Every line on the customer's page was typed
 * by someone who knew where the bike was.
 */

/* Ready-made lines so posting an update is two clicks, not a writing exercise.
   `where` is a suggestion — it is pre-filled into the box and edited freely. */
/* Each one is a whole update in a single tap: the line the customer reads, a
   suggested note, and whether it usually has a place attached. Posting an
   update should be pick-one-and-send, not filling in a form. */
export const UPDATE_TEMPLATES = [
  { key: 'workshop',  label: 'In the workshop',           note: 'Being built and checked over.',        place: false, icon: 'cog' },
  { key: 'tested',    label: 'Built and road tested',     note: 'Done and tested, ready to go out.',    place: false, icon: 'tick' },
  { key: 'packed',    label: 'Packed and ready',          note: 'Boxed up, waiting on the courier.',    place: false, icon: 'box' },
  { key: 'collected', label: 'Courier collected it',      note: '',                                    place: true,  icon: 'van' },
  { key: 'depot',     label: 'Arrived at the depot',      note: '',                                    place: true,  icon: 'pallet' },
  { key: 'hub',       label: 'At the sorting hub',        note: '',                                    place: true,  icon: 'pallet' },
  { key: 'transit',   label: 'On the move',               note: '',                                    place: true,  icon: 'van' },
  { key: 'out',       label: 'Out for delivery',          note: 'With the driver today.',              place: true,  icon: 'van' },
  { key: 'attempted', label: 'Delivery attempted',        note: 'Nobody in — they will try again.',    place: true,  icon: 'pin' },
  { key: 'delivered', label: 'Delivered',                 note: '',                                    place: true,  icon: 'tick' },
  { key: 'ready',     label: 'Ready to collect',          note: 'Come and get it whenever suits.',     place: true,  icon: 'pin' },
  { key: 'delayed',   label: 'Delayed',                   note: '',                                    place: false, icon: 'clock' },
];

export const template = (key) => UPDATE_TEMPLATES.find((t) => t.key === key) || null;

export const templateLabel = (key) => (template(key) || {}).label || '';

/* "Yesterday, 16:20" reads better than a full date for anything recent, and a
   timeline is mostly recent things. */
export function niceWhen(d) {
  const then = new Date(d);
  const now = new Date();
  const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(then, now)) return `Today, ${time}`;
  if (sameDay(then, yesterday)) return `Yesterday, ${time}`;
  const opts = { day: 'numeric', month: 'short' };
  if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${then.toLocaleDateString('en-GB', opts)}, ${time}`;
}

/* An <input type="datetime-local"> wants exactly this shape, in local time. */
export function forInput(d) {
  const t = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
       + `T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/* The four fixed stages stay — they are the shape of the order. The typed
   updates thread through underneath as the detail. */
export const STAGES = [
  ['placed',     'Order placed'],
  ['paid',       'Payment received'],
  ['dispatched', 'On its way'],
  ['done',       'Delivered'],
];

export function stageReached(order, key) {
  const paid = order.status === 'paid';
  if (key === 'placed') return true;
  if (key === 'paid') return paid;
  if (key === 'dispatched') return !!order.dispatched_at;
  if (key === 'done') return order.status === 'complete';
  return false;
}
