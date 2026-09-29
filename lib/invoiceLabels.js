// Everything the *printed* invoice can be configured to be: its templates, its paper
// sizes, its accent themes, the kind of document it claims to be, and the words printed
// on it.
//
// Deliberately separate from lib/i18n.js. That file translates the *app* — the buttons a
// shopkeeper presses. This one translates the *paper* — what a customer, an accountant or
// a drug inspector reads. They move independently: a shopkeeper who runs the dashboard in
// Marathi may still hand a Hindi-speaking customer a Hindi bill, and a wholesaler's B2B
// buyer will always want the English one for their CA.
//
// Numbers are never localised here. Indian invoices print Latin digits even when the
// labels are in Devanagari — a bank, a GST portal and a CA's software all read ₹1,240.00,
// and १,२४०.०० on a tax invoice reads as a novelty, not as a document.

/* ------------------------------------------------------------------ templates ------- */
// A template is a *layout*, not a colour: where the letterhead sits, how heavy the rules
// are, how much air each row gets. The accent theme is picked separately, so 6 layouts ×
// 8 accents × ink-saver is what the seller actually chooses from.
export const INVOICE_TEMPLATES = [
  {
    id: 'classic',
    name: 'Classic',
    hint: 'Coloured header band, bold table head. The default Dukaan bill.',
  },
  {
    id: 'modern',
    name: 'Modern',
    hint: 'Big total up top, airy rows, no heavy fills. Reads well on a phone screenshot.',
  },
  {
    id: 'tally',
    name: 'Tally style',
    hint: 'Fully boxed grid, all-caps labels. What wholesalers and CAs expect to receive.',
  },
  {
    id: 'elegant',
    name: 'Elegant',
    hint: 'Serif letterhead, hairline rules, centred. For jewellers, boutiques, clinics.',
  },
  {
    id: 'compact',
    name: 'Compact',
    hint: 'Tightest rows — fits roughly twice as many items on one page.',
  },
  {
    id: 'letterhead',
    name: 'Pre-printed letterhead',
    hint: 'Leaves the top blank for shops that print on their own letterhead paper.',
  },
  // The two layouts a hotel, dhaba, canteen or cafe actually hands over. Both are
  // receipt-shaped rather than page-shaped: one centred column, no fills, the grand
  // total right under the last item. They are also the only two templates a roll does
  // not neutralise into Classic — a receipt printed on a receipt printer is already
  // the thing they are.
  {
    id: 'receipt',
    name: 'Dot matrix',
    hint: 'Typewriter font, dashed rules, everything centred. The old canteen slip.',
  },
  {
    id: 'restaurant',
    name: 'Restaurant bill',
    hint: 'Bold centred name, ruled lines, table and cashier on top, one big total.',
  },
];

/* --------------------------------------------------------------------- accents ------- */
// Ink on white paper, so every accent is picked dark enough to stay readable when a cheap
// office laser prints it at 40% toner. `soft` and `line` are the two tints; `ribbon` is
// the header gradient.
export const INVOICE_THEMES = [
  // Named for the colour, not for us. This is the shop's own paper: a customer holding
  // it should see the shop's accent, never our company's name on the document they just
  // paid against. (Same reason there is no logo or watermark on any of these.)
  { id: 'navy', name: 'Navy', swatch: '#0f2a4d' },
  { id: 'marigold', name: 'Marigold', swatch: '#ff7a29' },
  { id: 'royal', name: 'Royal blue', swatch: '#1e3a8a' },
  { id: 'minimal', name: 'Minimal black', swatch: '#111827' },
  { id: 'emerald', name: 'Emerald', swatch: '#047857' },
  { id: 'crimson', name: 'Crimson', swatch: '#9f1239' },
  { id: 'teal', name: 'Teal', swatch: '#0f766e' },
  { id: 'plum', name: 'Plum', swatch: '#6b21a8' },
  { id: 'graphite', name: 'Graphite', swatch: '#374151' },
];

