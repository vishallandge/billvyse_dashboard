'use client';

import { apiFetch } from './api';
import { activeThemeOnWhite } from './themes';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise = null;

function loadRazorpayScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not in a browser'));
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load the payment page — check your internet connection.'));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

// Kicks off a plan purchase/renewal: the backend decides the amount from the plan
// catalog (a client can never influence what gets charged), Razorpay's hosted checkout
// collects card/UPI/netbanking details directly (they never touch our servers), and the
// resolved promise only fires after the backend has independently verified the payment
// signature — closing the checkout modal is never, on its own, treated as success.
export function purchasePlan({ plan, cycle = 'monthly', description, onDismiss, promoCode, campaign, usePoints }) {
  return loadRazorpayScript().then(() =>
    apiFetch('/api/seller/payments/order', {
      method: 'POST',
      // The code and the campaign are passed as claims, not as facts: the server re-checks
      // the discount against its own PromoCode row and prices the order itself, so a client
      // that invents a code gets the list price and nothing worse happens.
      // `usePoints` is a claim in exactly the same sense: the server re-checks the balance,
      // applies its own ceiling, and prices the order from what it finds. A client that asks
      // to spend points it does not have simply gets charged the full amount.
      body: JSON.stringify({ plan, cycle, promoCode, campaign, usePoints }),
    }).then(
      (order) =>
        new Promise((resolve, reject) => {
          const rzp = new window.Razorpay({
            key: order.keyId,
            amount: order.amount,
            currency: order.currency,
            name: 'BillVyse',
            description: description || order.planName,
            order_id: order.orderId,
            prefill: order.prefill,
            // Razorpay's modal is its own light-themed surface, so it takes the shop's
            // light-ramp brand rather than whatever --brand currently resolves to — a
            // dark-mode tint would wash out on their white sheet.
            theme: { color: activeThemeOnWhite().brand },
            handler: (response) => {
              apiFetch('/api/seller/payments/verify', {
                method: 'POST',
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              })
                .then(resolve)
                /**
                 * The money is GONE from the shopkeeper's account by the time this runs —
                 * Razorpay has already taken it and handed us a signed receipt. All that
                 * failed here is our own confirmation call: the phone dropped off wifi, the
                 * server restarted, the request timed out.
                 *
                 * Rejecting would put "Payment could not be completed. No amount was
                 * charged." on the screen of somebody who was very much charged, which is
                 * the worst sentence this app can show. The backend settles it without the
                 * browser anyway — Razorpay's webhook, and the reconciliation job behind it
                 * — so this resolves as pending and the caller says "give it a minute".
                 */
                .catch(() =>
                  resolve({
                    pending: true,
                    orderId: response.razorpay_order_id,
                    paymentId: response.razorpay_payment_id,
                  })
                );
            },
            modal: {
              ondismiss: () => {
                onDismiss?.();
                resolve(null);
              },
            },
          });
          rzp.on('payment.failed', (response) => {
            reject(new Error(response.error?.description || 'Payment failed'));
          });
          rzp.open();
        })
    )
  );
}
