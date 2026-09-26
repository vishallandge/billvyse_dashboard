import { LANGUAGE_CODES } from './i18n/meta';

// Server errors, in the shopkeeper's own language.
//
// The API cannot write these. A request arriving at /api/auth/login carries no session, no
// profile and no language preference — the server genuinely does not know whether the
// person in front of the screen reads Tamil or Punjabi. So it sends a stable `code` and an
// English sentence, and this file turns the code into the sentence the user actually reads.
//
// That split is why the messages moved out of the controllers: they used to be written in
// Hinglish there, so a shop running the dashboard in Marathi still got "Page purana ho gaya
// hai" back from the server. Adding ten translations to a controller would not have fixed
// it either — the controller has nothing to pick between them with.
//
// Anything without a translation falls back to the server's English `message`, so an error
// added to the API tomorrow is still readable today; it just isn't localised yet.

const MESSAGES = {
  en: {
    SUPPLIER_OWN_NUMBER: "This is your own shop's number. A shop cannot be its own supplier — to sell to other shops, turn on Sell to Shops and send them your invite link.",
    STOREFRONT_HALF_WINDOW: 'Fill in both the opening and the closing time, or leave both blank.',
    SESSION_REVOKED: 'You were signed out on all devices. Please sign in again.',
    AUTH_REAUTH_REQUIRED: 'Confirm it is you before changing this.',
    AUTH_REAUTH_FAILED: 'That is not your current password.',
    AUTH_REAUTH_WRONG_ACCOUNT: 'That is a different Google account — nothing was changed.',
    ACCOUNT_DELETE_NAME_MISMATCH: 'That is not the shop name on this account. Type it exactly as it appears.',
    ACCOUNT_DELETION_SCHEDULED: 'This account is scheduled for deletion.',
    ACCOUNT_DELETION_CANCELLED: 'Deletion cancelled. Nothing was removed.',
    ACCOUNT_DELETION_NOT_SCHEDULED: 'Nothing was scheduled for deletion.',
    SUPPORT_MESSAGE_TOO_SHORT: 'Write a line or two more, so we know what to look at.',
    SUPPORT_MESSAGE_TOO_LONG: 'That is too long to send in one go — send the rest in the reply.',
    SUPPORT_SEND_FAILED: 'That could not be sent from here right now. WhatsApp still reaches us.',
    RATE_LIMIT_SUPPORT: 'A few support mails have already gone from this shop in the last hour. WhatsApp us and we will pick it up there.',
    // The Hindi and Marathi versions of the four lines above used to sit right here, inside
    // `en` — and a later duplicate key wins, so the ENGLISH screen showed them in Marathi.
    // They live in `hi` and `mr` now.
    SUPPORT_NOTE_EMPTY: 'Write what happened — even a few words, just not blank.',
    SUPPORT_NO_REPLY_ADDRESS: 'This ticket has no email address — untick "Also email a copy"; the reply still reaches the shop in its app.',
    SUPPORT_REPLY_EMPTY: 'Please write your reply.',
    SUPPORT_TICKET_NOT_FOUND: 'That question could not be found.',
    SUPPORT_NOT_RESOLVED: 'This question is not waiting for a confirmation any more.',
    ACCOUNT_DELETION_REQUEST_RECEIVED: 'We have your request and will write to that address to confirm.',
    INVALID_EMAIL: 'Enter a valid email address.',
    AUTH_GOOGLE_UNAVAILABLE: 'Google sign-in is not set up on the server yet.',
    AUTH_NO_ACCOUNT: 'This account could not be found.',
    AUTH_PASSWORD_CHANGED: 'Password changed.',
    AUTH_PASSWORD_SET: 'Password set.',
    AUTH_SESSIONS_REVOKED: 'Signed out on all other devices.',
    PASSWORD_UNCHANGED: 'The new password is the same as the old one.',
    PASSWORD_TOO_SHORT: 'Too short — use at least 8 characters.',
    PASSWORD_TOO_LONG: 'That is too long. Keep it under 72 characters.',
    PASSWORD_HAS_EDGE_SPACES: 'Remove the space at the start or the end — you will not see it when signing in.',
    PASSWORD_TOO_COMMON: 'That is one of the first passwords anybody would try.',
    PASSWORD_TOO_SIMPLE: 'That is too easy to guess. Mix it up a little.',
    PASSWORD_NEEDS_LETTER: 'Digits alone are easy to guess — add at least one letter.',
    PASSWORD_LOOKS_LIKE_EMAIL: 'Do not use your email address as your password.',
    PASSWORD_LOOKS_LIKE_NAME: 'Do not use your own name as your password.',
    RATE_LIMIT_PASSWORD_CHANGE: 'Too many attempts. Please wait 15 minutes and try again.',
    STOREFRONT_AMOUNT: 'Enter an amount between ₹0 and ₹1,00,000.',
    STOREFRONT_PREP_TIME: 'Ready-in time has to be between 0 minutes and 24 hours.',
    STOREFRONT_TIME: 'Enter a time like 09:30.',
    SCAN_SCALE_NO_ITEM: 'The scale sticker was read fine — no product carries this item number yet. Add it to that product’s alternate codes',
    /* Reading a supplier's bill (see BillScanModal). The server writes these in
       romanised Hinglish for its logs; these are the sentences the shopkeeper sees. */
    AI_FAILED: 'The bill could not be read this time. The photos are still here — try again.',
    AI_RATE_LIMIT: 'Too many bills are being read right now. Try again in a minute.',
    AI_BAD_JSON: 'The reading came back garbled. Try again.',
    AI_REFUSED: 'This image could not be read. Send a photo of the bill itself.',
    AI_EMPTY: 'Nothing could be read off this bill. Check the photo is sharp and the print is in frame.',
    AI_TRUNCATED: 'This bill is too long to read in one go. Send it as separate pages.',
    AI_AUTH: 'Bill reading is not switched on for this server. Please tell support.',
    AI_MODEL_UNKNOWN: 'Bill reading is misconfigured on this server. Please tell support.',
    AI_BAD_REQUEST: 'Bill reading is misconfigured on this server. Please tell support.',
    NO_IMAGE: 'No photo arrived. Choose the bill photo again.',
    EMPTY_IMAGE: 'One of the photos was empty. Choose it again.',
    BAD_MEDIA_TYPE: 'Only a JPG, PNG or WEBP photo can be read.',
    IMAGE_TOO_LARGE: 'That photo is too big. Send one page at a time.',
    PAYLOAD_TOO_LARGE: 'Those photos are too big together. Send one page at a time.',
    TOO_MANY_IMAGES: 'A scan reads one bill. Send the next bill as its own photo.',
    /* Not a failure of the work — the same request arrived twice (a retry after a slow
       reply) and the first copy is still running. See backend/middleware/idempotency.js. */
    IDEMPOTENCY_IN_PROGRESS: 'This is still going through. Give it a few seconds — nothing was lost.',
    IDEMPOTENCY_MISMATCH: 'Something changed while this was being sent. Refresh the page and try again.',
    REQUEST_TIMEOUT: 'That took longer than it should have. Please try again.',
    TOO_MANY_IMAGES: 'Too many pages at once. Send up to 3.',
    STOREFRONT_PAUSE_UNTIL: 'That is not a valid date and time.',
    STOREFRONT_ALL_DAYS_OFF: 'You cannot mark every day as a weekly off — switch online orders off instead.',
    STOREFRONT_NO_FULFILMENT: 'Keep pick-up or delivery switched on, or customers have no way to order at all.',
    STOREFRONT_FREE_WITHOUT_CHARGE: 'You have set free delivery above an amount but no delivery charge, so nothing would ever be charged.',
    STOREFRONT_FREE_BELOW_MIN: 'Free delivery starts below your minimum order, so every order you accept would be free anyway.',
    PLAN_UPGRADE_REQUIRED: '{feature} is part of {plan} — ₹{price}/month. Upgrade to switch it on.',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} is not included on any plan right now.',
    // Shown in the Google Play build, where no price is sent. States the fact and stops —
    // naming the website is allowed, linking to it is not (see upgradeVariant above).
    PLAN_UPGRADE_ELSEWHERE: '{feature} is part of {plan}. Plans are managed on the BillVyse website.',
    PLAN_LIMIT_REACHED: 'You have used {used} of {limit} this month. {plan} removes the limit — ₹{price}/month.',
    PLAN_LIMIT_REACHED_FINAL: 'You have used {used} of {limit} for this month. It resets on the 1st.',
    PLAN_COUNT_LIMIT_REACHED: 'Your plan allows {limit} {feature}. {plan} allows {newLimit} — ₹{price}/month.',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'Your plan allows {limit} {feature}, and that is the most any plan allows.',
    PLAN_COUNT_LIMIT_UNLIMITED: 'Your plan allows {limit} {feature}. {plan} removes the limit — ₹{price}/month.',
    USAGE_LIMIT_REACHED: 'This month\'s {feature} are finished ({limit} used). They reset on the 1st, or {plan} gives you {newLimit} a month — ₹{price}/month.',
    USAGE_LIMIT_REACHED_FINAL: 'This month\'s {feature} are finished ({limit} used). They reset on the 1st.',
    EXPENSE_FROM_PAYROLL: 'This kharcha was created when you paid staff. Change or remove it on the Staff screen — that keeps the pagaar sheet and your books saying the same thing.',
    STAFF_HAS_HISTORY: 'This account has work recorded against it. Offboard instead — that ends their access and keeps the history.',
    AUTH_EMAIL_NOT_VERIFIED: 'Please confirm your email address first.',
    AUTH_EMAIL_INVALID: 'That email address does not look right.',
    AUTH_OTP_INVALID: 'That code is wrong or has expired. Ask for a new one.',
    AUTH_OTP_LOCKED: 'Too many wrong codes. Please ask for a new one.',
    AUTH_OTP_MISSING: 'Enter the code we emailed you.',
    EMAIL_NOT_CONFIGURED: 'Sign-ups are paused right now. Please try again later.',
    RATE_LIMIT_EMAIL_OTP: 'Too many codes requested. Please wait 15 minutes.',
    CSRF_FAILED: 'This page has gone stale. Please refresh and try again.',
    NOT_AUTHENTICATED: 'You are not signed in. Please sign in again.',
    SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
    ACCOUNT_INACTIVE: 'This account is no longer active. Please speak to the shop owner.',
    AUTH_ACCOUNT_SUSPENDED: 'This account has been suspended',
    AUTH_INVALID_CREDENTIALS: 'Wrong email or password.',
    AUTH_MISSING_CREDENTIALS: 'Enter your email and password.',
    AUTH_PHONE_MISSING: 'Enter your mobile number.',
    AUTH_PHONE_INVALID: 'Enter a valid 10-digit mobile number.',
    AUTH_PHONE_NOT_FOUND: 'No shop is registered with this mobile number yet. Try email, or add this number in Settings first.',
    AUTH_PHONE_OTP_MISSING: 'Enter your mobile number and the code.',
    AUTH_OTP_SEND_FAILED: 'Could not send the code just now. Please try again shortly.',
    SHOP_PHONE_ALREADY_LINKED: 'This mobile number is already linked to another shop. Please use a different number.',
    AUTH_MISSING_SIGNUP_FIELDS: 'Name, email, password and shop name are all needed.',
    AUTH_TERMS_NOT_ACCEPTED: 'Please accept the Terms of Service and Privacy Policy to create your shop.',
    GSTIN_DECLARATION_REQUIRED: 'Confirm that the GSTIN belongs to your business before saving it.',
    GSTIN_ALREADY_CLAIMED: 'This GSTIN is already registered on another account. If it is yours, write to billvyse.india@gmail.com.',
    AUTH_EMAIL_EXISTS: 'This email is already registered. Please sign in instead.',
    USE_GOOGLE_SIGNIN: 'This account was created with Google. Use the "Sign in with Google" button.',
    REGISTRATION_CLOSED: 'New shop sign-ups are closed right now. Please try again later.',
    AUTH_GOOGLE_NOT_CONFIGURED: 'Google Sign-In is not set up on the server yet.',
    AUTH_GOOGLE_UNVERIFIED: 'Google sign-in could not be verified. Please try again.',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google sign-in did not complete. Please try again.',
    AUTH_EMAIL_REQUIRED: 'Enter your email address.',
    AUTH_RESET_EMAIL_SENT: 'If this email is registered, we have sent a reset link. Please check your inbox.',
    AUTH_RESET_LINK_EXPIRED: 'This reset link has expired. Please request a new one.',
    AUTH_RESET_MISSING_FIELDS: 'Enter your email and a new password.',
    AUTH_PASSWORD_TOO_SHORT: 'Password must be at least 6 characters.',
    AUTH_PASSWORD_CHANGED: 'Password changed. Sign in with your new password.',
    RATE_LIMIT_LOGIN: 'Too many failed sign-in attempts. Please try again in 15 minutes.',
    RATE_LIMIT_PHONE_LOGIN: 'Too many sign-in attempts from this network. Please try again in an hour.',
    RATE_LIMIT_REGISTER: 'Too many sign-up attempts from this device. Please try again later.',
    RATE_LIMIT_PASSWORD_RESET: 'Too many password reset requests. Please try again in an hour.',
    RATE_LIMIT_GENERIC: 'Requests are coming in too fast. Please wait a minute and try again.',
    NETWORK: 'Could not reach the server. Check your internet connection and try again.',
    SERVER_ERROR: 'Something went wrong. Please try again.',
    GENERIC: 'Something went wrong. Please try again.',
  },

  hi: {
    SUPPLIER_OWN_NUMBER: 'यह आपकी अपनी दुकान का नंबर है। दुकान खुद की सप्लायर नहीं बन सकती — दूसरी दुकानों को माल बेचना है तो Sell to Shops चालू करें और उन्हें अपना इनवाइट लिंक भेजें।',
    SUPPORT_MESSAGE_TOO_SHORT: 'एक-दो लाइन और लिखिए, तभी पता चलेगा कि कहाँ देखना है।',
    SUPPORT_MESSAGE_TOO_LONG: 'इतना लंबा एक बार में नहीं जाएगा — बाकी जवाब में लिख दीजिए।',
    SUPPORT_SEND_FAILED: 'अभी यहाँ से नहीं भेजा जा सका। व्हाट्सएप से हम तक पहुँच जाएगा।',
    RATE_LIMIT_SUPPORT: 'पिछले एक घंटे में इस दुकान से कुछ मेल जा चुकी हैं। व्हाट्सएप कर दीजिए, वहीं से आगे बात होगी।',
    SUPPORT_NOTE_EMPTY: 'क्या हुआ लिखिए — दो शब्द भी चलेंगे, पर खाली नहीं।',
    SUPPORT_NO_REPLY_ADDRESS: 'इस टिकट पर कोई ईमेल पता नहीं है — "ईमेल से भी भेजें" हटाइए; जवाब दुकान के ऐप में फिर भी पहुँचेगा।',
    SUPPORT_REPLY_EMPTY: 'कृपया अपना जवाब लिखिए।',
    SUPPORT_TICKET_NOT_FOUND: 'यह सवाल नहीं मिला।',
    SUPPORT_NOT_RESOLVED: 'यह सवाल अब पुष्टि का इंतज़ार नहीं कर रहा।',
    STOREFRONT_HALF_WINDOW: 'खुलने और बंद होने — दोनों समय भरें, या दोनों खाली छोड़ें।',
    SESSION_REVOKED: 'सभी डिवाइस से लॉगआउट कर दिया गया था। दोबारा लॉगिन कीजिए।',
    AUTH_REAUTH_REQUIRED: 'बदलने से पहले पक्का कीजिए कि यह आप ही हैं।',
    AUTH_REAUTH_FAILED: 'यह आपका अभी वाला पासवर्ड नहीं है।',
    AUTH_REAUTH_WRONG_ACCOUNT: 'यह दूसरा Google खाता है — कुछ नहीं बदला गया।',
    ACCOUNT_DELETE_NAME_MISMATCH: 'इस अकाउंट पर दुकान का नाम यह नहीं है। बिलकुल वैसा ही लिखिए जैसा दिख रहा है।',
    ACCOUNT_DELETION_SCHEDULED: 'यह अकाउंट मिटाने के लिए लगा दिया गया है।',
    ACCOUNT_DELETION_CANCELLED: 'डिलीट रोक दी गई। कुछ नहीं हटा।',
    ACCOUNT_DELETION_NOT_SCHEDULED: 'मिटाने के लिए कुछ लगा ही नहीं था।',
    ACCOUNT_DELETION_REQUEST_RECEIVED: 'आपकी request मिल गई है। पक्का करने के लिए हम उसी ईमेल पर लिखेंगे।',
    INVALID_EMAIL: 'सही ईमेल पता डालिए।',
    AUTH_GOOGLE_UNAVAILABLE: 'सर्वर पर Google लॉगिन अभी सेट नहीं है।',
    AUTH_NO_ACCOUNT: 'यह खाता नहीं मिला।',
    AUTH_PASSWORD_CHANGED: 'पासवर्ड बदल गया।',
    AUTH_PASSWORD_SET: 'पासवर्ड लग गया।',
    AUTH_SESSIONS_REVOKED: 'बाक़ी सभी डिवाइस से लॉगआउट हो गया।',
    PASSWORD_UNCHANGED: 'नया पासवर्ड पुराने जैसा ही है।',
    PASSWORD_TOO_SHORT: 'बहुत छोटा है — कम से कम 8 अक्षर रखें।',
    PASSWORD_TOO_LONG: 'बहुत लंबा है। 72 अक्षर से कम रखें।',
    PASSWORD_HAS_EDGE_SPACES: 'शुरू या आख़िर की ख़ाली जगह हटाएँ — लॉगिन करते वक़्त वह दिखेगी नहीं।',
    PASSWORD_TOO_COMMON: 'यह उन पासवर्ड में है जो कोई भी सबसे पहले आज़माएगा।',
    PASSWORD_TOO_SIMPLE: 'यह बहुत आसानी से पकड़ा जाएगा। थोड़ा मिलाइए।',
    PASSWORD_NEEDS_LETTER: 'सिर्फ़ अंक आसानी से पकड़े जाते हैं — कम से कम एक अक्षर डालें।',
    PASSWORD_LOOKS_LIKE_EMAIL: 'अपना ईमेल पता पासवर्ड न बनाएँ।',
    PASSWORD_LOOKS_LIKE_NAME: 'अपना नाम पासवर्ड न बनाएँ।',
    RATE_LIMIT_PASSWORD_CHANGE: 'बहुत बार कोशिश हो गई। 15 मिनट रुककर फिर कीजिए।',
    STOREFRONT_AMOUNT: '₹0 से ₹1,00,000 के बीच रकम डालें।',
    STOREFRONT_PREP_TIME: 'तैयार होने का समय 0 मिनट से 24 घंटे के बीच होना चाहिए।',
    STOREFRONT_TIME: '09:30 जैसा समय डालें।',
    SCAN_SCALE_NO_ITEM: 'स्टिकर ठीक पढ़ लिया — इस आइटम नंबर का कोई प्रोडक्ट अभी नहीं है। उस प्रोडक्ट के alternate codes में ये नंबर डाल दो',
    AI_FAILED: 'इस बार बिल पढ़ा नहीं जा सका। फोटो यहीं हैं — दोबारा कोशिश कीजिए।',
    AI_RATE_LIMIT: 'अभी बहुत सारे बिल पढ़े जा रहे हैं। एक मिनट बाद कोशिश कीजिए।',
    AI_BAD_JSON: 'पढ़ा हुआ डेटा खराब आया। दोबारा कोशिश कीजिए।',
    AI_REFUSED: 'यह इमेज पढ़ी नहीं जा सकी। बिल की ही फोटो भेजिए।',
    AI_EMPTY: 'इस बिल से कुछ नहीं मिला। देख लीजिए फोटो साफ है और छपाई पूरी फ्रेम में है।',
    AI_TRUNCATED: 'यह बिल एक बार में पढ़ने के लिए बहुत लंबा है। पेज अलग-अलग करके भेजिए।',
    AI_AUTH: 'इस सर्वर पर बिल पढ़ना चालू नहीं है। सपोर्ट को बताइए।',
    AI_MODEL_UNKNOWN: 'इस सर्वर पर बिल पढ़ने की सेटिंग गलत है। सपोर्ट को बताइए।',
    AI_BAD_REQUEST: 'इस सर्वर पर बिल पढ़ने की सेटिंग गलत है। सपोर्ट को बताइए।',
    NO_IMAGE: 'कोई फोटो नहीं पहुँची। बिल की फोटो दोबारा चुनिए।',
    EMPTY_IMAGE: 'एक फोटो खाली थी। उसे दोबारा चुनिए।',
    BAD_MEDIA_TYPE: 'सिर्फ JPG, PNG या WEBP फोटो पढ़ी जा सकती है।',
    IMAGE_TOO_LARGE: 'यह फोटो बहुत बड़ी है। एक-एक पेज करके भेजिए।',
    PAYLOAD_TOO_LARGE: 'ये फोटो मिलकर बहुत बड़ी हैं। एक-एक पेज करके भेजिए।',
    TOO_MANY_IMAGES: 'एक स्कैन में एक ही बिल पढ़ा जाता है। अगला बिल अलग फोटो में भेजिए।',
    IDEMPOTENCY_IN_PROGRESS: 'यह अभी चल ही रहा है। कुछ सेकंड दीजिए — कुछ भी गया नहीं है।',
    IDEMPOTENCY_MISMATCH: 'भेजते समय कुछ बदल गया था। पेज रिफ्रेश करके दोबारा कोशिश कीजिए।',
    REQUEST_TIMEOUT: 'इसमें ज़रूरत से ज़्यादा समय लग गया। दोबारा कोशिश कीजिए।',
    TOO_MANY_IMAGES: 'एक बार में बहुत पेज हैं। ज़्यादा से ज़्यादा 3 भेजिए।',
    STOREFRONT_PAUSE_UNTIL: 'यह सही तारीख़ और समय नहीं है।',
    STOREFRONT_ALL_DAYS_OFF: 'हर दिन छुट्टी नहीं कर सकते — इसके बजाय ऑनलाइन ऑर्डर बंद कर दें।',
    STOREFRONT_NO_FULFILMENT: 'दुकान से ले जाना या डिलीवरी — कोई एक चालू रखें, वरना ग्राहक ऑर्डर ही नहीं कर पाएगा।',
    STOREFRONT_FREE_WITHOUT_CHARGE: 'मुफ़्त डिलीवरी की सीमा तो है पर डिलीवरी चार्ज नहीं — तो चार्ज कभी लगेगा ही नहीं।',
    STOREFRONT_FREE_BELOW_MIN: 'मुफ़्त डिलीवरी की सीमा कम से कम ऑर्डर से नीचे है, यानी हर ऑर्डर वैसे भी मुफ़्त हो जाएगा।',
    PLAN_UPGRADE_REQUIRED: '{feature} {plan} में मिलता है — ₹{price}/महीना। प्लान अपग्रेड करके चालू कीजिए।',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} अभी किसी भी प्लान में नहीं है।',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} में मिलता है। प्लान BillVyse वेबसाइट पर मैनेज होते हैं।',
    PLAN_LIMIT_REACHED: 'इस महीने {limit} में से {used} हो चुके। {plan} में कोई लिमिट नहीं — ₹{price}/महीना।',
    PLAN_LIMIT_REACHED_FINAL: 'इस महीने {limit} में से {used} हो चुके। 1 तारीख को दोबारा शुरू होगा।',
    PLAN_COUNT_LIMIT_REACHED: 'आपके प्लान में {limit} {feature} हैं। {plan} में {newLimit} — ₹{price}/महीना।',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'आपके प्लान में {limit} {feature} हैं, और किसी भी प्लान में इससे ज़्यादा नहीं।',
    PLAN_COUNT_LIMIT_UNLIMITED: 'आपके प्लान में {limit} {feature} हैं। {plan} में कोई लिमिट नहीं — ₹{price}/महीना।',
    USAGE_LIMIT_REACHED: 'इस महीने के {feature} खत्म ({limit} इस्तेमाल हुए)। 1 तारीख को रीसेट होंगे, या {plan} में हर महीने {newLimit} मिलते हैं — ₹{price}/महीना।',
    USAGE_LIMIT_REACHED_FINAL: 'इस महीने के {feature} खत्म ({limit} इस्तेमाल हुए)। 1 तारीख को रीसेट होंगे।',
    EXPENSE_FROM_PAYROLL: 'यह खर्चा स्टाफ को पगार देते समय बना था। इसे स्टाफ स्क्रीन से बदलें या हटाएं — तभी पगार की शीट और आपकी बही एक ही बात कहेंगी।',
    STAFF_HAS_HISTORY: 'इस खाते पर काम दर्ज है। इसके बजाय ऑफ़बोर्ड करें — इससे पहुंच बंद होती है और रिकॉर्ड बचा रहता है।',
    AUTH_EMAIL_NOT_VERIFIED: 'पहले अपना ईमेल कन्फर्म करें।',
    AUTH_EMAIL_INVALID: 'यह ईमेल पता सही नहीं लग रहा।',
    AUTH_OTP_INVALID: 'कोड ग़लत है या ख़त्म हो चुका है। नया कोड माँगें।',
    AUTH_OTP_LOCKED: 'बहुत बार ग़लत कोड डाला। नया कोड माँगें।',
    AUTH_OTP_MISSING: 'ईमेल पर आया कोड डालें।',
    EMAIL_NOT_CONFIGURED: 'नया रजिस्ट्रेशन अभी बंद है। थोड़ी देर बाद कोशिश करें।',
    RATE_LIMIT_EMAIL_OTP: 'बहुत बार कोड माँगा गया। 15 मिनट रुकें।',
    CSRF_FAILED: 'यह पेज पुराना हो गया है। पेज रिफ़्रेश करके दोबारा कोशिश करें।',
    NOT_AUTHENTICATED: 'आप लॉगिन नहीं हैं। कृपया दोबारा लॉगिन करें।',
    SESSION_EXPIRED: 'आपका सेशन ख़त्म हो गया। कृपया दोबारा लॉगिन करें।',
    ACCOUNT_INACTIVE: 'यह अकाउंट अब चालू नहीं है। दुकान मालिक से बात करें।',
    AUTH_ACCOUNT_SUSPENDED: 'यह अकाउंट बंद कर दिया गया है',
    AUTH_INVALID_CREDENTIALS: 'ईमेल या पासवर्ड ग़लत है।',
    AUTH_MISSING_CREDENTIALS: 'ईमेल और पासवर्ड दोनों भरें।',
    AUTH_PHONE_MISSING: 'अपना मोबाइल नंबर डालें।',
    AUTH_PHONE_INVALID: 'सही 10 अंकों का मोबाइल नंबर डालें।',
    AUTH_PHONE_NOT_FOUND: 'इस मोबाइल नंबर से अभी कोई दुकान रजिस्टर्ड नहीं है। ईमेल से लॉगिन करें, या पहले Settings में यह नंबर जोड़ें।',
    AUTH_PHONE_OTP_MISSING: 'अपना मोबाइल नंबर और कोड डालें।',
    AUTH_OTP_SEND_FAILED: 'अभी कोड नहीं भेजा जा सका। थोड़ी देर बाद कोशिश करें।',
    SHOP_PHONE_ALREADY_LINKED: 'यह मोबाइल नंबर पहले से किसी और दुकान से जुड़ा है। कृपया दूसरा नंबर डालें।',
    AUTH_MISSING_SIGNUP_FIELDS: 'नाम, ईमेल, पासवर्ड और दुकान का नाम — सब ज़रूरी हैं।',
    AUTH_TERMS_NOT_ACCEPTED: 'दुकान बनाने के लिए Terms of Service और Privacy Policy स्वीकार करें।',
    GSTIN_DECLARATION_REQUIRED: 'सेव करने से पहले पुष्टि करें कि यह GSTIN आपके बिज़नेस का है।',
    GSTIN_ALREADY_CLAIMED: 'यह GSTIN पहले से किसी और खाते पर दर्ज है। अगर यह आपका ही है तो billvyse.india@gmail.com पर लिखें।',
    AUTH_EMAIL_EXISTS: 'यह ईमेल पहले से रजिस्टर्ड है। सीधे लॉगिन करें।',
    USE_GOOGLE_SIGNIN: 'यह अकाउंट Google से बना है। "Sign in with Google" दबाएँ।',
    REGISTRATION_CLOSED: 'नई दुकान का रजिस्ट्रेशन अभी बंद है। थोड़ी देर बाद कोशिश करें।',
    AUTH_GOOGLE_NOT_CONFIGURED: 'Google Sign-In अभी सर्वर पर सेट नहीं है।',
    AUTH_GOOGLE_UNVERIFIED: 'Google साइन-इन जाँचा नहीं जा सका। दोबारा कोशिश करें।',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google साइन-इन पूरा नहीं हुआ। दोबारा कोशिश करें।',
    AUTH_EMAIL_REQUIRED: 'अपना ईमेल पता भरें।',
    AUTH_RESET_EMAIL_SENT: 'अगर यह ईमेल रजिस्टर्ड है, तो रीसेट लिंक भेज दिया गया है। अपना इनबॉक्स देखें।',
    AUTH_RESET_LINK_EXPIRED: 'यह रीसेट लिंक ख़त्म हो चुका है। नया लिंक माँगें।',
    AUTH_RESET_MISSING_FIELDS: 'अपना ईमेल और नया पासवर्ड भरें।',
    AUTH_PASSWORD_TOO_SHORT: 'पासवर्ड कम से कम 6 अक्षर का होना चाहिए।',
    AUTH_PASSWORD_CHANGED: 'पासवर्ड बदल गया। अब नए पासवर्ड से लॉगिन करें।',
    RATE_LIMIT_LOGIN: 'बहुत बार ग़लत लॉगिन। 15 मिनट बाद दोबारा कोशिश करें।',
    RATE_LIMIT_PHONE_LOGIN: 'इस नेटवर्क से बहुत बार लॉगिन की कोशिश हुई। एक घंटे बाद दोबारा कोशिश करें।',
    RATE_LIMIT_REGISTER: 'इस डिवाइस से बहुत बार साइन-अप की कोशिश हुई। थोड़ी देर बाद कोशिश करें।',
    RATE_LIMIT_PASSWORD_RESET: 'बहुत बार पासवर्ड रीसेट माँगा गया। एक घंटे बाद कोशिश करें।',
    RATE_LIMIT_GENERIC: 'बहुत तेज़ी से रिक्वेस्ट आ रही हैं। एक मिनट रुककर दोबारा कोशिश करें।',
    NETWORK: 'सर्वर से संपर्क नहीं हो पाया। अपना इंटरनेट देखकर दोबारा कोशिश करें।',
    SERVER_ERROR: 'कुछ गड़बड़ हो गई। दोबारा कोशिश करें।',
    GENERIC: 'कुछ गड़बड़ हो गई। दोबारा कोशिश करें।',
  },

  mr: {
    SUPPLIER_OWN_NUMBER: 'हा तुमच्याच दुकानाचा नंबर आहे. दुकान स्वतःचा सप्लायर होऊ शकत नाही — इतर दुकानांना माल विकायचा असेल तर Sell to Shops चालू करा आणि त्यांना तुमची इनव्हाइट लिंक पाठवा.',
    SUPPORT_MESSAGE_TOO_SHORT: 'आणखी एक-दोन ओळी लिहा, म्हणजे कुठे बघायचं ते कळेल.',
    SUPPORT_MESSAGE_TOO_LONG: 'एवढं मोठं एकावेळी जाणार नाही — बाकीचं उत्तरात लिहा.',
    SUPPORT_SEND_FAILED: 'आत्ता इथून पाठवता आलं नाही. व्हॉट्सॲपवरून आमच्यापर्यंत पोहोचेल.',
    RATE_LIMIT_SUPPORT: 'गेल्या तासाभरात या दुकानातून काही मेल गेल्या आहेत. व्हॉट्सॲप करा, तिथूनच पुढे बोलू.',
    SUPPORT_NOTE_EMPTY: 'काय झाले ते लिहा — दोन शब्दही चालतील, पण रिकामे नको.',
    SUPPORT_NO_REPLY_ADDRESS: 'या तिकिटावर ईमेल पत्ता नाही — "ईमेलनेही पाठवा" काढा; उत्तर दुकानाच्या ॲपमध्ये तरीही पोहोचेल.',
    SUPPORT_REPLY_EMPTY: 'कृपया तुमचे उत्तर लिहा.',
    SUPPORT_TICKET_NOT_FOUND: 'हा प्रश्न सापडला नाही.',
    SUPPORT_NOT_RESOLVED: 'हा प्रश्न आता पुष्टीची वाट पाहत नाही.',
    STOREFRONT_HALF_WINDOW: 'उघडण्याची आणि बंद होण्याची — दोन्ही वेळा भरा, किंवा दोन्ही रिकाम्या ठेवा.',
    SESSION_REVOKED: 'सर्व डिव्हाइसवरून लॉगआउट केले होते. पुन्हा लॉगिन करा.',
    AUTH_REAUTH_REQUIRED: 'बदलण्याआधी तुम्हीच आहात याची खात्री करा.',
    AUTH_REAUTH_FAILED: 'हा तुमचा सध्याचा पासवर्ड नाही.',
    AUTH_REAUTH_WRONG_ACCOUNT: 'हे वेगळे Google खाते आहे — काहीही बदलले नाही.',
    ACCOUNT_DELETE_NAME_MISMATCH: 'या खात्यावर दुकानाचे नाव हे नाही. जसे दिसते अगदी तसेच लिहा.',
    ACCOUNT_DELETION_SCHEDULED: 'हे खाते मिटवण्यासाठी लावले आहे.',
    ACCOUNT_DELETION_CANCELLED: 'डिलीट थांबवली. काहीही हटले नाही.',
    ACCOUNT_DELETION_NOT_SCHEDULED: 'मिटवण्यासाठी काहीच लावलेले नव्हते.',
    ACCOUNT_DELETION_REQUEST_RECEIVED: 'तुमची विनंती मिळाली. खात्रीसाठी आम्ही त्याच ईमेलवर लिहू.',
    INVALID_EMAIL: 'बरोबर ईमेल पत्ता टाका.',
    AUTH_GOOGLE_UNAVAILABLE: 'सर्व्हरवर Google लॉगिन अजून सेट केलेले नाही.',
    AUTH_NO_ACCOUNT: 'हे खाते सापडले नाही.',
    AUTH_PASSWORD_CHANGED: 'पासवर्ड बदलला.',
    AUTH_PASSWORD_SET: 'पासवर्ड लागला.',
    AUTH_SESSIONS_REVOKED: 'बाकी सर्व डिव्हाइसवरून लॉगआउट झाले.',
    PASSWORD_UNCHANGED: 'नवा पासवर्ड जुन्यासारखाच आहे.',
    PASSWORD_TOO_SHORT: 'खूप लहान आहे — किमान 8 अक्षरे ठेवा.',
    PASSWORD_TOO_LONG: 'खूप लांब आहे. 72 अक्षरांच्या आत ठेवा.',
    PASSWORD_HAS_EDGE_SPACES: 'सुरुवातीची किंवा शेवटची मोकळी जागा काढा — लॉगिन करताना ती दिसणार नाही.',
    PASSWORD_TOO_COMMON: 'हा त्या पासवर्डपैकी आहे जो कोणीही पहिल्यांदा वापरून पाहील.',
    PASSWORD_TOO_SIMPLE: 'हा फार सहज ओळखला जाईल. थोडा मिसळा.',
    PASSWORD_NEEDS_LETTER: 'फक्त आकडे सहज ओळखले जातात — किमान एक अक्षर घाला.',
    PASSWORD_LOOKS_LIKE_EMAIL: 'स्वतःचा ईमेल पत्ता पासवर्ड बनवू नका.',
    PASSWORD_LOOKS_LIKE_NAME: 'स्वतःचे नाव पासवर्ड बनवू नका.',
    RATE_LIMIT_PASSWORD_CHANGE: 'खूप वेळा प्रयत्न झाले. 15 मिनिटे थांबून पुन्हा करा.',
    STOREFRONT_AMOUNT: '₹0 ते ₹1,00,000 दरम्यान रक्कम टाका.',
    STOREFRONT_PREP_TIME: 'तयार होण्याची वेळ 0 मिनिटे ते 24 तास दरम्यान हवी.',
    STOREFRONT_TIME: '09:30 सारखी वेळ टाका.',
    SCAN_SCALE_NO_ITEM: 'स्टिकर व्यवस्थित वाचलं — पण या आयटम नंबरचं कोणतंही प्रॉडक्ट अजून नाही. त्या प्रॉडक्टच्या alternate codes मध्यе हा नंबर टाका',
    AI_FAILED: 'यावेळी बिल वाचता आले नाही. फोटो इथेच आहेत — पुन्हा प्रयत्न करा.',
    AI_RATE_LIMIT: 'सध्या खूप बिले वाचली जात आहेत. एका मिनिटाने प्रयत्न करा.',
    AI_BAD_JSON: 'वाचलेला डेटा बिघडलेला आला. पुन्हा प्रयत्न करा.',
    AI_REFUSED: 'ही इमेज वाचता आली नाही. बिलाचाच फोटो पाठवा.',
    AI_EMPTY: 'या बिलातून काहीच मिळाले नाही. फोटो स्पष्ट आहे का आणि छपाई पूर्ण फ्रेममध्ये आहे का बघा.',
    AI_TRUNCATED: 'हे बिल एका वेळी वाचण्यासाठी खूप मोठे आहे. पाने वेगवेगळी करून पाठवा.',
    AI_AUTH: 'या सर्व्हरवर बिल वाचणे चालू नाही. सपोर्टला कळवा.',
    AI_MODEL_UNKNOWN: 'या सर्व्हरवर बिल वाचण्याची सेटिंग चुकीची आहे. सपोर्टला कळवा.',
    AI_BAD_REQUEST: 'या सर्व्हरवर बिल वाचण्याची सेटिंग चुकीची आहे. सपोर्टला कळवा.',
    NO_IMAGE: 'कोणताही फोटो आला नाही. बिलाचा फोटो पुन्हा निवडा.',
    EMPTY_IMAGE: 'एक फोटो रिकामा होता. तो पुन्हा निवडा.',
    BAD_MEDIA_TYPE: 'फक्त JPG, PNG किंवा WEBP फोटो वाचता येतो.',
    IMAGE_TOO_LARGE: 'हा फोटो खूप मोठा आहे. एक-एक पान पाठवा.',
    PAYLOAD_TOO_LARGE: 'हे फोटो मिळून खूप मोठे आहेत. एक-एक पान पाठवा.',
    TOO_MANY_IMAGES: 'एका स्कॅनमध्ये एकच बिल वाचलं जातं. पुढचं बिल वेगळ्या फोटोत पाठवा.',
    IDEMPOTENCY_IN_PROGRESS: 'हे अजून सुरूच आहे. काही सेकंद द्या — काहीही गेलेलं नाही.',
    IDEMPOTENCY_MISMATCH: 'पाठवताना काहीतरी बदललं. पान रिफ्रेश करून पुन्हा प्रयत्न करा.',
    REQUEST_TIMEOUT: 'याला लागायला हवं त्यापेक्षा जास्त वेळ लागला. पुन्हा प्रयत्न करा.',
    TOO_MANY_IMAGES: 'एका वेळी खूप पाने आहेत. जास्तीत जास्त 3 पाठवा.',
    STOREFRONT_PAUSE_UNTIL: 'ही योग्य तारीख आणि वेळ नाही.',
    STOREFRONT_ALL_DAYS_OFF: 'प्रत्येक दिवस सुट्टी करता येणार नाही — त्याऐवजी ऑनलाइन ऑर्डर बंद करा.',
    STOREFRONT_NO_FULFILMENT: 'दुकानातून घेणे किंवा डिलिव्हरी — एक तरी चालू ठेवा, नाहीतर ग्राहक ऑर्डरच करू शकणार नाही.',
    STOREFRONT_FREE_WITHOUT_CHARGE: 'फुकट डिलिव्हरीची मर्यादा आहे पण डिलिव्हरी चार्ज नाही — म्हणजे चार्ज कधीच लागणार नाही.',
    STOREFRONT_FREE_BELOW_MIN: 'फुकट डिलिव्हरीची मर्यादा किमान ऑर्डरपेक्षा खाली आहे, म्हणजे प्रत्येक ऑर्डर तशीही फुकटच होईल.',
    PLAN_UPGRADE_REQUIRED: '{feature} {plan} मध्ये मिळते — ₹{price}/महिना. प्लॅन अपग्रेड करून सुरू करा.',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} सध्या कोणत्याही प्लॅनमध्ये नाही.',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} मध्ये मिळते. प्लॅन BillVyse वेबसाइटवर मॅनेज होतात.',
    PLAN_LIMIT_REACHED: 'या महिन्यात {limit} पैकी {used} झाले. {plan} मध्ये कोणतीही मर्यादा नाही — ₹{price}/महिना.',
    PLAN_LIMIT_REACHED_FINAL: 'या महिन्यात {limit} पैकी {used} झाले. 1 तारखेला पुन्हा सुरू होईल.',
    PLAN_COUNT_LIMIT_REACHED: 'तुमच्या प्लॅनमध्ये {limit} {feature} आहेत. {plan} मध्ये {newLimit} — ₹{price}/महिना.',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'तुमच्या प्लॅनमध्ये {limit} {feature} आहेत, आणि कोणत्याही प्लॅनमध्ये यापेक्षा जास्त नाहीत.',
    PLAN_COUNT_LIMIT_UNLIMITED: 'तुमच्या प्लॅनमध्ये {limit} {feature} आहेत. {plan} मध्ये कोणतीही मर्यादा नाही — ₹{price}/महिना.',
    USAGE_LIMIT_REACHED: 'या महिन्याचे {feature} संपले ({limit} वापरले). 1 तारखेला रीसेट होतील, किंवा {plan} मध्ये दरमहा {newLimit} मिळतात — ₹{price}/महिना.',
    USAGE_LIMIT_REACHED_FINAL: 'या महिन्याचे {feature} संपले ({limit} वापरले). 1 तारखेला रीसेट होतील.',
    EXPENSE_FROM_PAYROLL: 'हा खर्च कर्मचाऱ्यांना पगार देताना तयार झाला होता. तो स्टाफ स्क्रीनवरून बदला किंवा काढा — तरच पगाराची शीट आणि तुमची वही एकच सांगतील.',
    STAFF_HAS_HISTORY: 'या खात्यावर काम नोंदलेले आहे. त्याऐवजी ऑफबोर्ड करा — त्याने प्रवेश बंद होतो आणि रेकॉर्ड टिकतो.',
    AUTH_EMAIL_NOT_VERIFIED: 'आधी तुमचा ईमेल कन्फर्म करा.',
    AUTH_EMAIL_INVALID: 'हा ईमेल पत्ता बरोबर वाटत नाही.',
    AUTH_OTP_INVALID: 'कोड चुकीचा आहे किंवा संपला आहे. नवीन कोड मागा.',
    AUTH_OTP_LOCKED: 'खूप वेळा चुकीचा कोड टाकला. नवीन कोड मागा.',
    AUTH_OTP_MISSING: 'ईमेलवर आलेला कोड टाका.',
    EMAIL_NOT_CONFIGURED: 'नवीन नोंदणी सध्या बंद आहे. थोड्या वेळाने प्रयत्न करा.',
    RATE_LIMIT_EMAIL_OTP: 'खूप वेळा कोड मागितला. 15 मिनिटे थांबा.',
    CSRF_FAILED: 'हे पान जुनं झालं आहे. पान रिफ्रेश करून पुन्हा प्रयत्न करा.',
    NOT_AUTHENTICATED: 'तुम्ही लॉगिन केलेलं नाही. कृपया पुन्हा लॉगिन करा.',
    SESSION_EXPIRED: 'तुमचं सेशन संपलं आहे. कृपया पुन्हा लॉगिन करा.',
    ACCOUNT_INACTIVE: 'हे खातं आता चालू नाही. दुकान मालकाशी बोला.',
    AUTH_ACCOUNT_SUSPENDED: 'हे खातं बंद करण्यात आलं आहे',
    AUTH_INVALID_CREDENTIALS: 'ईमेल किंवा पासवर्ड चुकीचा आहे.',
    AUTH_MISSING_CREDENTIALS: 'ईमेल आणि पासवर्ड दोन्ही भरा.',
    AUTH_PHONE_MISSING: 'तुमचा मोबाइल नंबर टाका.',
    AUTH_PHONE_INVALID: 'बरोबर 10 अंकी मोबाइल नंबर टाका.',
    AUTH_PHONE_NOT_FOUND: 'या मोबाइल नंबरने अजून कोणतेही दुकान नोंदणीकृत नाही. ईमेलने लॉगिन करा, किंवा आधी Settings मध्ये हा नंबर जोडा.',
    AUTH_PHONE_OTP_MISSING: 'तुमचा मोबाइल नंबर आणि कोड टाका.',
    AUTH_OTP_SEND_FAILED: 'आत्ता कोड पाठवता आला नाही. थोड्या वेळाने पुन्हा प्रयत्न करा.',
    SHOP_PHONE_ALREADY_LINKED: 'हा मोबाइल नंबर आधीच दुसऱ्या दुकानाशी जोडलेला आहे. कृपया वेगळा नंबर वापरा.',
    AUTH_MISSING_SIGNUP_FIELDS: 'नाव, ईमेल, पासवर्ड आणि दुकानाचं नाव — सर्व आवश्यक आहे.',
    AUTH_TERMS_NOT_ACCEPTED: 'दुकान तयार करण्यासाठी Terms of Service आणि Privacy Policy स्वीकारा.',
    GSTIN_DECLARATION_REQUIRED: 'सेव्ह करण्याआधी हा GSTIN तुमच्या व्यवसायाचा आहे याची खात्री करा.',
    GSTIN_ALREADY_CLAIMED: 'हा GSTIN आधीच दुसऱ्या खात्यावर नोंदलेला आहे. तो तुमचाच असेल तर billvyse.india@gmail.com वर लिहा.',
    AUTH_EMAIL_EXISTS: 'हा ईमेल आधीच नोंदणीकृत आहे. थेट लॉगिन करा.',
    USE_GOOGLE_SIGNIN: 'हे खातं Google नं तयार झालं आहे. "Sign in with Google" दाबा.',
    REGISTRATION_CLOSED: 'नवीन दुकानाची नोंदणी सध्या बंद आहे. थोड्या वेळाने प्रयत्न करा.',
    AUTH_GOOGLE_NOT_CONFIGURED: 'Google Sign-In अजून सर्व्हरवर सेट केलेलं नाही.',
    AUTH_GOOGLE_UNVERIFIED: 'Google साइन-इन तपासता आलं नाही. पुन्हा प्रयत्न करा.',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google साइन-इन पूर्ण झालं नाही. पुन्हा प्रयत्न करा.',
    AUTH_EMAIL_REQUIRED: 'तुमचा ईमेल पत्ता भरा.',
    AUTH_RESET_EMAIL_SENT: 'हा ईमेल नोंदणीकृत असेल, तर रीसेट लिंक पाठवली आहे. तुमचा इनबॉक्स पाहा.',
    AUTH_RESET_LINK_EXPIRED: 'ही रीसेट लिंक संपली आहे. नवीन लिंक मागा.',
    AUTH_RESET_MISSING_FIELDS: 'तुमचा ईमेल आणि नवीन पासवर्ड भरा.',
    AUTH_PASSWORD_TOO_SHORT: 'पासवर्ड किमान 6 अक्षरांचा हवा.',
    AUTH_PASSWORD_CHANGED: 'पासवर्ड बदलला. आता नव्या पासवर्डनं लॉगिन करा.',
    RATE_LIMIT_LOGIN: 'खूप वेळा चुकीचं लॉगिन. 15 मिनिटांनी पुन्हा प्रयत्न करा.',
    RATE_LIMIT_PHONE_LOGIN: 'या नेटवर्कवरून खूप वेळा लॉगिनचा प्रयत्न झाला. एका तासाने पुन्हा प्रयत्न करा.',
    RATE_LIMIT_REGISTER: 'या डिव्हाइसवरून खूप वेळा साइन-अप करण्याचा प्रयत्न झाला. थोड्या वेळाने प्रयत्न करा.',
    RATE_LIMIT_PASSWORD_RESET: 'खूप वेळा पासवर्ड रीसेट मागितला. एका तासाने प्रयत्न करा.',
    RATE_LIMIT_GENERIC: 'खूप वेगानं विनंत्या येत आहेत. एक मिनिट थांबून पुन्हा प्रयत्न करा.',
    NETWORK: 'सर्व्हरशी संपर्क होऊ शकला नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.',
    SERVER_ERROR: 'काहीतरी चुकलं. पुन्हा प्रयत्न करा.',
    GENERIC: 'काहीतरी चुकलं. पुन्हा प्रयत्न करा.',
  },

  bn: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan}-এ পাওয়া যায় — ₹{price}/মাস। প্ল্যান আপগ্রেড করে চালু করুন।',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} এখন কোনো প্ল্যানেই নেই।',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan}-এ আছে। প্ল্যান BillVyse ওয়েবসাইটে ম্যানেজ করা হয়।',
    PLAN_LIMIT_REACHED: 'এই মাসে {limit}-এর মধ্যে {used} হয়ে গেছে। {plan}-এ কোনো সীমা নেই — ₹{price}/মাস।',
    PLAN_LIMIT_REACHED_FINAL: 'এই মাসে {limit}-এর মধ্যে {used} হয়ে গেছে। ১ তারিখে আবার শুরু হবে।',
    PLAN_COUNT_LIMIT_REACHED: 'আপনার প্ল্যানে {limit} {feature} আছে। {plan}-এ {newLimit} — ₹{price}/মাস।',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'আপনার প্ল্যানে {limit} {feature} আছে, কোনো প্ল্যানেই এর বেশি নেই।',
    PLAN_COUNT_LIMIT_UNLIMITED: 'আপনার প্ল্যানে {limit} {feature} আছে। {plan}-এ কোনো সীমা নেই — ₹{price}/মাস।',
    USAGE_LIMIT_REACHED: 'এই মাসের {feature} শেষ ({limit} ব্যবহার হয়েছে)। ১ তারিখে রিসেট হবে, বা {plan}-এ প্রতি মাসে {newLimit} পাবেন — ₹{price}/মাস।',
    USAGE_LIMIT_REACHED_FINAL: 'এই মাসের {feature} শেষ ({limit} ব্যবহার হয়েছে)। ১ তারিখে রিসেট হবে।',
    AUTH_EMAIL_NOT_VERIFIED: 'আগে আপনার ইমেল নিশ্চিত করুন।',
    AUTH_EMAIL_INVALID: 'এই ইমেল ঠিকানাটি ঠিক মনে হচ্ছে না।',
    AUTH_OTP_INVALID: 'কোডটি ভুল বা মেয়াদ শেষ। নতুন কোড চান।',
    AUTH_OTP_LOCKED: 'অনেকবার ভুল কোড। নতুন কোড চান।',
    AUTH_OTP_MISSING: 'ইমেলে আসা কোডটি দিন।',
    EMAIL_NOT_CONFIGURED: 'নতুন নিবন্ধন এখন বন্ধ। কিছুক্ষণ পরে চেষ্টা করুন।',
    RATE_LIMIT_EMAIL_OTP: 'অনেকবার কোড চাওয়া হয়েছে। ১৫ মিনিট অপেক্ষা করুন।',
    CSRF_FAILED: 'এই পেজটি পুরনো হয়ে গেছে। পেজ রিফ্রেশ করে আবার চেষ্টা করুন।',
    NOT_AUTHENTICATED: 'আপনি লগইন করা নেই। অনুগ্রহ করে আবার লগইন করুন।',
    SESSION_EXPIRED: 'আপনার সেশন শেষ হয়ে গেছে। অনুগ্রহ করে আবার লগইন করুন।',
    ACCOUNT_INACTIVE: 'এই অ্যাকাউন্টটি আর চালু নেই। দোকান মালিকের সঙ্গে কথা বলুন।',
    AUTH_ACCOUNT_SUSPENDED: 'এই অ্যাকাউন্টটি বন্ধ করে দেওয়া হয়েছে',
    AUTH_INVALID_CREDENTIALS: 'ইমেল বা পাসওয়ার্ড ভুল।',
    AUTH_MISSING_CREDENTIALS: 'ইমেল ও পাসওয়ার্ড দুটোই দিন।',
    AUTH_PHONE_MISSING: 'আপনার মোবাইল নম্বর দিন।',
    AUTH_PHONE_INVALID: 'সঠিক ১০ সংখ্যার মোবাইল নম্বর দিন।',
    AUTH_PHONE_NOT_FOUND: 'এই মোবাইল নম্বরে এখনও কোনো দোকান নিবন্ধিত নেই। ইমেল দিয়ে লগইন করুন, অথবা আগে Settings-এ এই নম্বরটি যোগ করুন।',
    AUTH_PHONE_OTP_MISSING: 'আপনার মোবাইল নম্বর ও কোড দিন।',
    AUTH_OTP_SEND_FAILED: 'এখন কোড পাঠানো গেল না। একটু পরে আবার চেষ্টা করুন।',
    SHOP_PHONE_ALREADY_LINKED: 'এই মোবাইল নম্বরটি ইতিমধ্যে অন্য একটি দোকানের সাথে যুক্ত। অনুগ্রহ করে অন্য নম্বর ব্যবহার করুন।',
    AUTH_MISSING_SIGNUP_FIELDS: 'নাম, ইমেল, পাসওয়ার্ড এবং দোকানের নাম — সবই দরকার।',
    AUTH_EMAIL_EXISTS: 'এই ইমেল আগেই নিবন্ধিত। সরাসরি লগইন করুন।',
    USE_GOOGLE_SIGNIN: 'এই অ্যাকাউন্টটি Google দিয়ে তৈরি। "Sign in with Google" চাপুন।',
    REGISTRATION_CLOSED: 'নতুন দোকানের নিবন্ধন এখন বন্ধ। কিছুক্ষণ পরে চেষ্টা করুন।',
    AUTH_GOOGLE_NOT_CONFIGURED: 'সার্ভারে Google Sign-In এখনও সেট করা হয়নি।',
    AUTH_GOOGLE_UNVERIFIED: 'Google সাইন-ইন যাচাই করা গেল না। আবার চেষ্টা করুন।',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google সাইন-ইন সম্পূর্ণ হয়নি। আবার চেষ্টা করুন।',
    AUTH_EMAIL_REQUIRED: 'আপনার ইমেল ঠিকানা দিন।',
    AUTH_RESET_EMAIL_SENT: 'এই ইমেল নিবন্ধিত থাকলে রিসেট লিঙ্ক পাঠানো হয়েছে। আপনার ইনবক্স দেখুন।',
    AUTH_RESET_LINK_EXPIRED: 'এই রিসেট লিঙ্কের মেয়াদ শেষ। নতুন লিঙ্ক চান।',
    AUTH_RESET_MISSING_FIELDS: 'আপনার ইমেল ও নতুন পাসওয়ার্ড দিন।',
    AUTH_PASSWORD_TOO_SHORT: 'পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে।',
    AUTH_PASSWORD_CHANGED: 'পাসওয়ার্ড বদলে গেছে। এখন নতুন পাসওয়ার্ড দিয়ে লগইন করুন।',
    RATE_LIMIT_LOGIN: 'অনেকবার ভুল লগইন। ১৫ মিনিট পরে আবার চেষ্টা করুন।',
    RATE_LIMIT_PHONE_LOGIN: 'এই নেটওয়ার্ক থেকে অনেকবার লগইনের চেষ্টা হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।',
    RATE_LIMIT_REGISTER: 'এই ডিভাইস থেকে অনেকবার সাইন-আপের চেষ্টা হয়েছে। কিছুক্ষণ পরে চেষ্টা করুন।',
    RATE_LIMIT_PASSWORD_RESET: 'অনেকবার পাসওয়ার্ড রিসেট চাওয়া হয়েছে। এক ঘণ্টা পরে চেষ্টা করুন।',
    RATE_LIMIT_GENERIC: 'খুব দ্রুত অনুরোধ আসছে। এক মিনিট অপেক্ষা করে আবার চেষ্টা করুন।',
    NETWORK: 'সার্ভারে পৌঁছনো গেল না। ইন্টারনেট দেখে আবার চেষ্টা করুন।',
    SERVER_ERROR: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
    GENERIC: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
  },

  ta: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan} திட்டத்தில் கிடைக்கும் — ₹{price}/மாதம். திட்டத்தை மேம்படுத்தி இயக்கவும்.',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} தற்போது எந்தத் திட்டத்திலும் இல்லை.',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} இல் உள்ளது. திட்டங்கள் BillVyse இணையதளத்தில் நிர்வகிக்கப்படுகின்றன.',
    PLAN_LIMIT_REACHED: 'இந்த மாதம் {limit}-இல் {used} முடிந்தது. {plan}-இல் வரம்பே இல்லை — ₹{price}/மாதம்.',
    PLAN_LIMIT_REACHED_FINAL: 'இந்த மாதம் {limit}-இல் {used} முடிந்தது. 1-ஆம் தேதி மீண்டும் தொடங்கும்.',
    PLAN_COUNT_LIMIT_REACHED: 'உங்கள் திட்டத்தில் {limit} {feature}. {plan}-இல் {newLimit} — ₹{price}/மாதம்.',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'உங்கள் திட்டத்தில் {limit} {feature} — எந்தத் திட்டத்திலும் இதற்கு மேல் இல்லை.',
    PLAN_COUNT_LIMIT_UNLIMITED: 'உங்கள் திட்டத்தில் {limit} {feature}. {plan}-இல் வரம்பே இல்லை — ₹{price}/மாதம்.',
    USAGE_LIMIT_REACHED: 'இந்த மாதத்தின் {feature} முடிந்துவிட்டன ({limit} பயன்படுத்தப்பட்டது). 1-ஆம் தேதி மீட்டமைக்கும், அல்லது {plan}-இல் மாதம் {newLimit} கிடைக்கும் — ₹{price}/மாதம்.',
    USAGE_LIMIT_REACHED_FINAL: 'இந்த மாதத்தின் {feature} முடிந்துவிட்டன ({limit} பயன்படுத்தப்பட்டது). 1-ஆம் தேதி மீட்டமைக்கும்.',
    AUTH_EMAIL_NOT_VERIFIED: 'முதலில் உங்கள் மின்னஞ்சலை உறுதிப்படுத்தவும்.',
    AUTH_EMAIL_INVALID: 'இந்த மின்னஞ்சல் முகவரி சரியாகத் தெரியவில்லை.',
    AUTH_OTP_INVALID: 'குறியீடு தவறு அல்லது காலாவதியானது. புதியது கேட்கவும்.',
    AUTH_OTP_LOCKED: 'பலமுறை தவறான குறியீடு. புதியது கேட்கவும்.',
    AUTH_OTP_MISSING: 'மின்னஞ்சலில் வந்த குறியீட்டை உள்ளிடவும்.',
    EMAIL_NOT_CONFIGURED: 'புதிய பதிவு தற்போது நிறுத்தப்பட்டுள்ளது. பிறகு முயற்சிக்கவும்.',
    RATE_LIMIT_EMAIL_OTP: 'பலமுறை குறியீடு கேட்கப்பட்டது. 15 நிமிடம் காத்திருக்கவும்.',
    CSRF_FAILED: 'இந்தப் பக்கம் பழையதாகிவிட்டது. பக்கத்தைப் புதுப்பித்து மீண்டும் முயற்சிக்கவும்.',
    NOT_AUTHENTICATED: 'நீங்கள் உள்நுழையவில்லை. மீண்டும் உள்நுழையவும்.',
    SESSION_EXPIRED: 'உங்கள் அமர்வு முடிந்துவிட்டது. மீண்டும் உள்நுழையவும்.',
    ACCOUNT_INACTIVE: 'இந்தக் கணக்கு இனி செயலில் இல்லை. கடை உரிமையாளரிடம் பேசவும்.',
    AUTH_ACCOUNT_SUSPENDED: 'இந்தக் கணக்கு நிறுத்தப்பட்டுள்ளது',
    AUTH_INVALID_CREDENTIALS: 'மின்னஞ்சல் அல்லது கடவுச்சொல் தவறு.',
    AUTH_MISSING_CREDENTIALS: 'மின்னஞ்சல் மற்றும் கடவுச்சொல் இரண்டையும் நிரப்பவும்.',
    AUTH_PHONE_MISSING: 'உங்கள் மொபைல் எண்ணை உள்ளிடவும்.',
    AUTH_PHONE_INVALID: 'சரியான 10 இலக்க மொபைல் எண்ணை உள்ளிடவும்.',
    AUTH_PHONE_NOT_FOUND: 'இந்த மொபைல் எண்ணுடன் இதுவரை எந்தக் கடையும் பதிவு செய்யப்படவில்லை. மின்னஞ்சல் மூலம் உள்நுழையவும், அல்லது முதலில் Settings-இல் இந்த எண்ணைச் சேர்க்கவும்.',
    AUTH_PHONE_OTP_MISSING: 'உங்கள் மொபைல் எண் மற்றும் குறியீட்டை உள்ளிடவும்.',
    AUTH_OTP_SEND_FAILED: 'இப்போது குறியீட்டை அனுப்ப முடியவில்லை. சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
    SHOP_PHONE_ALREADY_LINKED: 'இந்த மொபைல் எண் ஏற்கனவே வேறொரு கடையுடன் இணைக்கப்பட்டுள்ளது. வேறு எண்ணைப் பயன்படுத்தவும்.',
    AUTH_MISSING_SIGNUP_FIELDS: 'பெயர், மின்னஞ்சல், கடவுச்சொல், கடையின் பெயர் — அனைத்தும் தேவை.',
    AUTH_EMAIL_EXISTS: 'இந்த மின்னஞ்சல் ஏற்கனவே பதிவாகியுள்ளது. நேரடியாக உள்நுழையவும்.',
    USE_GOOGLE_SIGNIN: 'இந்தக் கணக்கு Google மூலம் உருவாக்கப்பட்டது. "Sign in with Google" அழுத்தவும்.',
    REGISTRATION_CLOSED: 'புதிய கடைப் பதிவு தற்போது நிறுத்தப்பட்டுள்ளது. சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
    AUTH_GOOGLE_NOT_CONFIGURED: 'சர்வரில் Google Sign-In இன்னும் அமைக்கப்படவில்லை.',
    AUTH_GOOGLE_UNVERIFIED: 'Google உள்நுழைவைச் சரிபார்க்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google உள்நுழைவு முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    AUTH_EMAIL_REQUIRED: 'உங்கள் மின்னஞ்சல் முகவரியை நிரப்பவும்.',
    AUTH_RESET_EMAIL_SENT: 'இந்த மின்னஞ்சல் பதிவாகியிருந்தால், மீட்டமைப்பு இணைப்பு அனுப்பப்பட்டுள்ளது. உங்கள் இன்பாக்ஸைப் பார்க்கவும்.',
    AUTH_RESET_LINK_EXPIRED: 'இந்த மீட்டமைப்பு இணைப்பு காலாவதியாகிவிட்டது. புதிய இணைப்பைக் கேட்கவும்.',
    AUTH_RESET_MISSING_FIELDS: 'உங்கள் மின்னஞ்சலையும் புதிய கடவுச்சொல்லையும் நிரப்பவும்.',
    AUTH_PASSWORD_TOO_SHORT: 'கடவுச்சொல் குறைந்தது 6 எழுத்துகள் இருக்க வேண்டும்.',
    AUTH_PASSWORD_CHANGED: 'கடவுச்சொல் மாற்றப்பட்டது. இப்போது புதிய கடவுச்சொல்லில் உள்நுழையவும்.',
    RATE_LIMIT_LOGIN: 'பலமுறை தவறான உள்நுழைவு. 15 நிமிடம் கழித்து மீண்டும் முயற்சிக்கவும்.',
    RATE_LIMIT_PHONE_LOGIN: 'இந்த நெட்வொர்க்கிலிருந்து பல முறை உள்நுழைவு முயற்சி. ஒரு மணி நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.',
    RATE_LIMIT_REGISTER: 'இந்தச் சாதனத்திலிருந்து பலமுறை பதிவு முயற்சி நடந்துள்ளது. சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
    RATE_LIMIT_PASSWORD_RESET: 'பலமுறை கடவுச்சொல் மீட்டமைப்பு கோரப்பட்டுள்ளது. ஒரு மணி நேரம் கழித்து முயற்சிக்கவும்.',
    RATE_LIMIT_GENERIC: 'மிக விரைவாக கோரிக்கைகள் வருகின்றன. ஒரு நிமிடம் காத்திருந்து முயற்சிக்கவும்.',
    NETWORK: 'சர்வரைத் தொடர்பு கொள்ள முடியவில்லை. இணையத்தைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
    SERVER_ERROR: 'ஏதோ தவறாகிவிட்டது. மீண்டும் முயற்சிக்கவும்.',
    GENERIC: 'ஏதோ தவறாகிவிட்டது. மீண்டும் முயற்சிக்கவும்.',
  },

  te: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan}లో లభిస్తుంది — ₹{price}/నెల. ప్లాన్ అప్‌గ్రేడ్ చేసి ప్రారంభించండి.',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} ప్రస్తుతం ఏ ప్లాన్‌లోనూ లేదు.',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} లో ఉంది. ప్లాన్‌లు BillVyse వెబ్‌సైట్‌లో నిర్వహించబడతాయి.',
    PLAN_LIMIT_REACHED: 'ఈ నెలలో {limit}లో {used} అయ్యాయి. {plan}లో ఎలాంటి పరిమితి లేదు — ₹{price}/నెల.',
    PLAN_LIMIT_REACHED_FINAL: 'ఈ నెలలో {limit}లో {used} అయ్యాయి. 1వ తేదీన మళ్లీ మొదలవుతుంది.',
    PLAN_COUNT_LIMIT_REACHED: 'మీ ప్లాన్‌లో {limit} {feature} ఉన్నాయి. {plan}లో {newLimit} — ₹{price}/నెల.',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'మీ ప్లాన్‌లో {limit} {feature} ఉన్నాయి, ఏ ప్లాన్‌లోనూ దీనికంటే ఎక్కువ లేవు.',
    PLAN_COUNT_LIMIT_UNLIMITED: 'మీ ప్లాన్‌లో {limit} {feature} ఉన్నాయి. {plan}లో ఎలాంటి పరిమితి లేదు — ₹{price}/నెల.',
    USAGE_LIMIT_REACHED: 'ఈ నెల {feature} అయిపోయాయి ({limit} వాడారు). 1వ తేదీన రీసెట్ అవుతాయి, లేదా {plan}లో నెలకు {newLimit} వస్తాయి — ₹{price}/నెల.',
    USAGE_LIMIT_REACHED_FINAL: 'ఈ నెల {feature} అయిపోయాయి ({limit} వాడారు). 1వ తేదీన రీసెట్ అవుతాయి.',
    AUTH_EMAIL_NOT_VERIFIED: 'ముందు మీ ఇమెయిల్ నిర్ధారించండి.',
    AUTH_EMAIL_INVALID: 'ఈ ఇమెయిల్ చిరునామా సరిగా కనిపించడం లేదు.',
    AUTH_OTP_INVALID: 'కోడ్ తప్పు లేదా గడువు ముగిసింది. కొత్తది అడగండి.',
    AUTH_OTP_LOCKED: 'చాలాసార్లు తప్పు కోడ్. కొత్తది అడగండి.',
    AUTH_OTP_MISSING: 'ఇమెయిల్‌లో వచ్చిన కోడ్ నమోదు చేయండి.',
    EMAIL_NOT_CONFIGURED: 'కొత్త నమోదు ప్రస్తుతం మూసివేయబడింది. తర్వాత ప్రయత్నించండి.',
    RATE_LIMIT_EMAIL_OTP: 'చాలాసార్లు కోడ్ అడిగారు. 15 నిమిషాలు ఆగండి.',
    CSRF_FAILED: 'ఈ పేజీ పాతదైపోయింది. పేజీని రిఫ్రెష్ చేసి మళ్లీ ప్రయత్నించండి.',
    NOT_AUTHENTICATED: 'మీరు లాగిన్ కాలేదు. దయచేసి మళ్లీ లాగిన్ చేయండి.',
    SESSION_EXPIRED: 'మీ సెషన్ ముగిసింది. దయచేసి మళ్లీ లాగిన్ చేయండి.',
    ACCOUNT_INACTIVE: 'ఈ ఖాతా ఇప్పుడు యాక్టివ్‌గా లేదు. దుకాణ యజమానితో మాట్లాడండి.',
    AUTH_ACCOUNT_SUSPENDED: 'ఈ ఖాతా నిలిపివేయబడింది',
    AUTH_INVALID_CREDENTIALS: 'ఇమెయిల్ లేదా పాస్‌వర్డ్ తప్పు.',
    AUTH_MISSING_CREDENTIALS: 'ఇమెయిల్ మరియు పాస్‌వర్డ్ రెండూ నింపండి.',
    AUTH_PHONE_MISSING: 'మీ మొబైల్ నంబర్ నమోదు చేయండి.',
    AUTH_PHONE_INVALID: 'సరైన 10 అంకెల మొబైల్ నంబర్ నమోదు చేయండి.',
    AUTH_PHONE_NOT_FOUND: 'ఈ మొబైల్ నంబర్‌తో ఇంకా ఏ దుకాణమూ నమోదు కాలేదు. ఇమెయిల్‌తో లాగిన్ చేయండి, లేదా ముందుగా Settings‌లో ఈ నంబర్‌ను జోడించండి.',
    AUTH_PHONE_OTP_MISSING: 'మీ మొబైల్ నంబర్ మరియు కోడ్ నమోదు చేయండి.',
    AUTH_OTP_SEND_FAILED: 'ఇప్పుడు కోడ్ పంపలేకపోయాము. కొద్దిసేపటి తర్వాత మళ్ళీ ప్రయత్నించండి.',
    SHOP_PHONE_ALREADY_LINKED: 'ఈ మొబైల్ నంబర్ ఇప్పటికే మరో దుకాణంతో లింక్ చేయబడింది. దయచేసి వేరే నంబర్ వాడండి.',
    AUTH_MISSING_SIGNUP_FIELDS: 'పేరు, ఇమెయిల్, పాస్‌వర్డ్, దుకాణం పేరు — అన్నీ అవసరం.',
    AUTH_EMAIL_EXISTS: 'ఈ ఇమెయిల్ ఇప్పటికే నమోదైంది. నేరుగా లాగిన్ చేయండి.',
    USE_GOOGLE_SIGNIN: 'ఈ ఖాతా Google తో సృష్టించబడింది. "Sign in with Google" నొక్కండి.',
    REGISTRATION_CLOSED: 'కొత్త దుకాణం నమోదు ప్రస్తుతం మూసివేయబడింది. కొద్దిసేపటి తర్వాత ప్రయత్నించండి.',
    AUTH_GOOGLE_NOT_CONFIGURED: 'సర్వర్‌లో Google Sign-In ఇంకా సెట్ చేయలేదు.',
    AUTH_GOOGLE_UNVERIFIED: 'Google సైన్-ఇన్‌ను ధృవీకరించలేకపోయాం. మళ్లీ ప్రయత్నించండి.',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google సైన్-ఇన్ పూర్తి కాలేదు. మళ్లీ ప్రయత్నించండి.',
    AUTH_EMAIL_REQUIRED: 'మీ ఇమెయిల్ చిరునామా నింపండి.',
    AUTH_RESET_EMAIL_SENT: 'ఈ ఇమెయిల్ నమోదై ఉంటే, రీసెట్ లింక్ పంపాం. మీ ఇన్‌బాక్స్ చూడండి.',
    AUTH_RESET_LINK_EXPIRED: 'ఈ రీసెట్ లింక్ గడువు ముగిసింది. కొత్త లింక్ అడగండి.',
    AUTH_RESET_MISSING_FIELDS: 'మీ ఇమెయిల్ మరియు కొత్త పాస్‌వర్డ్ నింపండి.',
    AUTH_PASSWORD_TOO_SHORT: 'పాస్‌వర్డ్ కనీసం 6 అక్షరాలు ఉండాలి.',
    AUTH_PASSWORD_CHANGED: 'పాస్‌వర్డ్ మారింది. ఇప్పుడు కొత్త పాస్‌వర్డ్‌తో లాగిన్ చేయండి.',
    RATE_LIMIT_LOGIN: 'చాలాసార్లు తప్పు లాగిన్. 15 నిమిషాల తర్వాత మళ్లీ ప్రయత్నించండి.',
    RATE_LIMIT_PHONE_LOGIN: 'ఈ నెట్‌వర్క్ నుండి చాలాసార్లు లాగిన్ ప్రయత్నాలు జరిగాయి. ఒక గంట తర్వాత మళ్లీ ప్రయత్నించండి.',
    RATE_LIMIT_REGISTER: 'ఈ పరికరం నుండి చాలాసార్లు సైన్-అప్ ప్రయత్నం జరిగింది. కొద్దిసేపటి తర్వాత ప్రయత్నించండి.',
    RATE_LIMIT_PASSWORD_RESET: 'చాలాసార్లు పాస్‌వర్డ్ రీసెట్ అడిగారు. ఒక గంట తర్వాత ప్రయత్నించండి.',
    RATE_LIMIT_GENERIC: 'చాలా వేగంగా అభ్యర్థనలు వస్తున్నాయి. ఒక నిమిషం ఆగి మళ్లీ ప్రయత్నించండి.',
    NETWORK: 'సర్వర్‌ను చేరుకోలేకపోయాం. మీ ఇంటర్నెట్ చూసి మళ్లీ ప్రయత్నించండి.',
    SERVER_ERROR: 'ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి.',
    GENERIC: 'ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి.',
  },

  gu: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan}માં મળે છે — ₹{price}/મહિનો. પ્લાન અપગ્રેડ કરીને ચાલુ કરો.',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} અત્યારે કોઈ પણ પ્લાનમાં નથી.',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} માં મળે છે. પ્લાન BillVyse વેબસાઇટ પર મેનેજ થાય છે.',
    PLAN_LIMIT_REACHED: 'આ મહિને {limit}માંથી {used} થઈ ગયા. {plan}માં કોઈ મર્યાદા નથી — ₹{price}/મહિનો.',
    PLAN_LIMIT_REACHED_FINAL: 'આ મહિને {limit}માંથી {used} થઈ ગયા. 1 તારીખે ફરી શરૂ થશે.',
    PLAN_COUNT_LIMIT_REACHED: 'તમારા પ્લાનમાં {limit} {feature} છે. {plan}માં {newLimit} — ₹{price}/મહિનો.',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'તમારા પ્લાનમાં {limit} {feature} છે, અને કોઈ પ્લાનમાં આનાથી વધારે નથી.',
    PLAN_COUNT_LIMIT_UNLIMITED: 'તમારા પ્લાનમાં {limit} {feature} છે. {plan}માં કોઈ મર્યાદા નથી — ₹{price}/મહિનો.',
    USAGE_LIMIT_REACHED: 'આ મહિનાના {feature} પૂરા થયા ({limit} વપરાયા). 1 તારીખે રીસેટ થશે, અથવા {plan}માં દર મહિને {newLimit} મળે છે — ₹{price}/મહિનો.',
    USAGE_LIMIT_REACHED_FINAL: 'આ મહિનાના {feature} પૂરા થયા ({limit} વપરાયા). 1 તારીખે રીસેટ થશે.',
    AUTH_EMAIL_NOT_VERIFIED: 'પહેલા તમારું ઈમેલ કન્ફર્મ કરો.',
    AUTH_EMAIL_INVALID: 'આ ઈમેલ સરનામું બરાબર લાગતું નથી.',
    AUTH_OTP_INVALID: 'કોડ ખોટો છે કે પૂરો થઈ ગયો છે. નવો કોડ માંગો.',
    AUTH_OTP_LOCKED: 'ઘણી વાર ખોટો કોડ. નવો કોડ માંગો.',
    AUTH_OTP_MISSING: 'ઈમેલમાં આવેલો કોડ ભરો.',
    EMAIL_NOT_CONFIGURED: 'નવી નોંધણી અત્યારે બંધ છે. થોડી વાર પછી પ્રયાસ કરો.',
    RATE_LIMIT_EMAIL_OTP: 'ઘણી વાર કોડ માંગ્યો. 15 મિનિટ રોકાઓ.',
    CSRF_FAILED: 'આ પેજ જૂનું થઈ ગયું છે. પેજ રિફ્રેશ કરીને ફરી પ્રયાસ કરો.',
    NOT_AUTHENTICATED: 'તમે લોગિન નથી. કૃપા કરીને ફરી લોગિન કરો.',
    SESSION_EXPIRED: 'તમારું સેશન પૂરું થઈ ગયું. કૃપા કરીને ફરી લોગિન કરો.',
    ACCOUNT_INACTIVE: 'આ ખાતું હવે ચાલુ નથી. દુકાન માલિક સાથે વાત કરો.',
    AUTH_ACCOUNT_SUSPENDED: 'આ ખાતું બંધ કરવામાં આવ્યું છે',
    AUTH_INVALID_CREDENTIALS: 'ઈમેલ કે પાસવર્ડ ખોટો છે.',
    AUTH_MISSING_CREDENTIALS: 'ઈમેલ અને પાસવર્ડ બંને ભરો.',
    AUTH_PHONE_MISSING: 'તમારો મોબાઇલ નંબર દાખલ કરો.',
    AUTH_PHONE_INVALID: 'સાચો 10 અંકનો મોબાઇલ નંબર દાખલ કરો.',
    AUTH_PHONE_NOT_FOUND: 'આ મોબાઇલ નંબર સાથે હજુ કોઈ દુકાન રજિસ્ટર્ડ નથી. ઈમેલથી લોગિન કરો, અથવા પહેલા Settings માં આ નંબર ઉમેરો.',
    AUTH_PHONE_OTP_MISSING: 'તમારો મોબાઇલ નંબર અને કોડ દાખલ કરો.',
    AUTH_OTP_SEND_FAILED: 'અત્યારે કોડ મોકલી શકાયો નહીં. થોડી વાર પછી ફરી પ્રયત્ન કરો.',
    SHOP_PHONE_ALREADY_LINKED: 'આ મોબાઇલ નંબર પહેલેથી બીજી દુકાન સાથે જોડાયેલો છે. કૃપા કરી બીજો નંબર વાપરો.',
    AUTH_MISSING_SIGNUP_FIELDS: 'નામ, ઈમેલ, પાસવર્ડ અને દુકાનનું નામ — બધું જરૂરી છે.',
    AUTH_EMAIL_EXISTS: 'આ ઈમેલ પહેલેથી નોંધાયેલો છે. સીધા લોગિન કરો.',
    USE_GOOGLE_SIGNIN: 'આ ખાતું Google થી બન્યું છે. "Sign in with Google" દબાવો.',
    REGISTRATION_CLOSED: 'નવી દુકાનની નોંધણી અત્યારે બંધ છે. થોડી વાર પછી પ્રયાસ કરો.',
    AUTH_GOOGLE_NOT_CONFIGURED: 'સર્વર પર Google Sign-In હજી સેટ નથી.',
    AUTH_GOOGLE_UNVERIFIED: 'Google સાઇન-ઇન ચકાસી શકાયું નથી. ફરી પ્રયાસ કરો.',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google સાઇન-ઇન પૂરું થયું નથી. ફરી પ્રયાસ કરો.',
    AUTH_EMAIL_REQUIRED: 'તમારું ઈમેલ સરનામું ભરો.',
    AUTH_RESET_EMAIL_SENT: 'જો આ ઈમેલ નોંધાયેલો હશે, તો રીસેટ લિંક મોકલી દીધી છે. તમારું ઇનબોક્સ જુઓ.',
    AUTH_RESET_LINK_EXPIRED: 'આ રીસેટ લિંક પૂરી થઈ ગઈ છે. નવી લિંક માંગો.',
    AUTH_RESET_MISSING_FIELDS: 'તમારું ઈમેલ અને નવો પાસવર્ડ ભરો.',
    AUTH_PASSWORD_TOO_SHORT: 'પાસવર્ડ ઓછામાં ઓછો 6 અક્ષરનો હોવો જોઈએ.',
    AUTH_PASSWORD_CHANGED: 'પાસવર્ડ બદલાઈ ગયો. હવે નવા પાસવર્ડથી લોગિન કરો.',
    RATE_LIMIT_LOGIN: 'ઘણી વાર ખોટું લોગિન. 15 મિનિટ પછી ફરી પ્રયાસ કરો.',
    RATE_LIMIT_PHONE_LOGIN: 'આ નેટવર્કથી ઘણી વાર લોગિનનો પ્રયાસ થયો. એક કલાક પછી ફરી પ્રયાસ કરો.',
    RATE_LIMIT_REGISTER: 'આ ડિવાઇસથી ઘણી વાર સાઇન-અપનો પ્રયાસ થયો. થોડી વાર પછી પ્રયાસ કરો.',
    RATE_LIMIT_PASSWORD_RESET: 'ઘણી વાર પાસવર્ડ રીસેટ માંગ્યો. એક કલાક પછી પ્રયાસ કરો.',
    RATE_LIMIT_GENERIC: 'બહુ ઝડપથી રિક્વેસ્ટ આવી રહી છે. એક મિનિટ રોકાઈને ફરી પ્રયાસ કરો.',
    NETWORK: 'સર્વર સુધી પહોંચી શકાયું નથી. તમારું ઇન્ટરનેટ તપાસીને ફરી પ્રયાસ કરો.',
    SERVER_ERROR: 'કંઈક ખોટું થયું. ફરી પ્રયાસ કરો.',
    GENERIC: 'કંઈક ખોટું થયું. ફરી પ્રયાસ કરો.',
  },

  kn: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan} ನಲ್ಲಿ ಸಿಗುತ್ತದೆ — ₹{price}/ತಿಂಗಳು. ಪ್ಲಾನ್ ಅಪ್‌ಗ್ರೇಡ್ ಮಾಡಿ ಪ್ರಾರಂಭಿಸಿ.',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} ಸದ್ಯಕ್ಕೆ ಯಾವ ಪ್ಲಾನ್‌ನಲ್ಲೂ ಇಲ್ಲ.',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} ನಲ್ಲಿ ಸಿಗುತ್ತದೆ. ಪ್ಲಾನ್‌ಗಳನ್ನು BillVyse ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ನಿರ್ವಹಿಸಲಾಗುತ್ತದೆ.',
    PLAN_LIMIT_REACHED: 'ಈ ತಿಂಗಳು {limit} ರಲ್ಲಿ {used} ಆಗಿವೆ. {plan} ನಲ್ಲಿ ಯಾವುದೇ ಮಿತಿ ಇಲ್ಲ — ₹{price}/ತಿಂಗಳು.',
    PLAN_LIMIT_REACHED_FINAL: 'ಈ ತಿಂಗಳು {limit} ರಲ್ಲಿ {used} ಆಗಿವೆ. 1ನೇ ತಾರೀಖು ಮತ್ತೆ ಶುರುವಾಗುತ್ತದೆ.',
    PLAN_COUNT_LIMIT_REACHED: 'ನಿಮ್ಮ ಯೋಜನೆಯಲ್ಲಿ {limit} {feature} ಇವೆ. {plan} ನಲ್ಲಿ {newLimit} — ₹{price}/ತಿಂಗಳು.',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'ನಿಮ್ಮ ಯೋಜನೆಯಲ್ಲಿ {limit} {feature} ಇವೆ, ಯಾವ ಯೋಜನೆಯಲ್ಲೂ ಇದಕ್ಕಿಂತ ಹೆಚ್ಚಿಲ್ಲ.',
    PLAN_COUNT_LIMIT_UNLIMITED: 'ನಿಮ್ಮ ಯೋಜನೆಯಲ್ಲಿ {limit} {feature} ಇವೆ. {plan} ನಲ್ಲಿ ಯಾವುದೇ ಮಿತಿ ಇಲ್ಲ — ₹{price}/ತಿಂಗಳು.',
    USAGE_LIMIT_REACHED: 'ಈ ತಿಂಗಳ {feature} ಮುಗಿದಿವೆ ({limit} ಬಳಸಲಾಗಿದೆ). 1ನೇ ತಾರೀಖು ರೀಸೆಟ್ ಆಗುತ್ತವೆ, ಅಥವಾ {plan} ನಲ್ಲಿ ತಿಂಗಳಿಗೆ {newLimit} ಸಿಗುತ್ತವೆ — ₹{price}/ತಿಂಗಳು.',
    USAGE_LIMIT_REACHED_FINAL: 'ಈ ತಿಂಗಳ {feature} ಮುಗಿದಿವೆ ({limit} ಬಳಸಲಾಗಿದೆ). 1ನೇ ತಾರೀಖು ರೀಸೆಟ್ ಆಗುತ್ತವೆ.',
    AUTH_EMAIL_NOT_VERIFIED: 'ಮೊದಲು ನಿಮ್ಮ ಇಮೇಲ್ ಖಚಿತಪಡಿಸಿ.',
    AUTH_EMAIL_INVALID: 'ಈ ಇಮೇಲ್ ವಿಳಾಸ ಸರಿ ಕಾಣುತ್ತಿಲ್ಲ.',
    AUTH_OTP_INVALID: 'ಕೋಡ್ ತಪ್ಪು ಅಥವಾ ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸದು ಕೇಳಿ.',
    AUTH_OTP_LOCKED: 'ಹಲವು ಬಾರಿ ತಪ್ಪು ಕೋಡ್. ಹೊಸದು ಕೇಳಿ.',
    AUTH_OTP_MISSING: 'ಇಮೇಲ್‌ನಲ್ಲಿ ಬಂದ ಕೋಡ್ ನಮೂದಿಸಿ.',
    EMAIL_NOT_CONFIGURED: 'ಹೊಸ ನೋಂದಣಿ ಸದ್ಯಕ್ಕೆ ಮುಚ್ಚಲಾಗಿದೆ. ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
    RATE_LIMIT_EMAIL_OTP: 'ಹಲವು ಬಾರಿ ಕೋಡ್ ಕೇಳಲಾಗಿದೆ. 15 ನಿಮಿಷ ಕಾಯಿರಿ.',
    CSRF_FAILED: 'ಈ ಪುಟ ಹಳೆಯದಾಗಿದೆ. ಪುಟವನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    NOT_AUTHENTICATED: 'ನೀವು ಲಾಗಿನ್ ಆಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಲಾಗಿನ್ ಮಾಡಿ.',
    SESSION_EXPIRED: 'ನಿಮ್ಮ ಸೆಷನ್ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಲಾಗಿನ್ ಮಾಡಿ.',
    ACCOUNT_INACTIVE: 'ಈ ಖಾತೆ ಈಗ ಸಕ್ರಿಯವಾಗಿಲ್ಲ. ಅಂಗಡಿ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.',
    AUTH_ACCOUNT_SUSPENDED: 'ಈ ಖಾತೆಯನ್ನು ಸ್ಥಗಿತಗೊಳಿಸಲಾಗಿದೆ',
    AUTH_INVALID_CREDENTIALS: 'ಇಮೇಲ್ ಅಥವಾ ಪಾಸ್‌ವರ್ಡ್ ತಪ್ಪಾಗಿದೆ.',
    AUTH_MISSING_CREDENTIALS: 'ಇಮೇಲ್ ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್ ಎರಡನ್ನೂ ಭರ್ತಿ ಮಾಡಿ.',
    AUTH_PHONE_MISSING: 'ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
    AUTH_PHONE_INVALID: 'ಸರಿಯಾದ 10 ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
    AUTH_PHONE_NOT_FOUND: 'ಈ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಇನ್ನೂ ಯಾವುದೇ ಅಂಗಡಿ ನೋಂದಣಿಯಾಗಿಲ್ಲ. ಇಮೇಲ್ ಮೂಲಕ ಲಾಗಿನ್ ಮಾಡಿ, ಅಥವಾ ಮೊದಲು Settings ನಲ್ಲಿ ಈ ಸಂಖ್ಯೆಯನ್ನು ಸೇರಿಸಿ.',
    AUTH_PHONE_OTP_MISSING: 'ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಮತ್ತು ಕೋಡ್ ನಮೂದಿಸಿ.',
    AUTH_OTP_SEND_FAILED: 'ಈಗ ಕೋಡ್ ಕಳುಹಿಸಲು ಆಗಲಿಲ್ಲ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    SHOP_PHONE_ALREADY_LINKED: 'ಈ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಈಗಾಗಲೇ ಬೇರೆ ಅಂಗಡಿಗೆ ಲಿಂಕ್ ಆಗಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಸಂಖ್ಯೆ ಬಳಸಿ.',
    AUTH_MISSING_SIGNUP_FIELDS: 'ಹೆಸರು, ಇಮೇಲ್, ಪಾಸ್‌ವರ್ಡ್ ಮತ್ತು ಅಂಗಡಿಯ ಹೆಸರು — ಎಲ್ಲವೂ ಬೇಕು.',
    AUTH_EMAIL_EXISTS: 'ಈ ಇಮೇಲ್ ಈಗಾಗಲೇ ನೋಂದಾಯಿಸಲಾಗಿದೆ. ನೇರವಾಗಿ ಲಾಗಿನ್ ಮಾಡಿ.',
    USE_GOOGLE_SIGNIN: 'ಈ ಖಾತೆ Google ಮೂಲಕ ರಚಿಸಲಾಗಿದೆ. "Sign in with Google" ಒತ್ತಿರಿ.',
    REGISTRATION_CLOSED: 'ಹೊಸ ಅಂಗಡಿ ನೋಂದಣಿ ಸದ್ಯಕ್ಕೆ ಮುಚ್ಚಲಾಗಿದೆ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
    AUTH_GOOGLE_NOT_CONFIGURED: 'ಸರ್ವರ್‌ನಲ್ಲಿ Google Sign-In ಇನ್ನೂ ಹೊಂದಿಸಿಲ್ಲ.',
    AUTH_GOOGLE_UNVERIFIED: 'Google ಸೈನ್-ಇನ್ ಪರಿಶೀಲಿಸಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google ಸೈನ್-ಇನ್ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    AUTH_EMAIL_REQUIRED: 'ನಿಮ್ಮ ಇಮೇಲ್ ವಿಳಾಸ ಭರ್ತಿ ಮಾಡಿ.',
    AUTH_RESET_EMAIL_SENT: 'ಈ ಇಮೇಲ್ ನೋಂದಾಯಿಸಿದ್ದರೆ, ರೀಸೆಟ್ ಲಿಂಕ್ ಕಳುಹಿಸಲಾಗಿದೆ. ನಿಮ್ಮ ಇನ್‌ಬಾಕ್ಸ್ ನೋಡಿ.',
    AUTH_RESET_LINK_EXPIRED: 'ಈ ರೀಸೆಟ್ ಲಿಂಕ್ ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸ ಲಿಂಕ್ ಕೇಳಿ.',
    AUTH_RESET_MISSING_FIELDS: 'ನಿಮ್ಮ ಇಮೇಲ್ ಮತ್ತು ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಭರ್ತಿ ಮಾಡಿ.',
    AUTH_PASSWORD_TOO_SHORT: 'ಪಾಸ್‌ವರ್ಡ್ ಕನಿಷ್ಠ 6 ಅಕ್ಷರಗಳಾಗಿರಬೇಕು.',
    AUTH_PASSWORD_CHANGED: 'ಪಾಸ್‌ವರ್ಡ್ ಬದಲಾಗಿದೆ. ಈಗ ಹೊಸ ಪಾಸ್‌ವರ್ಡ್‌ನಿಂದ ಲಾಗಿನ್ ಮಾಡಿ.',
    RATE_LIMIT_LOGIN: 'ಹಲವು ಬಾರಿ ತಪ್ಪು ಲಾಗಿನ್. 15 ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    RATE_LIMIT_PHONE_LOGIN: 'ಈ ನೆಟ್‌ವರ್ಕ್‌ನಿಂದ ಹಲವು ಬಾರಿ ಲಾಗಿನ್ ಪ್ರಯತ್ನ. ಒಂದು ಗಂಟೆಯ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    RATE_LIMIT_REGISTER: 'ಈ ಸಾಧನದಿಂದ ಹಲವು ಬಾರಿ ಸೈನ್-ಅಪ್ ಪ್ರಯತ್ನ ನಡೆದಿದೆ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
    RATE_LIMIT_PASSWORD_RESET: 'ಹಲವು ಬಾರಿ ಪಾಸ್‌ವರ್ಡ್ ರೀಸೆಟ್ ಕೇಳಲಾಗಿದೆ. ಒಂದು ಗಂಟೆಯ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
    RATE_LIMIT_GENERIC: 'ಬಹಳ ವೇಗವಾಗಿ ವಿನಂತಿಗಳು ಬರುತ್ತಿವೆ. ಒಂದು ನಿಮಿಷ ಕಾದು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    NETWORK: 'ಸರ್ವರ್ ತಲುಪಲಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಇಂಟರ್ನೆಟ್ ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    SERVER_ERROR: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    GENERIC: 'ಏನೋ ತಪ್ಪಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  },

  pa: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan} ਵਿੱਚ ਮਿਲਦਾ ਹੈ — ₹{price}/ਮਹੀਨਾ। ਪਲਾਨ ਅਪਗ੍ਰੇਡ ਕਰਕੇ ਚਾਲੂ ਕਰੋ।',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} ਹੁਣ ਕਿਸੇ ਵੀ ਪਲਾਨ ਵਿੱਚ ਨਹੀਂ ਹੈ।',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} ਵਿੱਚ ਮਿਲਦਾ ਹੈ। ਪਲਾਨ BillVyse ਵੈੱਬਸਾਈਟ ਉੱਤੇ ਮੈਨੇਜ ਹੁੰਦੇ ਹਨ।',
    PLAN_LIMIT_REACHED: 'ਇਸ ਮਹੀਨੇ {limit} ਵਿੱਚੋਂ {used} ਹੋ ਗਏ। {plan} ਵਿੱਚ ਕੋਈ ਹੱਦ ਨਹੀਂ — ₹{price}/ਮਹੀਨਾ।',
    PLAN_LIMIT_REACHED_FINAL: 'ਇਸ ਮਹੀਨੇ {limit} ਵਿੱਚੋਂ {used} ਹੋ ਗਏ। 1 ਤਰੀਕ ਨੂੰ ਮੁੜ ਸ਼ੁਰੂ ਹੋਵੇਗਾ।',
    PLAN_COUNT_LIMIT_REACHED: 'ਤੁਹਾਡੇ ਪਲਾਨ ਵਿੱਚ {limit} {feature} ਹਨ। {plan} ਵਿੱਚ {newLimit} — ₹{price}/ਮਹੀਨਾ।',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'ਤੁਹਾਡੇ ਪਲਾਨ ਵਿੱਚ {limit} {feature} ਹਨ, ਕਿਸੇ ਵੀ ਪਲਾਨ ਵਿੱਚ ਇਸ ਤੋਂ ਵੱਧ ਨਹੀਂ।',
    PLAN_COUNT_LIMIT_UNLIMITED: 'ਤੁਹਾਡੇ ਪਲਾਨ ਵਿੱਚ {limit} {feature} ਹਨ। {plan} ਵਿੱਚ ਕੋਈ ਹੱਦ ਨਹੀਂ — ₹{price}/ਮਹੀਨਾ।',
    USAGE_LIMIT_REACHED: 'ਇਸ ਮਹੀਨੇ ਦੇ {feature} ਮੁੱਕ ਗਏ ({limit} ਵਰਤੇ)। 1 ਤਰੀਕ ਨੂੰ ਰੀਸੈਟ ਹੋਣਗੇ, ਜਾਂ {plan} ਵਿੱਚ ਹਰ ਮਹੀਨੇ {newLimit} ਮਿਲਦੇ ਹਨ — ₹{price}/ਮਹੀਨਾ।',
    USAGE_LIMIT_REACHED_FINAL: 'ਇਸ ਮਹੀਨੇ ਦੇ {feature} ਮੁੱਕ ਗਏ ({limit} ਵਰਤੇ)। 1 ਤਰੀਕ ਨੂੰ ਰੀਸੈਟ ਹੋਣਗੇ।',
    AUTH_EMAIL_NOT_VERIFIED: 'ਪਹਿਲਾਂ ਆਪਣਾ ਈਮੇਲ ਪੱਕਾ ਕਰੋ।',
    AUTH_EMAIL_INVALID: 'ਇਹ ਈਮੇਲ ਪਤਾ ਠੀਕ ਨਹੀਂ ਲੱਗਦਾ।',
    AUTH_OTP_INVALID: 'ਕੋਡ ਗ਼ਲਤ ਹੈ ਜਾਂ ਖ਼ਤਮ ਹੋ ਗਿਆ। ਨਵਾਂ ਮੰਗੋ।',
    AUTH_OTP_LOCKED: 'ਕਈ ਵਾਰ ਗ਼ਲਤ ਕੋਡ। ਨਵਾਂ ਮੰਗੋ।',
    AUTH_OTP_MISSING: 'ਈਮੇਲ ਵਿੱਚ ਆਇਆ ਕੋਡ ਭਰੋ।',
    EMAIL_NOT_CONFIGURED: 'ਨਵੀਂ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਹੁਣ ਬੰਦ ਹੈ। ਬਾਅਦ ਵਿੱਚ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    RATE_LIMIT_EMAIL_OTP: 'ਕਈ ਵਾਰ ਕੋਡ ਮੰਗਿਆ। 15 ਮਿੰਟ ਰੁਕੋ।',
    CSRF_FAILED: 'ਇਹ ਪੰਨਾ ਪੁਰਾਣਾ ਹੋ ਗਿਆ ਹੈ। ਪੰਨਾ ਰਿਫ੍ਰੈਸ਼ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    NOT_AUTHENTICATED: 'ਤੁਸੀਂ ਲੌਗਿਨ ਨਹੀਂ ਹੋ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਲੌਗਿਨ ਕਰੋ।',
    SESSION_EXPIRED: 'ਤੁਹਾਡਾ ਸੈਸ਼ਨ ਖ਼ਤਮ ਹੋ ਗਿਆ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਲੌਗਿਨ ਕਰੋ।',
    ACCOUNT_INACTIVE: 'ਇਹ ਖਾਤਾ ਹੁਣ ਚਾਲੂ ਨਹੀਂ ਹੈ। ਦੁਕਾਨ ਮਾਲਕ ਨਾਲ ਗੱਲ ਕਰੋ।',
    AUTH_ACCOUNT_SUSPENDED: 'ਇਹ ਖਾਤਾ ਬੰਦ ਕਰ ਦਿੱਤਾ ਗਿਆ ਹੈ',
    AUTH_INVALID_CREDENTIALS: 'ਈਮੇਲ ਜਾਂ ਪਾਸਵਰਡ ਗ਼ਲਤ ਹੈ।',
    AUTH_MISSING_CREDENTIALS: 'ਈਮੇਲ ਅਤੇ ਪਾਸਵਰਡ ਦੋਵੇਂ ਭਰੋ।',
    AUTH_PHONE_MISSING: 'ਆਪਣਾ ਮੋਬਾਈਲ ਨੰਬਰ ਦਰਜ ਕਰੋ।',
    AUTH_PHONE_INVALID: 'ਸਹੀ 10 ਅੰਕਾਂ ਦਾ ਮੋਬਾਈਲ ਨੰਬਰ ਦਰਜ ਕਰੋ।',
    AUTH_PHONE_NOT_FOUND: 'ਇਸ ਮੋਬਾਈਲ ਨੰਬਰ ਨਾਲ ਹਾਲੇ ਕੋਈ ਦੁਕਾਨ ਰਜਿਸਟਰਡ ਨਹੀਂ ਹੈ। ਈਮੇਲ ਨਾਲ ਲੌਗਇਨ ਕਰੋ, ਜਾਂ ਪਹਿਲਾਂ Settings ਵਿੱਚ ਇਹ ਨੰਬਰ ਜੋੜੋ।',
    AUTH_PHONE_OTP_MISSING: 'ਆਪਣਾ ਮੋਬਾਈਲ ਨੰਬਰ ਅਤੇ ਕੋਡ ਦਰਜ ਕਰੋ।',
    AUTH_OTP_SEND_FAILED: 'ਹੁਣੇ ਕੋਡ ਨਹੀਂ ਭੇਜਿਆ ਜਾ ਸਕਿਆ। ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    SHOP_PHONE_ALREADY_LINKED: 'ਇਹ ਮੋਬਾਈਲ ਨੰਬਰ ਪਹਿਲਾਂ ਹੀ ਕਿਸੇ ਹੋਰ ਦੁਕਾਨ ਨਾਲ ਜੁੜਿਆ ਹੋਇਆ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਹੋਰ ਨੰਬਰ ਵਰਤੋ।',
    AUTH_MISSING_SIGNUP_FIELDS: 'ਨਾਮ, ਈਮੇਲ, ਪਾਸਵਰਡ ਅਤੇ ਦੁਕਾਨ ਦਾ ਨਾਮ — ਸਭ ਜ਼ਰੂਰੀ ਹਨ।',
    AUTH_EMAIL_EXISTS: 'ਇਹ ਈਮੇਲ ਪਹਿਲਾਂ ਹੀ ਰਜਿਸਟਰ ਹੈ। ਸਿੱਧਾ ਲੌਗਿਨ ਕਰੋ।',
    USE_GOOGLE_SIGNIN: 'ਇਹ ਖਾਤਾ Google ਨਾਲ ਬਣਿਆ ਹੈ। "Sign in with Google" ਦਬਾਓ।',
    REGISTRATION_CLOSED: 'ਨਵੀਂ ਦੁਕਾਨ ਦੀ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਹੁਣ ਬੰਦ ਹੈ। ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    AUTH_GOOGLE_NOT_CONFIGURED: 'ਸਰਵਰ ਉੱਤੇ Google Sign-In ਅਜੇ ਸੈੱਟ ਨਹੀਂ ਹੈ।',
    AUTH_GOOGLE_UNVERIFIED: 'Google ਸਾਈਨ-ਇਨ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google ਸਾਈਨ-ਇਨ ਪੂਰਾ ਨਹੀਂ ਹੋਇਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    AUTH_EMAIL_REQUIRED: 'ਆਪਣਾ ਈਮੇਲ ਪਤਾ ਭਰੋ।',
    AUTH_RESET_EMAIL_SENT: 'ਜੇ ਇਹ ਈਮੇਲ ਰਜਿਸਟਰ ਹੈ, ਤਾਂ ਰੀਸੈੱਟ ਲਿੰਕ ਭੇਜ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਆਪਣਾ ਇਨਬਾਕਸ ਵੇਖੋ।',
    AUTH_RESET_LINK_EXPIRED: 'ਇਹ ਰੀਸੈੱਟ ਲਿੰਕ ਖ਼ਤਮ ਹੋ ਚੁੱਕਾ ਹੈ। ਨਵਾਂ ਲਿੰਕ ਮੰਗੋ।',
    AUTH_RESET_MISSING_FIELDS: 'ਆਪਣਾ ਈਮੇਲ ਅਤੇ ਨਵਾਂ ਪਾਸਵਰਡ ਭਰੋ।',
    AUTH_PASSWORD_TOO_SHORT: 'ਪਾਸਵਰਡ ਘੱਟੋ-ਘੱਟ 6 ਅੱਖਰਾਂ ਦਾ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
    AUTH_PASSWORD_CHANGED: 'ਪਾਸਵਰਡ ਬਦਲ ਗਿਆ। ਹੁਣ ਨਵੇਂ ਪਾਸਵਰਡ ਨਾਲ ਲੌਗਿਨ ਕਰੋ।',
    RATE_LIMIT_LOGIN: 'ਕਈ ਵਾਰ ਗ਼ਲਤ ਲੌਗਿਨ। 15 ਮਿੰਟ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    RATE_LIMIT_PHONE_LOGIN: 'ਇਸ ਨੈੱਟਵਰਕ ਤੋਂ ਕਈ ਵਾਰ ਲੌਗਿਨ ਦੀ ਕੋਸ਼ਿਸ਼ ਹੋਈ। ਇੱਕ ਘੰਟੇ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    RATE_LIMIT_REGISTER: 'ਇਸ ਡਿਵਾਈਸ ਤੋਂ ਕਈ ਵਾਰ ਸਾਈਨ-ਅੱਪ ਦੀ ਕੋਸ਼ਿਸ਼ ਹੋਈ। ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    RATE_LIMIT_PASSWORD_RESET: 'ਕਈ ਵਾਰ ਪਾਸਵਰਡ ਰੀਸੈੱਟ ਮੰਗਿਆ ਗਿਆ। ਇੱਕ ਘੰਟੇ ਬਾਅਦ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    RATE_LIMIT_GENERIC: 'ਬਹੁਤ ਤੇਜ਼ੀ ਨਾਲ ਬੇਨਤੀਆਂ ਆ ਰਹੀਆਂ ਹਨ। ਇੱਕ ਮਿੰਟ ਰੁਕ ਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    NETWORK: 'ਸਰਵਰ ਤੱਕ ਪਹੁੰਚ ਨਹੀਂ ਹੋ ਸਕੀ। ਆਪਣਾ ਇੰਟਰਨੈੱਟ ਵੇਖ ਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    SERVER_ERROR: 'ਕੁਝ ਗੜਬੜ ਹੋ ਗਈ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    GENERIC: 'ਕੁਝ ਗੜਬੜ ਹੋ ਗਈ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },

  ur: {
    PLAN_UPGRADE_REQUIRED: '{feature} {plan} میں ملتا ہے — ₹{price}/ماہ۔ پلان اپ گریڈ کر کے چالو کریں۔',
    PLAN_UPGRADE_UNAVAILABLE: '{feature} فی الحال کسی بھی پلان میں نہیں ہے۔',
    PLAN_UPGRADE_ELSEWHERE: '{feature} {plan} میں شامل ہے۔ پلان BillVyse ویب سائٹ پر منظم ہوتے ہیں۔',
    PLAN_LIMIT_REACHED: 'اس مہینے {limit} میں سے {used} ہو چکے۔ {plan} میں کوئی حد نہیں — ₹{price}/ماہ۔',
    PLAN_LIMIT_REACHED_FINAL: 'اس مہینے {limit} میں سے {used} ہو چکے۔ 1 تاریخ کو دوبارہ شروع ہوگا۔',
    PLAN_COUNT_LIMIT_REACHED: 'آپ کے پلان میں {limit} {feature} ہیں۔ {plan} میں {newLimit} — ₹{price}/ماہ۔',
    PLAN_COUNT_LIMIT_REACHED_FINAL: 'آپ کے پلان میں {limit} {feature} ہیں، اور کسی بھی پلان میں اس سے زیادہ نہیں۔',
    PLAN_COUNT_LIMIT_UNLIMITED: 'آپ کے پلان میں {limit} {feature} ہیں۔ {plan} میں کوئی حد نہیں — ₹{price}/ماہ۔',
    USAGE_LIMIT_REACHED: 'اس مہینے کے {feature} ختم ({limit} استعمال ہوئے)۔ 1 تاریخ کو ری سیٹ ہوں گے، یا {plan} میں ہر ماہ {newLimit} ملتے ہیں — ₹{price}/ماہ۔',
    USAGE_LIMIT_REACHED_FINAL: 'اس مہینے کے {feature} ختم ({limit} استعمال ہوئے)۔ 1 تاریخ کو ری سیٹ ہوں گے۔',
    AUTH_EMAIL_NOT_VERIFIED: 'پہلے اپنا ای میل تصدیق کریں۔',
    AUTH_EMAIL_INVALID: 'یہ ای میل پتہ درست نہیں لگتا۔',
    AUTH_OTP_INVALID: 'کوڈ غلط ہے یا ختم ہو چکا ہے۔ نیا کوڈ مانگیں۔',
    AUTH_OTP_LOCKED: 'کئی بار غلط کوڈ۔ نیا کوڈ مانگیں۔',
    AUTH_OTP_MISSING: 'ای میل پر آیا کوڈ درج کریں۔',
    EMAIL_NOT_CONFIGURED: 'نئی رجسٹریشن ابھی بند ہے۔ بعد میں کوشش کریں۔',
    RATE_LIMIT_EMAIL_OTP: 'کئی بار کوڈ مانگا گیا۔ 15 منٹ انتظار کریں۔',
    CSRF_FAILED: 'یہ صفحہ پرانا ہو گیا ہے۔ صفحہ ریفریش کر کے دوبارہ کوشش کریں۔',
    NOT_AUTHENTICATED: 'آپ لاگ اِن نہیں ہیں۔ براہِ کرم دوبارہ لاگ اِن کریں۔',
    SESSION_EXPIRED: 'آپ کا سیشن ختم ہو گیا۔ براہِ کرم دوبارہ لاگ اِن کریں۔',
    ACCOUNT_INACTIVE: 'یہ اکاؤنٹ اب فعال نہیں ہے۔ دکان مالک سے بات کریں۔',
    AUTH_ACCOUNT_SUSPENDED: 'یہ اکاؤنٹ بند کر دیا گیا ہے',
    AUTH_INVALID_CREDENTIALS: 'ای میل یا پاس ورڈ غلط ہے۔',
    AUTH_MISSING_CREDENTIALS: 'ای میل اور پاس ورڈ دونوں بھریں۔',
    AUTH_PHONE_MISSING: 'اپنا موبائل نمبر درج کریں۔',
    AUTH_PHONE_INVALID: 'درست 10 ہندسوں کا موبائل نمبر درج کریں۔',
    AUTH_PHONE_NOT_FOUND: 'اس موبائل نمبر پر ابھی کوئی دکان رجسٹرڈ نہیں ہے۔ ای میل سے لاگ اِن کریں، یا پہلے Settings میں یہ نمبر شامل کریں۔',
    AUTH_PHONE_OTP_MISSING: 'اپنا موبائل نمبر اور کوڈ درج کریں۔',
    AUTH_OTP_SEND_FAILED: 'ابھی کوڈ نہیں بھیجا جا سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    SHOP_PHONE_ALREADY_LINKED: 'یہ موبائل نمبر پہلے سے کسی اور دکان سے منسلک ہے۔ براہ کرم دوسرا نمبر استعمال کریں۔',
    AUTH_MISSING_SIGNUP_FIELDS: 'نام، ای میل، پاس ورڈ اور دکان کا نام — سب ضروری ہیں۔',
    AUTH_EMAIL_EXISTS: 'یہ ای میل پہلے سے رجسٹرڈ ہے۔ سیدھا لاگ اِن کریں۔',
    USE_GOOGLE_SIGNIN: 'یہ اکاؤنٹ Google سے بنا ہے۔ "Sign in with Google" دبائیں۔',
    REGISTRATION_CLOSED: 'نئی دکان کی رجسٹریشن ابھی بند ہے۔ تھوڑی دیر بعد کوشش کریں۔',
    AUTH_GOOGLE_NOT_CONFIGURED: 'سرور پر Google Sign-In ابھی سیٹ نہیں ہے۔',
    AUTH_GOOGLE_UNVERIFIED: 'Google سائن اِن کی تصدیق نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
    AUTH_GOOGLE_CREDENTIAL_REQUIRED: 'Google سائن اِن مکمل نہیں ہوا۔ دوبارہ کوشش کریں۔',
    AUTH_EMAIL_REQUIRED: 'اپنا ای میل پتہ بھریں۔',
    AUTH_RESET_EMAIL_SENT: 'اگر یہ ای میل رجسٹرڈ ہے تو ری سیٹ لنک بھیج دیا گیا ہے۔ اپنا اِن باکس دیکھیں۔',
    AUTH_RESET_LINK_EXPIRED: 'یہ ری سیٹ لنک ختم ہو چکا ہے۔ نیا لنک مانگیں۔',
    AUTH_RESET_MISSING_FIELDS: 'اپنا ای میل اور نیا پاس ورڈ بھریں۔',
    AUTH_PASSWORD_TOO_SHORT: 'پاس ورڈ کم از کم 6 حروف کا ہونا چاہیے۔',
    AUTH_PASSWORD_CHANGED: 'پاس ورڈ بدل گیا۔ اب نئے پاس ورڈ سے لاگ اِن کریں۔',
    RATE_LIMIT_LOGIN: 'کئی بار غلط لاگ اِن۔ 15 منٹ بعد دوبارہ کوشش کریں۔',
    RATE_LIMIT_PHONE_LOGIN: 'اس نیٹ ورک سے کئی بار لاگ اِن کی کوشش ہوئی۔ ایک گھنٹے بعد دوبارہ کوشش کریں۔',
    RATE_LIMIT_REGISTER: 'اس ڈیوائس سے کئی بار سائن اپ کی کوشش ہوئی۔ تھوڑی دیر بعد کوشش کریں۔',
    RATE_LIMIT_PASSWORD_RESET: 'کئی بار پاس ورڈ ری سیٹ مانگا گیا۔ ایک گھنٹے بعد کوشش کریں۔',
    RATE_LIMIT_GENERIC: 'درخواستیں بہت تیزی سے آ رہی ہیں۔ ایک منٹ رک کر دوبارہ کوشش کریں۔',
    NETWORK: 'سرور تک رسائی نہیں ہو سکی۔ اپنا انٹرنیٹ دیکھ کر دوبارہ کوشش کریں۔',
    SERVER_ERROR: 'کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں۔',
    GENERIC: 'کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں۔',
  },
};

