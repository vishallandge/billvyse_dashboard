package app.billvyse.dukandar.printer;

/** One open line to one printer. Implementations are used from a background thread only. */
interface PrinterConnection {
    void write(byte[] data, boolean slow) throws Exception;

    boolean isOpen();

    void close();
}