export const INVOICE_THEME_IDS = INVOICE_THEMES.map((theme) => theme.id);
export const INVOICE_TEMPLATE_IDS = INVOICE_TEMPLATES.map((template) => template.id);

/* ----------------------------------------------------------------------- paper ------- */
export const INVOICE_PAPERS = [
  { id: 'a4', name: 'A4', hint: '210 × 297 mm — the standard sheet', page: 'A4 portrait' },
  { id: 'a5', name: 'A5', hint: '148 × 210 mm — half sheet, saves paper', page: 'A5 portrait' },
  { id: 'a6', name: 'A6', hint: '105 × 148 mm — quarter sheet, the bill-book size', page: 'A6 portrait' },
  { id: 'thermal', name: '80mm thermal', hint: 'Counter receipt printer', page: '80mm auto' },
  { id: 'thermal58', name: '58mm thermal', hint: 'Small handheld / mobile printer', page: '58mm auto' },
];

export const INVOICE_PAPER_IDS = INVOICE_PAPERS.map((paper) => paper.id);

/**
 * How wide each paper actually is, and how to fit one into a box.
 *
 * A page has a physical width and does not negotiate: `.invoice-sheet` is `width: 210mm`,
 * so on a phone it is 793 CSS pixels inside a 350-pixel column. Something has to give, and
 * the only honest answer is to scale the whole sheet — squeezing it would compress every
 * column and stop being a preview of what prints.
 *
 * This used to be a flat `transform: scale(0.46)` in a `max-width: 900px` media query, and
 * it was wrong in three separate ways: 0.46 of A4 is 365px, which still does not fit a
 * 390px phone; it applied to A5 and to the invoice screen's already-fitted sheet, shrinking
 * those twice; and the negative margin that reclaimed the empty space assumed the sheet was
 * exactly 297mm tall, which stops being true the moment a bill has more rows than fit on
 * one page. Measuring is the fix — see components/InvoicePreviewStage.js.
 */
export const PAPER_WIDTH_MM = { a4: 210, a5: 148, a6: 105, thermal: 80, thermal58: 58 };
export const MM_TO_PX = 96 / 25.4;

export function paperWidthPx(paper) {
  return (PAPER_WIDTH_MM[paper] || PAPER_WIDTH_MM.a4) * MM_TO_PX;
}

export const isRollPaper = (paper) => paper === 'thermal' || paper === 'thermal58';

/**
 * The zoom that makes `paper` fit `availablePx`.
 *
 * A sheet is never blown up past life size — an A4 stretched across a 27" monitor stops
 * being a preview of a page. A roll is the opposite case: 58mm is 219 CSS pixels, which is
 * accurate and far too small to check a layout on, so roll paper may magnify up to 2×.
 *
 * The 0.25 floor is what keeps a preview readable rather than correct-but-useless on a very
 * narrow screen; below that the stage scrolls instead.
 */
export function fitZoomFor(paper, availablePx) {
  const width = paperWidthPx(paper);
  if (!availablePx || availablePx <= 0) return 1;
  const ceiling = isRollPaper(paper) ? 2 : 1;
  return Math.max(0.25, Math.min(ceiling, availablePx / width));
}

// Printer hardware margins. Zero is right for thermal and for anyone printing edge-to-edge
// PDFs, but a lot of desktop inkjets silently clip the last 4–5mm of a page, which eats
// the footer strip — so it is a choice, not a constant.
export const PRINT_MARGINS = [
  { id: 'none', name: 'Edge to edge', mm: 0 },
  { id: 'small', name: 'Small (5mm)', mm: 5 },
  { id: 'normal', name: 'Safe (10mm)', mm: 10 },
];

export const INVOICE_DENSITIES = [
  { id: 'compact', name: 'Compact' },
  { id: 'normal', name: 'Normal' },
  { id: 'large', name: 'Large print' },
];

