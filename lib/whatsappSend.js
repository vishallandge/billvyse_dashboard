/**
 * The one thing every WhatsApp button in this app has to get right.
 *
 * There are two completely different ways a message leaves this shop, and which one applies
 * is a fact about the deployment, not about the screen the shopkeeper is standing on:
 *
 *   **Automatic** — the shop has a WhatsApp Business account configured, so the server
 *   sends the approved template itself and nobody taps anything.
 *
 *   **By hand** — no account (which is nearly every dukaan), so we open the shopkeeper's
 *   own WhatsApp with the message already typed and he presses send.
 *
 * The trap this file exists to close: the automatic path can fail *after* the button is
 * already drawn — the month's quota ran out, the provider refused the number, the template
 * was un-approved overnight. Every one of those refusals comes back from the server with
 * `whatsappLink` in the body precisely so the send can fall through to the manual path
 * instead of dead-ending. A button that says "sent" when nothing went is worse than no
 * button at all: the shopkeeper walks away, and finds out a week later when the customer
 * says they never got the bill.
 *
 * So: one call, one of three answers, and the caller (WhatsappSheet) never has to know
 * which server route it was talking to.
 */

import { apiFetch } from './api';

/**
 * Attempts the automatic send.
 *
 * @param {string|{url: string, body: object}} endpoint  the POST route that sends — a bare
 *        path for the routes whose whole job is this one send, or `{url, body}` for the one
 *        that also takes arguments (the khata reminder carries which of the three recovery
 *        tones the shopkeeper picked).
 * @param {string} fallback  the wa.me link to use if it cannot be sent automatically
 * @returns {Promise<{ sent: boolean, link: string|null, reason?: string, code?: string }>}
 *
 * Never throws for a refusal the shopkeeper can act on — a refusal IS an answer here, and
 * one that still has a way forward attached to it. It only rethrows when there is genuinely
 * nothing to fall back to, which is the one case where an error banner is the honest thing
 * to show.
 */
export async function attemptWhatsappSend(endpoint, fallback = null) {
  const url = typeof endpoint === 'string' ? endpoint : endpoint?.url;
  const body = typeof endpoint === 'string' ? undefined : endpoint?.body;

  try {
    const data = await apiFetch(url, {
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    /**
     * A 200 is not the same thing as "it went".
     *
     * The khata reminder route answers 200 whether or not the Business API took the
     * message, because it always has work to do either way — it writes the ReminderLog row
     * that the aging screens read, and only then decides whether it can also deliver. It
     * reports that decision in `sent`, and a caller that reads the status code instead
     * tells the shopkeeper his udhaari reminder went out when all that happened is that we
     * wrote it down.
     *
     * So: `sent === false` is a downgrade to the link, exactly like a 402 or a 502. Routes
     * that only ever send omit the field, and an absent flag on a 200 means it went.
     */
    if (data && data.sent === false) {
      return {
        sent: false,
        link: data.whatsappLink || fallback || null,
        reason: null,
        code: 'NOT_AUTO_SENT',
      };
    }

    return { sent: true, link: data?.whatsappLink || fallback || null };
  } catch (error) {
    // The server hands the link back with every refusal it knows how to explain. When it
    // did, this is a downgrade, not a failure — the message still has somewhere to go.
    const link = error?.data?.whatsappLink || fallback || null;
    if (!link) throw error;
    return {
      sent: false,
      link,
      reason: error?.data?.message || error.message,
      code: error?.data?.code || null,
    };
  }
}

/**
 * Opens the shopkeeper's WhatsApp with the message pre-filled.
 *
 * `noopener` because this is a link to another origin opened from a page holding a live
 * session, and returns whether the window actually opened — a blocked popup looks exactly
 * like a successful send from here otherwise, and the sheet needs to say so rather than
 * congratulate the shopkeeper on a message that never appeared.
 */
/**
 * Reads the message back out of a wa.me link.
 *
 * For the screens whose payload is a list of ready-made links and nothing else — the
 * appointment reminder queue is forty of them at once. Asking the server for each row's
 * sentence as well would double the size of that response, or cost one request per row to
 * open a preview; the sentence is already inside `?text=`, and it is by definition exactly
 * what is about to be sent, which no second rendering of it can promise.
 *
 * Returns '' for anything unparseable, and the sheet simply draws without a preview rather
 * than showing a decoded fragment of a URL.
 */
export function messageFromWaLink(link) {
  if (!link) return '';
  try {
    return new URL(link).searchParams.get('text') || '';
  } catch {
    return '';
  }
}

export function openWhatsapp(link) {
  if (!link || typeof window === 'undefined') return false;
  const opened = window.open(link, '_blank', 'noopener');
  return Boolean(opened);
}