/**
 * A thrown request failure, as a sentence in `lang`.
 *
 * Order matters here:
 *   1. a known `code` wins, because it is the only thing that is reliably translated;
 *   2. then the server's own `message`, which is English but always accurate;
 *   3. then a generic line, so a network failure never surfaces as "Failed to fetch".
 *
 * `reason` (a suspension note a platform admin typed) is appended rather than translated —
 * it is free text in whatever language they wrote it, and mangling it would be worse than
 * showing it as-is.
 */
/**
 * What the shopkeeper was actually trying to do, in words.
 *
 * The 402 carries a feature KEY (`gst.export`, `aiScans`), which is a developer's word. A
 * refusal that names it is barely better than one that names nothing — the whole point of
 * these three messages is that a shop can act on them.
 *
 * Only the three languages with full app coverage are written out; everything else falls
 * back to English, the same rule the rest of the dashboard follows.
 */
const FEATURE_LABELS = {
  en: {
    khata: 'The khata (udhaar) book', staffManagement: 'Staff accounts', multiStore: 'Multiple stores',
    multiCounter: 'Multi-counter billing', 'gst.export': 'GST return export',
    'reports.advanced': 'Advanced reports', 'invoice.branding': 'Removing our name from your bills',
    onlineOrdering: 'Online ordering', apiAccess: 'API access',
    recurringInvoices: 'Repeating bills', maxStores: 'branches',
    maxRecurring: 'repeating bills', maxCounters: 'billing counters',
    billsPerMonth: 'bills', estimatesPerMonth: 'quotations',
    aiScans: 'AI bill scans', sms: 'SMS', whatsapp: 'WhatsApp messages',
    maxProducts: 'products', maxCustomers: 'customers', maxSuppliers: 'suppliers',
    maxStaff: 'staff accounts', maxCatalogueProducts: 'catalogue products',
    maxCatalogueOrders: 'online orders', maxAppointments: 'appointment bookings',
    suppliers: 'Supplier directory & ledger', purchaseOrders: 'Purchase orders',
    'inventory.batchTracking': 'Batch / lot & expiry tracking', 'reports.profitLoss': 'Profit & Loss statement',
    loyalty: 'Loyalty points & offers', customerBooking: 'Customer online booking',
  },
  hi: {
    khata: 'खाता (उधार) बही', staffManagement: 'स्टाफ अकाउंट', multiStore: 'एक से ज़्यादा दुकान',
    multiCounter: 'मल्टी-काउंटर बिलिंग', 'gst.export': 'GST रिटर्न एक्सपोर्ट',
    'reports.advanced': 'एडवांस्ड रिपोर्ट', 'invoice.branding': 'बिल से हमारा नाम हटाना',
    onlineOrdering: 'ऑनलाइन ऑर्डर', apiAccess: 'API एक्सेस',
    recurringInvoices: 'अपने आप बनने वाले बिल', maxStores: 'ब्रांच',
    maxRecurring: 'अपने आप बनने वाले बिल', maxCounters: 'बिलिंग काउंटर',
    billsPerMonth: 'बिल', estimatesPerMonth: 'कोटेशन',
    aiScans: 'AI बिल स्कैन', sms: 'SMS', whatsapp: 'WhatsApp मैसेज',
    maxProducts: 'प्रोडक्ट', maxCustomers: 'ग्राहक', maxSuppliers: 'सप्लायर',
    maxStaff: 'स्टाफ अकाउंट', maxCatalogueProducts: 'कैटलॉग प्रोडक्ट',
    maxCatalogueOrders: 'ऑनलाइन ऑर्डर', maxAppointments: 'अपॉइंटमेंट बुकिंग',
    suppliers: 'सप्लायर डायरेक्टरी और लेजर', purchaseOrders: 'पर्चेज़ ऑर्डर',
    'inventory.batchTracking': 'बैच / लॉट और एक्सपायरी ट्रैकिंग', 'reports.profitLoss': 'प्रॉफिट एंड लॉस स्टेटमेंट',
    loyalty: 'लॉयल्टी पॉइंट्स और ऑफर', customerBooking: 'कस्टमर ऑनलाइन बुकिंग',
  },
  mr: {
    khata: 'खाते (उधार) वही', staffManagement: 'स्टाफ खाती', multiStore: 'एकापेक्षा जास्त दुकाने',
    multiCounter: 'मल्टी-काउंटर बिलिंग', 'gst.export': 'GST रिटर्न एक्सपोर्ट',
    'reports.advanced': 'प्रगत अहवाल', 'invoice.branding': 'बिलावरून आमचे नाव काढणे',
    onlineOrdering: 'ऑनलाइन ऑर्डर', apiAccess: 'API अ‍ॅक्सेस',
    recurringInvoices: 'आपोआप तयार होणारी बिले', maxStores: 'शाखा',
    maxRecurring: 'आपोआप तयार होणारी बिले', maxCounters: 'बिलिंग काउंटर',
    billsPerMonth: 'बिल', estimatesPerMonth: 'कोटेशन',
    aiScans: 'AI बिल स्कॅन', sms: 'SMS', whatsapp: 'WhatsApp मेसेज',
    maxProducts: 'प्रोडक्ट', maxCustomers: 'ग्राहक', maxSuppliers: 'सप्लायर',
    maxStaff: 'स्टाफ खाती', maxCatalogueProducts: 'कॅटलॉग प्रोडक्ट',
    maxCatalogueOrders: 'ऑनलाइन ऑर्डर', maxAppointments: 'अपॉइंटमेंट बुकिंग',
    suppliers: 'सप्लायर डिरेक्टरी आणि लेजर', purchaseOrders: 'पर्चेस ऑर्डर',
    'inventory.batchTracking': 'बॅच / लॉट आणि एक्सपायरी ट्रॅकिंग', 'reports.profitLoss': 'प्रॉफिट अँड लॉस स्टेटमेंट',
    loyalty: 'लॉयल्टी पॉइंट्स आणि ऑफर', customerBooking: 'कस्टमर ऑनलाइन बुकिंग',
  },
};