/* ------------------------------------------------------------------ doc kinds -------- */
// The same sale, printed as five legally different pieces of paper. `auto` prints whatever
// the data earns (Tax Invoice / Bill of Supply / Invoice); the rest are deliberate
// overrides a shopkeeper reaches for — and every one of them that is *not* a tax invoice
// says so on its face, because a quotation that looks like an invoice is how a customer
// ends up claiming input credit on a sale that never happened.
export const DOC_KINDS = [
  { id: 'auto', prefix: null, isTax: true },
  { id: 'cashmemo', prefix: null, isTax: false, hideStamp: false },
  { id: 'estimate', prefix: 'EST', isTax: false, hidePayment: true, hideStamp: true, validity: true },
  { id: 'proforma', prefix: 'PI', isTax: false, hidePayment: true, hideStamp: true },
  { id: 'challan', prefix: 'DC', isTax: false, hidePayment: true, hideStamp: true, receiverSign: true },
  // Not a re-skin of the bill like the four above: this one is rendered from a *different*
  // payload (GET /bills/:id/credit-note/:index) that the server shapes into the same
  // contract. It is listed here so the picker, the title and the number all come from one
  // place — but its number is minted server-side, so no prefix swap.
  // `isTax: false` here only controls the heading above the number — a credit note is
  // headed "Document No.", not "Invoice No.", because it is not an invoice.
  { id: 'creditnote', prefix: null, isTax: false, hideStamp: true, fromReturn: true },
  // The mirror of the one above, and the only document in this app addressed TO a supplier.
  // Rendered from GET /seller/suppliers/purchase-returns/:id/document, so its number is
  // minted server-side too and there is no prefix to swap. `fromReturn` keeps it out of the
  // kind picker on a bill, where it would mean nothing.
  // `hidePayment` because nobody pays against a debit note. Without it the document
  // printed a "Payment due / Balance due" block reading as though the SHOP owed the money,
  // on the one page in the app where the debt runs the other way.
  { id: 'debitnote', prefix: null, isTax: false, hideStamp: true, hidePayment: true, fromReturn: true },
];

export function docKindById(id) {
  return DOC_KINDS.find((kind) => kind.id === id) || DOC_KINDS[0];
}

