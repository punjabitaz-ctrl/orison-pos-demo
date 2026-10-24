'use strict';

import { N_, tIn, storeLanguage } from './lang.js';

/* What the shop says to a customer about their repair.
 *
 * Written in the shop's language, not the staff member's screen language: the
 * person reading it is standing somewhere else. Every message names the shop,
 * the ticket and the device, because a customer with one phone number and
 * three repairs over two years has no other way to tell them apart.
 *
 * The text is deliberately editable before it goes: no template survives a
 * customer who needs one extra sentence.
 */

export const TOLD_KINDS = [
  { id: 'booked', label: N_('We have your device'), forStatus: ['intake', 'diagnosed'] },
  { id: 'awaiting_parts', label: N_('Waiting on a part'), forStatus: ['awaiting_parts'] },
  { id: 'ready', label: N_('Ready to collect'), forStatus: ['ready', 'in_progress'] },
  { id: 'collected', label: N_('Thanks, and your warranty'), forStatus: ['collected'] },
];

/* The message the ticket's own status suggests — the one the shop almost
   always wants, pre-selected so nobody has to think about it. */
export function kindForStatus(status) {
  const hit = TOLD_KINDS.find((k) => k.forStatus.includes(String(status || '')));
  return hit ? hit.id : 'ready';
}

const BODY = {
  booked: N_('Hello {customer}, this is {shop}. We have your {device} in for repair, ticket {ticket}. We will let you know as soon as it is ready.'),
  awaiting_parts: N_('Hello {customer}, this is {shop} about ticket {ticket} for your {device}. We are waiting on a part and will tell you the moment it arrives.'),
  ready: N_('Hello {customer}, this is {shop}. Your {device} is repaired and ready to collect, ticket {ticket}.{balance} Our hours and address are on your receipt.'),
  collected: N_('Hello {customer}, thank you from {shop}. Your {device} is covered against the same fault for {days} days — keep ticket {ticket} and come straight back if anything is wrong.'),
};

const SUBJECT = {
  booked: N_('{shop} — we have your {device}'),
  awaiting_parts: N_('{shop} — ticket {ticket} is waiting on a part'),
  ready: N_('{shop} — your {device} is ready to collect'),
  collected: N_('{shop} — thank you'),
};

/* Pure: a ticket, the shop and a kind in, a subject and a body out. `money`
   formats a balance; it is passed in so this module never has to know the
   store's currency. */
export function repairMessage({ ticket, shop, kind, money, lang, warrantyDays = 30 } = {}) {
  const t = ticket || {};
  const code = lang || storeLanguage();
  const k = TOLD_KINDS.some((x) => x.id === kind) ? kind : 'ready';
  const balanceDue = Number(t.balanceDue) || 0;
  const params = {
    customer: String(t.customerName || '').trim() || tIn(code, 'there'),
    shop: String(shop || '').trim() || 'Orison',
    device: String(t.device || '').trim() || tIn(code, 'device'),
    ticket: String(t.ticketNo || ''),
    days: warrantyDays,
    balance: k === 'ready' && balanceDue > 0 && typeof money === 'function'
      ? ' ' + tIn(code, 'There is {amount} left to pay.', { amount: money(balanceDue) })
      : '',
  };
  return {
    kind: k,
    subject: tIn(code, SUBJECT[k], params),
    body: tIn(code, BODY[k], params),
  };
}
