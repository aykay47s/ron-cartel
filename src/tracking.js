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
export const UPDATE_TEMPLATES = [
  { key: 'collected',  label: 'Courier collected it',       where: '' },
  { key: 'depot',      label: 'Arrived at the depot',       where: '' },
  { key: 'hub',        label: 'At the sorting hub',         where: '' },
  { key: 'transit',    label: 'In transit',                 where: '' },
  { key: 'out',        label: 'Out for delivery',           where: '' },
  { key: 'delivered',  label: 'Delivered',                  where: '' },
  { key: 'ready',      label: 'Ready for collection',       where: '' },
  { key: 'attempted',  label: 'Delivery attempted',         where: '' },
  { key: 'delayed',    label: 'Delayed',                    where: '' },
  { key: 'workshop',   label: 'In the workshop',            where: '' },
  { key: 'tested',     label: 'Build finished and tested',  where: '' },
  { key: 'packed',     label: 'Packed and ready to go',     where: '' },
];

export const templateLabel = (key) =>
  (UPDATE_TEMPLATES.find((t) => t.key === key) || {}).label || '';

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