/* --------------------------------------------------------------------- labels -------- */
// Printed-page vocabulary. English is complete; a language only needs to override what it
// actually changes, and `labelsFor` fills the rest back in from English — a half-translated
// invoice with two English words in it is still a usable document, a crashed one is not.
const EN = {
  // document titles
  taxInvoice: 'TAX INVOICE',
  billOfSupply: 'BILL OF SUPPLY',
  // Rule 49, printed verbatim. The English wording is the statutory one and is deliberately
  // NOT softened — this is the sentence an inspector reads. The Hindi and Marathi copies
  // below carry the English in brackets for the same reason.
  compositionDeclaration:
    'Composition taxable person, not eligible to collect tax on supplies',
  invoice: 'INVOICE',
  cashMemo: 'CASH MEMO',
  estimate: 'ESTIMATE / QUOTATION',
  proforma: 'PROFORMA INVOICE',
  challan: 'DELIVERY CHALLAN',
  creditNote: 'CREDIT NOTE',
  returnNote: 'RETURN NOTE',
  debitNote: 'DEBIT NOTE',

  copyOriginal: 'ORIGINAL FOR RECIPIENT',
  copyDuplicate: 'DUPLICATE FOR TRANSPORTER',
  copyTriplicate: 'TRIPLICATE FOR SUPPLIER',

  // header / meta
  invoiceNo: 'Invoice No.',
  documentNo: 'Document No.',
  date: 'Date',
  dueDate: 'Due date',
  placeOfSupply: 'Place of Supply',
  counter: 'Counter',
  billedBy: 'Billed by',
  prescription: 'Prescription',
  poNumber: 'P.O. No.',
  transport: 'Transport',
  vehicleNo: 'Vehicle No.',
  ewayBill: 'E-Way Bill No.',
  validUntil: 'Valid until',

  // parties
  billTo: 'Bill To',
  shipTo: 'Ship To',
  payment: 'Payment',
  status: 'Status',
  paidInFull: 'Paid in full',
  partiallyPaid: 'Partially paid',
  paymentDue: 'Payment due',
  coupon: 'Coupon',
  cashCustomer: 'Cash Customer',
  // Who to ask for when the firm above is rung.
  attn: 'Attn',

  // items table
  sr: '#',
  itemDescription: 'Item Description',
  hsn: 'HSN',
  batch: 'Batch',
  expiry: 'Exp',
  mrp: 'MRP',
  qty: 'Qty',
  rate: 'Rate',
  disc: 'Disc.',
  taxable: 'Taxable',
  amount: 'Amount',
  total: 'Total',
  item: 'item',
  items: 'items',
  returned: 'Returned',
  free: 'Free',
  // Goods carry an HSN, services carry an SAC. A bill with both gets the combined heading.
  sac: 'SAC',
  hsnSac: 'HSN/SAC',
  // The two lines an electronics / mobile / autoparts bill exists for after the customer
  // has left the shop.
  serialNo: 'S/N',
  warrantyTill: 'Warranty till {date}',
  // Service counters: who actually did the work, not who rang it up.
  servedBy: 'Served by',
  // Restaurant / dhaba floor.
  tableNo: 'Table',
  guests: 'Guests',
  orderTypeDineIn: 'Dine-in',
  orderTypeParcel: 'Parcel',
  orderTypeDelivery: 'Delivery',
  // A cancelled bill must never read as a live demand for money.
  cancelled: 'CANCELLED',
  cancelledNote: 'This bill has been cancelled and is not a demand for payment.',
  reverseCharge: 'Reverse charge',
  no: 'No',
  // Credit note.
  againstInvoice: 'Against Invoice',
  reason: 'Reason',
  refundMode: 'Refund mode',

  // blocks
  taxSummary: 'Tax Summary',
  gstPercent: 'GST %',
  totalTax: 'Total Tax',
  amountInWords: 'Amount in Words',
  balanceInWords: 'Balance due',
  bankDetails: 'Bank Details',
  acName: 'A/c Name',
  bank: 'Bank',
  acNo: 'A/c No.',
  ifsc: 'IFSC',
  returnsAdjusted: 'Returns Adjusted',
  terms: 'Terms & Conditions',
  notes: 'Notes',
  accountSummary: 'Account Summary',
  thisBill: 'This bill',
  totalOutstanding: 'Total outstanding (all bills)',

  // totals
  subTotal: 'Sub Total',
  taxableValue: 'Taxable Value',
  itemDiscount: 'Item discount',
  free: 'FREE',
  discount: 'Discount',
  couponDiscount: 'Coupon discount',
  loyaltyPoints: 'Loyalty points',
  totalInclGst: 'Total (incl. GST)',
  roundOff: 'Round off',
  grandTotal: 'Grand Total',
  amountPaid: 'Amount paid',
  returnsCredited: 'Returns credited',
  balanceDue: 'Balance due',
  youSaved: 'You saved {amount} on this bill',
  belowMrp: '{amount} below MRP',
  pointsEarned: 'Loyalty points earned',

  // footer
  scanToPay: 'Scan to pay {amount}',
  jurisdiction: 'Subject to {place} jurisdiction.',
  forShop: 'For {shop}',
  authorisedSignatory: 'Authorised Signatory',
  receivedBy: 'Received in good condition',
  receiverSign: 'Receiver’s Signature',
  eoe: 'E. & O.E.',
  computerGenerated: 'This is a computer-generated document.',
  thankYou: 'Thank you for your business 🙏',
  continued: 'continued…',
  // The platform's one line on a document a customer takes home. Kept as a sentence about
  // *how the bill was made* rather than a brand stamp — a credit, not an advertisement.
  // It prints on the Free plan and any paid plan can switch it off (utils/appCredit.js).
  appCredit: 'Powered by BillVyse',

  // disclaimers printed on non-tax documents
  noteEstimate: 'This is an estimate only — not a tax invoice. Prices and availability may change.',
  noteProforma: 'Proforma invoice — issued for reference only. Not valid for input tax credit.',
  noteChallan: 'Delivery challan — issued with goods. Not a tax invoice.',
  noteCashMemo: 'Cash memo — issued against payment received.',
  noteCreditNote: 'Credit note issued against the invoice referenced above. It reduces the amount payable on that invoice.',
  noteDebitNote: 'Debit note raised on the supplier named above for goods returned or amounts overcharged. The amount stated has been debited to their account.',
};