/**
 * The shopkeeper-facing name of a plan feature.
 *
 * Exported because the upgrade sheet needs the same words this file already puts in the
 * error sentence — "khata" is a database string, "khata (udhaar) bahi" is what the shop
 * calls it, and the sheet saying one while the toast says the other would read as two
 * different problems.
 */
export function featureLabel(lang, key) {
  if (!key) return '';
  return FEATURE_LABELS[lang]?.[key] || FEATURE_LABELS.en[key] || key;
}

/**
 * Picks the variant that matches what the server could actually offer.
 *
 * An upgrade prompt with no plan to upgrade TO is worse than no prompt: the shopkeeper goes
 * to the pricing page, finds nothing that includes it, and concludes the app is broken. So
 * when the 402 comes back without a `requiredPlan` — a feature retired from every tier, a
 * cap no plan lifts — the message says so plainly instead.
 */
function upgradeVariant(code, error) {
  const hasTarget = Boolean(error?.requiredPlanName || error?.data?.requiredPlanName);
  if (!hasTarget) {
    if (code === 'PLAN_UPGRADE_REQUIRED') return 'PLAN_UPGRADE_UNAVAILABLE';
    if (code === 'PLAN_LIMIT_REACHED') return 'PLAN_LIMIT_REACHED_FINAL';
    if (code === 'PLAN_COUNT_LIMIT_REACHED') return 'PLAN_COUNT_LIMIT_REACHED_FINAL';
    if (code === 'USAGE_LIMIT_REACHED') return 'USAGE_LIMIT_REACHED_FINAL';
    return code;
  }

  /**
   * A tier exists, but no price came with it — which is the Google Play build.
   *
   * The server strips offer prices out of every answer it sends the Play app
   * (backend/middleware/nativeClient.js), because Google's Payments policy does not let us
   * sell our own plans inside an app it distributes. The nice consequence is right here:
   * this file needs no notion of "native" at all. A missing price is enough to pick a
   * sentence that never needed one, so the rule is enforced in exactly one place and every
   * screen that shows an error inherits it.
   *
   * The two cap messages already have price-free wordings in all ten languages, and they
   * say the true and useful thing — when the counter resets. `PLAN_UPGRADE_REQUIRED` needs
   * its own, because the existing fallback claims the feature "is not on any plan", and on
   * Play that would be a lie: it is on a plan, it just is not bought from in here.
   */
  const hasPrice = (error?.priceMonthly ?? error?.data?.priceMonthly) != null;
  if (!hasPrice) {
    if (code === 'PLAN_UPGRADE_REQUIRED') return 'PLAN_UPGRADE_ELSEWHERE';
    if (code === 'PLAN_LIMIT_REACHED') return 'PLAN_LIMIT_REACHED_FINAL';
    if (code === 'PLAN_COUNT_LIMIT_REACHED') return 'PLAN_COUNT_LIMIT_REACHED_FINAL';
    if (code === 'USAGE_LIMIT_REACHED') return 'USAGE_LIMIT_REACHED_FINAL';
  }

  /**
   * There is a tier to move to and a price to name, but the tier is UNLIMITED — so there is
   * no bigger NUMBER to name.
   *
   * `{newLimit}` would have been substituted with nothing at all, leaving "Premium allows
   *  — ₹499/month": a sentence with a hole in it, which is the same failure as printing the
   * word "null". A missing value gets its own wording, never a gap in this one. Checked
   * after the price rule above, because a Play build must never be handed a sentence with a
   * rupee sign in it.
   */
  if (code === 'PLAN_COUNT_LIMIT_REACHED') {
    const upgradeLimit = error?.upgradeLimit ?? error?.data?.upgradeLimit;
    if (upgradeLimit == null) return 'PLAN_COUNT_LIMIT_UNLIMITED';
  }

  return code;
}

