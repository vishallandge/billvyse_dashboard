/**
 * How a customer is written in one line: "Ramesh · 98765 43210".
 *
 * A customer added from just a number (a walk-in's number put on a bill, see
 * attachBillCustomer) is saved with that number as their name too, so "name · phone"
 * printed the same ten digits twice. When the name is only the number, the number is
 * written once.
 */
function digits(value) {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

export function nameIsPhone(customer) {
  const name = String(customer?.name ?? '').trim();
  if (!name) return true;
  return /^[\d\s+()-]+$/.test(name) && digits(name) === digits(customer?.phone);
}

/** "Name · phone", or just the phone when the name is only the phone. */
export function customerLine(customer, sep = ' · ') {
  if (!customer) return '';
  const phone = String(customer.phone ?? '').trim();
  if (nameIsPhone(customer)) return phone || String(customer.name ?? '').trim();
  return phone ? `${String(customer.name).trim()}${sep}${phone}` : String(customer.name).trim();
}

/** For a picker row: "Name (phone)", or just the phone. */
export function customerOptionLabel(customer) {
  if (!customer) return '';
  if (nameIsPhone(customer)) return String(customer.phone ?? customer.name ?? '').trim();
  return customer.phone ? `${customer.name} (${customer.phone})` : String(customer.name);
}