const HI = {
  taxInvoice: 'टैक्स इनवॉइस',
  billOfSupply: 'बिल ऑफ़ सप्लाई',
  compositionDeclaration:
    'कंपोज़िशन करदाता — सप्लाई पर टैक्स वसूलने का अधिकार नहीं (Composition taxable person, not eligible to collect tax on supplies)',
  invoice: 'बिल',
  cashMemo: 'कैश मेमो',
  estimate: 'अनुमान / कोटेशन',
  proforma: 'प्रोफ़ॉर्मा इनवॉइस',
  challan: 'डिलीवरी चालान',
  creditNote: 'क्रेडिट नोट',
  debitNote: 'डेबिट नोट',
  returnNote: 'वापसी नोट',

  copyOriginal: 'मूल प्रति — ग्राहक के लिए',
  copyDuplicate: 'द्वितीय प्रति — ट्रांसपोर्टर के लिए',
  copyTriplicate: 'तृतीय प्रति — दुकान के लिए',

  invoiceNo: 'बिल नं.',
  documentNo: 'दस्तावेज़ नं.',
  date: 'दिनांक',
  dueDate: 'देय तिथि',
  placeOfSupply: 'सप्लाई का स्थान',
  counter: 'काउंटर',
  billedBy: 'बिल बनाया',
  prescription: 'पर्चा',
  poNumber: 'ऑर्डर नं.',
  transport: 'ट्रांसपोर्ट',
  vehicleNo: 'गाड़ी नं.',
  ewayBill: 'ई-वे बिल नं.',
  validUntil: 'मान्य तिथि तक',

  billTo: 'ग्राहक',
  shipTo: 'भेजने का पता',
  payment: 'भुगतान',
  status: 'स्थिति',
  paidInFull: 'पूरा भुगतान',
  partiallyPaid: 'आंशिक भुगतान',
  paymentDue: 'भुगतान बाकी',
  coupon: 'कूपन',
  cashCustomer: 'नकद ग्राहक',
  attn: 'संपर्क',

  sr: 'क्र.',
  itemDescription: 'सामान का विवरण',
  hsn: 'HSN',
  batch: 'बैच',
  expiry: 'एक्सपायरी',
  mrp: 'MRP',
  qty: 'मात्रा',
  rate: 'भाव',
  disc: 'छूट',
  taxable: 'कर योग्य',
  amount: 'रकम',
  total: 'कुल',
  item: 'सामान',
  items: 'सामान',
  returned: 'वापस',
  free: 'मुफ़्त',
  sac: 'SAC',
  hsnSac: 'HSN/SAC',
  serialNo: 'सीरियल नं.',
  warrantyTill: 'वारंटी {date} तक',
  servedBy: 'सेवा दी',
  tableNo: 'टेबल',
  guests: 'व्यक्ति',
  orderTypeDineIn: 'बैठकर',
  orderTypeParcel: 'पार्सल',
  orderTypeDelivery: 'डिलीवरी',
  cancelled: 'रद्द',
  cancelledNote: 'यह बिल रद्द कर दिया गया है — इस पर कोई भुगतान देय नहीं है।',
  reverseCharge: 'रिवर्स चार्ज',
  no: 'नहीं',
  againstInvoice: 'किस बिल के विरुद्ध',
  reason: 'कारण',
  refundMode: 'वापसी का तरीका',

  taxSummary: 'कर विवरण',
  gstPercent: 'GST %',
  totalTax: 'कुल कर',
  amountInWords: 'रकम शब्दों में',
  balanceInWords: 'बकाया',
  bankDetails: 'बैंक विवरण',
  acName: 'खाता नाम',
  bank: 'बैंक',
  acNo: 'खाता नं.',
  ifsc: 'IFSC',
  returnsAdjusted: 'वापसी समायोजित',
  terms: 'नियम और शर्तें',
  notes: 'टिप्पणी',
  accountSummary: 'खाता सारांश',
  thisBill: 'यह बिल',
  totalOutstanding: 'कुल बकाया (सभी बिल)',

  subTotal: 'कुल जोड़',
  taxableValue: 'कर योग्य मूल्य',
  itemDiscount: 'सामान पर छूट',
  free: 'फ्री',
  discount: 'छूट',
  couponDiscount: 'कूपन छूट',
  loyaltyPoints: 'पॉइंट्स',
  totalInclGst: 'कुल (GST सहित)',
  roundOff: 'राउंड ऑफ़',
  grandTotal: 'कुल देय',
  amountPaid: 'जमा रकम',
  returnsCredited: 'वापसी जमा',
  balanceDue: 'बकाया',
  youSaved: 'इस बिल पर आपने {amount} बचाए',
  belowMrp: 'MRP से {amount} कम',
  pointsEarned: 'मिले पॉइंट्स',

  scanToPay: '{amount} का भुगतान — स्कैन करें',
  jurisdiction: '{place} न्यायक्षेत्र के अधीन।',
  forShop: '{shop} के लिए',
  authorisedSignatory: 'अधिकृत हस्ताक्षरकर्ता',
  receivedBy: 'सामान सही हालत में मिला',
  receiverSign: 'प्राप्तकर्ता के हस्ताक्षर',
  eoe: 'भूल-चूक लेनी-देनी',
  computerGenerated: 'यह कंप्यूटर से बना दस्तावेज़ है।',
  thankYou: 'आपके भरोसे के लिए धन्यवाद 🙏',
  continued: 'आगे जारी…',
  // The product name stays in Latin script in every language — it is a name, and a
  // transliterated one on a bill reads as a different company.
  appCredit: 'Powered by BillVyse',

  noteEstimate: 'यह केवल अनुमान है — टैक्स इनवॉइस नहीं। भाव और उपलब्धता बदल सकती है।',
  noteProforma: 'प्रोफ़ॉर्मा इनवॉइस — केवल जानकारी के लिए। इनपुट टैक्स क्रेडिट के लिए मान्य नहीं।',
  noteChallan: 'डिलीवरी चालान — सामान के साथ जारी। यह टैक्स इनवॉइस नहीं है।',
  noteCashMemo: 'कैश मेमो — प्राप्त भुगतान के विरुद्ध जारी।',
  noteCreditNote: 'ऊपर लिखे बिल के विरुद्ध जारी क्रेडिट नोट। इससे उस बिल की देय रकम कम होती है।',
  noteDebitNote: 'ऊपर लिखे सप्लायर पर बनाया गया डेबिट नोट — वापस किया गया माल या ज़्यादा लगाई गई रकम के लिए। यह रकम उनके खाते से काट ली गई है।',
};

