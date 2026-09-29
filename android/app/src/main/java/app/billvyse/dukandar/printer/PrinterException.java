package app.billvyse.dukandar.printer;

/** A failure with a code the JS side maps to a sentence (lib/printer/index.js errorKey). */
class PrinterException extends Exception {
    final String code;

    PrinterException(String message, String code) {
        super(message);
        this.code = code;
    }
}
