package app.billvyse.dukandar.printer;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.UUID;

/**
 * Bluetooth Classic, Serial Port Profile — the way nearly every cheap counter printer talks.
 *
 * Three ways in, tried in order, because printer firmware is inconsistent about which one
 * it answers: the secure SPP socket, the insecure one (printers with no PIN), and the
 * reflective channel-1 socket that a large share of Chinese printer modules need.
 * Connecting to a printer that is not yet paired makes Android show its own pairing
 * prompt (the PIN is almost always 0000 or 1234).
 */
@SuppressLint("MissingPermission")
class ClassicPrinterConnection implements PrinterConnection {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");

    private final BluetoothSocket socket;
    private final OutputStream out;

    private ClassicPrinterConnection(BluetoothSocket socket) throws IOException {
        this.socket = socket;
        this.out = socket.getOutputStream();
    }

    static ClassicPrinterConnection open(BluetoothDevice device) throws Exception {
        Exception last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            BluetoothSocket socket = null;
            try {
                if (attempt == 0) {
                    socket = device.createRfcommSocketToServiceRecord(SPP);
                } else if (attempt == 1) {
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
                } else {
                    Method method = device.getClass().getMethod("createRfcommSocket", int.class);
                    socket = (BluetoothSocket) method.invoke(device, 1);
                }
                socket.connect();
                return new ClassicPrinterConnection(socket);
            } catch (Exception e) {
                last = e;
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (IOException ignored) {
                        // nothing to close
                    }
                }
            }
        }
        throw new PrinterException(last != null && last.getMessage() != null ? last.getMessage() : "Could not connect", "printer-unreachable");
    }

    @Override
    public void write(byte[] data, boolean slow) throws Exception {
        int chunk = slow ? 128 : 1024;
        for (int i = 0; i < data.length; i += chunk) {
            out.write(data, i, Math.min(chunk, data.length - i));
            out.flush();
            if (slow) Thread.sleep(20);
        }
    }

    @Override
    public boolean isOpen() {
        return socket.isConnected();
    }

    @Override
    public void close() {
        try {
            out.close();
        } catch (IOException ignored) {
            // closing anyway
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // closing anyway
        }
    }
}