const MR = {
  taxInvoice: 'टॅक्स इनव्हॉइस',
  billOfSupply: 'बिल ऑफ सप्लाय',
  compositionDeclaration:
    'कंपोझिशन करदाता — पुरवठ्यावर कर वसूल करण्यास पात्र नाही (Composition taxable person, not eligible to collect tax on supplies)',
  invoice: 'बिल',
  cashMemo: 'कॅश मेमो',
  estimate: 'अंदाज / कोटेशन',
  proforma: 'प्रोफॉर्मा इनव्हॉइस',
  challan: 'डिलिव्हरी चलन',
  creditNote: 'क्रेडिट नोट',
  debitNote: 'डेबिट नोट',
  returnNote: 'परतावा नोट',

  copyOriginal: 'मूळ प्रत — ग्राहकासाठी',
  copyDuplicate: 'दुसरी प्रत — ट्रान्सपोर्टरसाठी',
  copyTriplicate: 'तिसरी प्रत — दुकानासाठी',

  invoiceNo: 'बिल क्र.',
  documentNo: 'दस्तऐवज क्र.',
  date: 'दिनांक',
  dueDate: 'देय दिनांक',
  placeOfSupply: 'पुरवठ्याचे ठिकाण',
  counter: 'काउंटर',
  billedBy: 'बिल केले',
  prescription: 'औषधचिठ्ठी',
  poNumber: 'ऑर्डर क्र.',
  transport: 'ट्रान्सपोर्ट',
  vehicleNo: 'गाडी क्र.',
  ewayBill: 'ई-वे बिल क्र.',
  validUntil: 'वैध दिनांकापर्यंत',

  billTo: 'ग्राहक',
  shipTo: 'पाठवण्याचा पत्ता',
  payment: 'पेमेंट',
  status: 'स्थिती',
  paidInFull: 'पूर्ण भरणा',
  partiallyPaid: 'अर्धवट भरणा',
  paymentDue: 'भरणा बाकी',
  coupon: 'कूपन',
  cashCustomer: 'रोख ग्राहक',
  attn: 'संपर्क',

  sr: 'क्र.',
  itemDescription: 'मालाचे वर्णन',
  hsn: 'HSN',
  batch: 'बॅच',
  expiry: 'एक्सपायरी',
  mrp: 'MRP',
  qty: 'नग',
  rate: 'दर',
  disc: 'सूट',
  taxable: 'करपात्र',
  amount: 'रक्कम',
  total: 'एकूण',
  item: 'माल',
  items: 'माल',
  returned: 'परत',
  free: 'मोफत',
  sac: 'SAC',
  hsnSac: 'HSN/SAC',
  serialNo: 'सिरियल क्र.',
  warrantyTill: 'वॉरंटी {date} पर्यंत',
  servedBy: 'सेवा दिली',
  tableNo: 'टेबल',
  guests: 'व्यक्ती',
  orderTypeDineIn: 'बसून',
  orderTypeParcel: 'पार्सल',
  orderTypeDelivery: 'डिलिव्हरी',
  cancelled: 'रद्द',
  cancelledNote: 'हे बिल रद्द केले आहे — यावर कोणतीही रक्कम देय नाही.',
  reverseCharge: 'रिव्हर्स चार्ज',
  no: 'नाही',
  againstInvoice: 'कोणत्या बिलाविरुद्ध',
  reason: 'कारण',
  refundMode: 'परताव्याची पद्धत',

  taxSummary: 'कर तपशील',
  gstPercent: 'GST %',
  totalTax: 'एकूण कर',
  amountInWords: 'रक्कम अक्षरी',
  balanceInWords: 'बाकी',
  bankDetails: 'बँक तपशील',
  acName: 'खाते नाव',
  bank: 'बँक',
  acNo: 'खाते क्र.',
  ifsc: 'IFSC',
  returnsAdjusted: 'परतावा समायोजित',
  terms: 'अटी व शर्ती',
  notes: 'टीप',
  accountSummary: 'खाते सारांश',
  thisBill: 'हे बिल',
  totalOutstanding: 'एकूण बाकी (सर्व बिले)',

  subTotal: 'एकूण बेरीज',
  taxableValue: 'करपात्र रक्कम',
  itemDiscount: 'मालावरील सूट',
  free: 'फ्री',
  discount: 'सूट',
  couponDiscount: 'कूपन सूट',
  loyaltyPoints: 'पॉइंट्स',
  totalInclGst: 'एकूण (GST सह)',
  roundOff: 'राउंड ऑफ',
  grandTotal: 'एकूण देय',
  amountPaid: 'जमा रक्कम',
  returnsCredited: 'परतावा जमा',
  balanceDue: 'बाकी',
  youSaved: 'या बिलावर तुम्ही {amount} वाचवले',
  belowMrp: 'MRP पेक्षा {amount} कमी',
  pointsEarned: 'मिळालेले पॉइंट्स',

  scanToPay: '{amount} भरण्यासाठी स्कॅन करा',
  jurisdiction: '{place} न्यायक्षेत्राच्या अधीन.',
  forShop: '{shop} साठी',
  authorisedSignatory: 'अधिकृत सहीदार',
  receivedBy: 'माल सुस्थितीत मिळाला',
  receiverSign: 'घेणाऱ्याची सही',
  eoe: 'चूकभूल देणे-घेणे',
  computerGenerated: 'हा संगणकाने तयार केलेला दस्तऐवज आहे.',
  thankYou: 'तुमच्या विश्वासाबद्दल धन्यवाद 🙏',
  continued: 'पुढे चालू…',
  appCredit: 'Powered by BillVyse',

  noteEstimate: 'हा फक्त अंदाज आहे — टॅक्स इनव्हॉइस नाही. दर व उपलब्धता बदलू शकते.',
  noteProforma: 'प्रोफॉर्मा इनव्हॉइस — फक्त माहितीसाठी. इनपुट टॅक्स क्रेडिटसाठी वैध नाही.',
  noteChallan: 'डिलिव्हरी चलन — मालासोबत दिलेले. हे टॅक्स इनव्हॉइस नाही.',
  noteCashMemo: 'कॅश मेमो — मिळालेल्या रकमेपोटी दिलेला.',
  noteCreditNote: 'वर लिहिलेल्या बिलाविरुद्ध दिलेली क्रेडिट नोट. यामुळे त्या बिलाची देय रक्कम कमी होते.',
  noteDebitNote: 'वर लिहिलेल्या पुरवठादारावर काढलेली डेबिट नोट — परत केलेला माल किंवा जास्त लावलेली रक्कम. ही रक्कम त्यांच्या खात्यातून वजा केली आहे.',
};