/**
 * Which box on screen a server refusal is about, or null.
 *
 * The API already names one on most refusals that concern a single field — a duplicate
 * shop number answers `{ code: 'SHOP_PHONE_ALREADY_LINKED', field: 'shopPhone' }` — and
 * nothing on the client was reading it. So "this mobile number is already linked to another
 * shop" arrived as a banner above a form of six boxes and the reader had to work out which
 * one it meant, on the one screen a brand-new shop cannot skip.
 *
 * `aliases` maps the server's field NAME to the DOM id it has on this particular screen,
 * because the same field is `shopPhone` on Settings and `gateShopPhone` on the identity
 * wall. Without a match the caller falls back to the banner, which is what it did before —
 * a refusal must never be swallowed just because it could not be placed.
 *
 * `CODE_FIELDS` covers the few refusals whose controller does not send a field but which
 * are unambiguously about one box.
 */
const CODE_FIELDS = {
  SHOP_PHONE_ALREADY_LINKED: 'shopPhone',
  CUSTOMER_PHONE_INCOMPLETE: 'phone',
  NO_CUSTOMER_PHONE: 'phone',
  NO_SUPPLIER_PHONE: 'phone',
  INVALID_EMAIL: 'email',
  PASSWORD_TOO_SHORT: 'newPassword',
  PASSWORD_TOO_LONG: 'newPassword',
  PASSWORD_TOO_COMMON: 'newPassword',
  PASSWORD_TOO_SIMPLE: 'newPassword',
  PASSWORD_NEEDS_LETTER: 'newPassword',
  PASSWORD_UNCHANGED: 'newPassword',
  PASSWORD_HAS_EDGE_SPACES: 'newPassword',
  PASSWORD_LOOKS_LIKE_EMAIL: 'newPassword',
  PASSWORD_LOOKS_LIKE_NAME: 'newPassword',
  AUTH_REAUTH_FAILED: 'currentPassword',
};

