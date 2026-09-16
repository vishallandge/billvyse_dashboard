/**
 * Dialling codes, and the one country this app actually sells in.
 *
 * WHY THE WHOLE WORLD IS IN HERE WHEN ONLY ONE ENTRY IS REACHABLE
 *
 * Every phone box in this app is locked to India (`DEFAULT_COUNTRY`) and the prefix beside
 * it cannot be changed — see PhoneField.js. That is a product decision, not a limitation:
 * BillVyse is built for Indian shops, the GST work, the DLT/SMS pipe, the UPI intent and the
 * 10-digit khata key all assume it, and a shopkeeper who can accidentally set their own shop
 * phone to +1 gets an OTP that never arrives and a bill with a number nobody can dial.
 *
 * The list is complete anyway so that the day the lock comes off is a one-line change
 * (`countryLocked={false}`) rather than a data-gathering exercise, and so that anything
 * reading a stored number can still say which country a `+`-prefixed one belongs to.
 *
 * `digits` is the national number length where it is fixed and worth validating; `null`
 * means "varies", and those are length-checked loosely. Only India's rule is enforced
 * today (see isIndianMobile in shopProfileRules.js, mirrored from backend/utils/phone.js).
 */

export const DEFAULT_COUNTRY = 'IN';

// iso2, dial code, English name, fixed national length (null = varies).
// Sorted by name; India is looked up by key, never by position.
export const COUNTRIES = Object.freeze([
  { iso2: 'AF', dial: '93', name: 'Afghanistan', digits: 9 },
  { iso2: 'AL', dial: '355', name: 'Albania', digits: null },
  { iso2: 'DZ', dial: '213', name: 'Algeria', digits: 9 },
  { iso2: 'AD', dial: '376', name: 'Andorra', digits: 6 },
  { iso2: 'AO', dial: '244', name: 'Angola', digits: 9 },
  { iso2: 'AR', dial: '54', name: 'Argentina', digits: null },
  { iso2: 'AM', dial: '374', name: 'Armenia', digits: 8 },
  { iso2: 'AU', dial: '61', name: 'Australia', digits: 9 },
  { iso2: 'AT', dial: '43', name: 'Austria', digits: null },
  { iso2: 'AZ', dial: '994', name: 'Azerbaijan', digits: 9 },
  { iso2: 'BH', dial: '973', name: 'Bahrain', digits: 8 },
  { iso2: 'BD', dial: '880', name: 'Bangladesh', digits: 10 },
  { iso2: 'BY', dial: '375', name: 'Belarus', digits: 9 },
  { iso2: 'BE', dial: '32', name: 'Belgium', digits: 9 },
  { iso2: 'BT', dial: '975', name: 'Bhutan', digits: 8 },
  { iso2: 'BO', dial: '591', name: 'Bolivia', digits: 8 },
  { iso2: 'BA', dial: '387', name: 'Bosnia and Herzegovina', digits: null },
  { iso2: 'BW', dial: '267', name: 'Botswana', digits: null },
  { iso2: 'BR', dial: '55', name: 'Brazil', digits: 11 },
  { iso2: 'BN', dial: '673', name: 'Brunei', digits: 7 },
  { iso2: 'BG', dial: '359', name: 'Bulgaria', digits: null },
  { iso2: 'KH', dial: '855', name: 'Cambodia', digits: null },
  { iso2: 'CM', dial: '237', name: 'Cameroon', digits: 9 },
  { iso2: 'CA', dial: '1', name: 'Canada', digits: 10 },
  { iso2: 'CL', dial: '56', name: 'Chile', digits: 9 },
  { iso2: 'CN', dial: '86', name: 'China', digits: 11 },
  { iso2: 'CO', dial: '57', name: 'Colombia', digits: 10 },
  { iso2: 'CR', dial: '506', name: 'Costa Rica', digits: 8 },
  { iso2: 'HR', dial: '385', name: 'Croatia', digits: null },
  { iso2: 'CY', dial: '357', name: 'Cyprus', digits: 8 },
  { iso2: 'CZ', dial: '420', name: 'Czechia', digits: 9 },
  { iso2: 'DK', dial: '45', name: 'Denmark', digits: 8 },
  { iso2: 'EC', dial: '593', name: 'Ecuador', digits: 9 },
  { iso2: 'EG', dial: '20', name: 'Egypt', digits: 10 },
  { iso2: 'EE', dial: '372', name: 'Estonia', digits: null },
  { iso2: 'ET', dial: '251', name: 'Ethiopia', digits: 9 },
  { iso2: 'FI', dial: '358', name: 'Finland', digits: null },
  { iso2: 'FR', dial: '33', name: 'France', digits: 9 },
  { iso2: 'GE', dial: '995', name: 'Georgia', digits: 9 },
  { iso2: 'DE', dial: '49', name: 'Germany', digits: null },
  { iso2: 'GH', dial: '233', name: 'Ghana', digits: 9 },
  { iso2: 'GR', dial: '30', name: 'Greece', digits: 10 },
  { iso2: 'HK', dial: '852', name: 'Hong Kong', digits: 8 },
  { iso2: 'HU', dial: '36', name: 'Hungary', digits: 9 },
  { iso2: 'IS', dial: '354', name: 'Iceland', digits: 7 },
  // The only entry any screen in this app reaches today.
  { iso2: 'IN', dial: '91', name: 'India', digits: 10 },
  { iso2: 'ID', dial: '62', name: 'Indonesia', digits: null },
  { iso2: 'IR', dial: '98', name: 'Iran', digits: 10 },
  { iso2: 'IQ', dial: '964', name: 'Iraq', digits: 10 },
  { iso2: 'IE', dial: '353', name: 'Ireland', digits: 9 },
  { iso2: 'IL', dial: '972', name: 'Israel', digits: 9 },
  { iso2: 'IT', dial: '39', name: 'Italy', digits: 10 },
  { iso2: 'JM', dial: '1876', name: 'Jamaica', digits: 7 },
  { iso2: 'JP', dial: '81', name: 'Japan', digits: 10 },
  { iso2: 'JO', dial: '962', name: 'Jordan', digits: 9 },
  { iso2: 'KZ', dial: '7', name: 'Kazakhstan', digits: 10 },
  { iso2: 'KE', dial: '254', name: 'Kenya', digits: 9 },
  { iso2: 'KW', dial: '965', name: 'Kuwait', digits: 8 },
  { iso2: 'KG', dial: '996', name: 'Kyrgyzstan', digits: 9 },
  { iso2: 'LA', dial: '856', name: 'Laos', digits: null },
  { iso2: 'LV', dial: '371', name: 'Latvia', digits: 8 },
  { iso2: 'LB', dial: '961', name: 'Lebanon', digits: null },
  { iso2: 'LY', dial: '218', name: 'Libya', digits: 9 },
  { iso2: 'LT', dial: '370', name: 'Lithuania', digits: 8 },
  { iso2: 'LU', dial: '352', name: 'Luxembourg', digits: null },
  { iso2: 'MO', dial: '853', name: 'Macau', digits: 8 },
  { iso2: 'MY', dial: '60', name: 'Malaysia', digits: null },
  { iso2: 'MV', dial: '960', name: 'Maldives', digits: 7 },
  { iso2: 'MT', dial: '356', name: 'Malta', digits: 8 },
  { iso2: 'MU', dial: '230', name: 'Mauritius', digits: 8 },
  { iso2: 'MX', dial: '52', name: 'Mexico', digits: 10 },
  { iso2: 'MD', dial: '373', name: 'Moldova', digits: 8 },
  { iso2: 'MN', dial: '976', name: 'Mongolia', digits: 8 },
  { iso2: 'ME', dial: '382', name: 'Montenegro', digits: 8 },
  { iso2: 'MA', dial: '212', name: 'Morocco', digits: 9 },
  { iso2: 'MZ', dial: '258', name: 'Mozambique', digits: 9 },
  { iso2: 'MM', dial: '95', name: 'Myanmar', digits: null },
  { iso2: 'NA', dial: '264', name: 'Namibia', digits: null },
  { iso2: 'NP', dial: '977', name: 'Nepal', digits: 10 },
  { iso2: 'NL', dial: '31', name: 'Netherlands', digits: 9 },
  { iso2: 'NZ', dial: '64', name: 'New Zealand', digits: null },
  { iso2: 'NG', dial: '234', name: 'Nigeria', digits: 10 },
  { iso2: 'NO', dial: '47', name: 'Norway', digits: 8 },
  { iso2: 'OM', dial: '968', name: 'Oman', digits: 8 },
  { iso2: 'PK', dial: '92', name: 'Pakistan', digits: 10 },
  { iso2: 'PS', dial: '970', name: 'Palestine', digits: 9 },
  { iso2: 'PA', dial: '507', name: 'Panama', digits: 8 },
  { iso2: 'PY', dial: '595', name: 'Paraguay', digits: 9 },
  { iso2: 'PE', dial: '51', name: 'Peru', digits: 9 },
  { iso2: 'PH', dial: '63', name: 'Philippines', digits: 10 },
  { iso2: 'PL', dial: '48', name: 'Poland', digits: 9 },
  { iso2: 'PT', dial: '351', name: 'Portugal', digits: 9 },
  { iso2: 'QA', dial: '974', name: 'Qatar', digits: 8 },
  { iso2: 'RO', dial: '40', name: 'Romania', digits: 9 },
  { iso2: 'RU', dial: '7', name: 'Russia', digits: 10 },
  { iso2: 'RW', dial: '250', name: 'Rwanda', digits: 9 },
  { iso2: 'SA', dial: '966', name: 'Saudi Arabia', digits: 9 },
  { iso2: 'SN', dial: '221', name: 'Senegal', digits: 9 },
  { iso2: 'RS', dial: '381', name: 'Serbia', digits: null },
  { iso2: 'SG', dial: '65', name: 'Singapore', digits: 8 },
  { iso2: 'SK', dial: '421', name: 'Slovakia', digits: 9 },
  { iso2: 'SI', dial: '386', name: 'Slovenia', digits: 8 },
  { iso2: 'ZA', dial: '27', name: 'South Africa', digits: 9 },
  { iso2: 'KR', dial: '82', name: 'South Korea', digits: null },
  { iso2: 'ES', dial: '34', name: 'Spain', digits: 9 },
  { iso2: 'LK', dial: '94', name: 'Sri Lanka', digits: 9 },
  { iso2: 'SE', dial: '46', name: 'Sweden', digits: null },
  { iso2: 'CH', dial: '41', name: 'Switzerland', digits: 9 },
  { iso2: 'TW', dial: '886', name: 'Taiwan', digits: 9 },
  { iso2: 'TZ', dial: '255', name: 'Tanzania', digits: 9 },
  { iso2: 'TH', dial: '66', name: 'Thailand', digits: 9 },
  { iso2: 'TN', dial: '216', name: 'Tunisia', digits: 8 },
  { iso2: 'TR', dial: '90', name: 'Türkiye', digits: 10 },
  { iso2: 'UG', dial: '256', name: 'Uganda', digits: 9 },
  { iso2: 'UA', dial: '380', name: 'Ukraine', digits: 9 },
  { iso2: 'AE', dial: '971', name: 'United Arab Emirates', digits: 9 },
  { iso2: 'GB', dial: '44', name: 'United Kingdom', digits: 10 },
  { iso2: 'US', dial: '1', name: 'United States', digits: 10 },
  { iso2: 'UY', dial: '598', name: 'Uruguay', digits: 8 },
  { iso2: 'UZ', dial: '998', name: 'Uzbekistan', digits: 9 },
  { iso2: 'VN', dial: '84', name: 'Vietnam', digits: 9 },
  { iso2: 'YE', dial: '967', name: 'Yemen', digits: 9 },
  { iso2: 'ZM', dial: '260', name: 'Zambia', digits: 9 },
  { iso2: 'ZW', dial: '263', name: 'Zimbabwe', digits: 9 },
]);

const BY_ISO = Object.fromEntries(COUNTRIES.map((c) => [c.iso2, c]));

/** Never returns undefined — an unknown code falls back to India rather than blanking the box. */
export function country(iso2) {
  return BY_ISO[iso2] || BY_ISO[DEFAULT_COUNTRY];
}

/** "+91" — the string shown beside the input. */
export function dialCode(iso2) {
  return `+${country(iso2).dial}`;
}

/** How many digits the national part may hold. Used to cap typing, so it is never zero. */
export function nationalLength(iso2) {
  return country(iso2).digits || 15;
}