const DICTIONARIES = { en: EN, hi: HI, mr: MR };

// The languages a bill can be *printed* in. Fewer than the app's ten on purpose: a bill is
// a legal-ish document and a half-guessed translation on it is worse than English. These
// three are complete; adding a fourth means adding a full dictionary above, nothing else.
export const INVOICE_LANGUAGES = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'hi', name: 'Hindi', native: 'हिंदी' },
  { id: 'mr', name: 'Marathi', native: 'मराठी' },
];

/**
 * Returns a `t(key, vars)` for the printed page.
 *
 * Unknown keys return the key itself rather than throwing — a missing label must never be
 * able to blank out a bill the shopkeeper is about to hand over.
 */
export function labelsFor(lang = 'en') {
  const dictionary = { ...EN, ...(DICTIONARIES[lang] || {}) };
  return function label(key, vars) {
    let text = dictionary[key] ?? EN[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, value);
      }
    }
    return text;
  };
}

// Swaps the document-number prefix when a bill is reprinted as something other than an
// invoice: INV/2026-27/0042 → EST/2026-27/0042. A quotation carrying the tax-invoice number
// of a real sale is the kind of thing that gets noticed in an audit.
export function renumberFor(number, kindId) {
  const kind = docKindById(kindId);
  if (!kind.prefix || !number) return number;
  const parts = String(number).split('/');
  if (parts.length < 2) return `${kind.prefix}/${number}`;
  parts[0] = kind.prefix;
  return parts.join('/');
}