export function errorField(error, aliases = {}) {
  const named = error?.field || error?.data?.field;
  const code = error?.code || error?.data?.code;
  const field = named || (code ? CODE_FIELDS[code] : null);
  if (!field) return null;
  // An alias of `null` is a screen saying "I know this field and I do not show it" — the
  // message belongs in the banner there, not pointed at a box that is not on the page.
  if (Object.prototype.hasOwnProperty.call(aliases, field)) return aliases[field];
  return field;
}

export function apiErrorMessage(lang, error) {
  const dict = MESSAGES[lang] || MESSAGES.en;
  const rawCode = error?.code || error?.data?.code;
  const code = rawCode ? upgradeVariant(rawCode, error) : rawCode;
  let known = code ? dict[code] || MESSAGES.en[code] : null;

  // The numbers the server sent, dropped into the sentence this language wrote. Done here
  // rather than on the server because only the sentence knows where they belong — Hindi puts
  // the plan name before the price, Tamil after it.
  if (known && known.includes('{')) {
    const d = { ...(error?.data || {}), ...(error || {}) };
    known = known
      .replace('{feature}', featureLabel(lang, d.feature || d.metric))
      .replace('{plan}', d.requiredPlanName ?? '')
      .replace('{price}', d.priceMonthly ?? '')
      .replace('{limit}', d.limit ?? '')
      .replace('{used}', d.used ?? '')
      .replace('{newLimit}', d.upgradeLimit ?? '');
  }

  if (known) {
    const reason = error?.reason || error?.data?.reason;
    return reason ? `${known}: ${reason}` : known;
  }

  if (error?.message && !isNetworkFailure(error)) return error.message;
  if (isNetworkFailure(error)) return dict.NETWORK;
  return dict.GENERIC;
}

/**
 * `fetch` rejects with a bare TypeError when the request never reached the server — the
 * backend is down, the phone dropped off Wi-Fi, CORS refused it. Its message ("Failed to
 * fetch", "NetworkError when attempting to fetch resource") is browser-internal English
 * that means nothing to a shopkeeper, so it is replaced rather than shown.
 */
function isNetworkFailure(error) {
  if (!error) return false;
  if (error.status) return false; // a real HTTP response came back
  const text = String(error.message || '').toLowerCase();
  return error instanceof TypeError || text.includes('fetch') || text.includes('network');
}

/** A standalone lookup, for showing one of these sentences without an error object. */
export function errorText(lang, code) {
  const dict = MESSAGES[lang] || MESSAGES.en;
  return dict[code] || MESSAGES.en[code] || dict.GENERIC;
}

// Sanity net for the language list drifting: a language the dashboard offers but this file
// has no block for silently falls back to English, which is survivable but worth knowing
// about in development.
if (process.env.NODE_ENV !== 'production') {
  const missing = LANGUAGE_CODES.filter((code) => !MESSAGES[code]);
  if (missing.length) {
    console.warn(`[apiErrors] no server-error translations for: ${missing.join(', ')}`);
  }
}
