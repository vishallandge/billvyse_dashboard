// Every language the dashboard can switch into. Native labels so a shopkeeper
// recognises their own language in the dropdown. Any key missing from a
// language falls back to English (see translate()), so new languages only need
// the high-traffic chrome translated to feel localised.
export const LANGUAGES = [
    {
        code: "en",
        label: "English",
        native: "English"
    },
    {
        code: "hi",
        label: "Hindi",
        native: "हिंदी"
    },
    {
        code: "mr",
        label: "Marathi",
        native: "मराठी"
    },
    {
        code: "bn",
        label: "Bengali",
        native: "বাংলা"
    },
    {
        code: "ta",
        label: "Tamil",
        native: "தமிழ்"
    },
    {
        code: "te",
        label: "Telugu",
        native: "తెలుగు"
    },
    {
        code: "gu",
        label: "Gujarati",
        native: "ગુજરાતી"
    },
    {
        code: "kn",
        label: "Kannada",
        native: "ಕನ್ನಡ"
    },
    {
        code: "pa",
        label: "Punjabi",
        native: "ਪੰਜਾਬੀ"
    },
    {
        code: "ur",
        label: "Urdu",
        native: "اردو"
    }
];
export const LANGUAGE_CODES = LANGUAGES.map((l)=>l.code);
export const RTL_LANGS = [
    "ur"
];
