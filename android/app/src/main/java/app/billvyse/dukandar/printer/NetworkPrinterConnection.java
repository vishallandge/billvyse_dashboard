package app.billvyse.dukandar.printer;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * A WiFi/LAN printer on its raw port (9100).
 *
 * A socket per job rather than one held open: network printers drop idle connections
 * after a minute or two, and a held socket that died silently turns the next bill into a
 * timeout. "Connected" here means "answered when we last knocked".
 */
class NetworkPrinterConnection implements PrinterConnection {
    private final String host;
    private final int port;
    private volatile boolean open = true;

    private NetworkPrinterConnection(String host, int port) {
        this.host = host;
        this.port = port;
    }

    static NetworkPrinterConnection open(String host, int port) throws Exception {
        try (Socket probe = new Socket()) {
            probe.connect(new InetSocketAddress(host, port), 4000);
        } catch (Exception e) {
            throw new PrinterException("Printer did not answer at " + host + ":" + port, "printer-unreachable");
        }
        return new NetworkPrinterConnection(host, port);
    }

    @Override
    public void write(byte[] data, boolean slow) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 5000);
            socket.setSoTimeout(15000);
            OutputStream out = socket.getOutputStream();
            int chunk = slow ? 1024 : 16384;
            for (int i = 0; i < data.length; i += chunk) {
                out.write(data, i, Math.min(chunk, data.length - i));
                if (slow) Thread.sleep(15);
            }
            out.flush();
            socket.shutdownOutput();
        } catch (Exception e) {
            open = false;
            throw e;
        }
    }

    @Override
    public boolean isOpen() {
        return open;
    }

    @Override
    public void close() {
        open = false;
    }
}
