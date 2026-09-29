package app.billvyse.dukandar.printer;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.os.Build;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Bluetooth Low Energy printers.
 *
 * BLE has no "serial port"; each printer exposes a writable characteristic under a
 * vendor-chosen service. The known services are tried first, then any writable
 * characteristic at all. Writes are strictly one at a time — Android drops a write issued
 * before the previous one was acknowledged, which is what makes BLE printing "randomly"
 * lose half a receipt in naive implementations.
 */
@SuppressLint("MissingPermission")
class BlePrinterConnection extends BluetoothGattCallback implements PrinterConnection {
    private static final List<UUID> KNOWN_SERVICES = Arrays.asList(
        UUID.fromString("000018f0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("e7810a71-73ae-499d-8c15-faa9aef0c3f2"),
        UUID.fromString("49535343-fe7d-4ae5-8fa9-9fafd205e455"),
        UUID.fromString("0000ff00-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000fee7-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000ae30-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000ae00-0000-1000-8000-00805f9b34fb")
    );

    private final Runnable onDrop;
    private final CountDownLatch ready = new CountDownLatch(1);
    private volatile BluetoothGatt gatt;
    private volatile BluetoothGattCharacteristic target;
    private volatile int mtu = 23;
    private volatile boolean open = false;
    private volatile CountDownLatch writeDone;
    private volatile int writeStatus;

    private BlePrinterConnection(Runnable onDrop) {
        this.onDrop = onDrop;
    }

    static BlePrinterConnection open(Context context, BluetoothDevice device, Runnable onDrop) throws Exception {
        BlePrinterConnection connection = new BlePrinterConnection(onDrop);
        connection.gatt = device.connectGatt(context, false, connection, BluetoothDevice.TRANSPORT_LE);
        if (!connection.ready.await(15, TimeUnit.SECONDS) || connection.target == null) {
            connection.close();
            throw new PrinterException("BLE printer did not respond", "printer-unreachable");
        }
        connection.open = true;
        return connection;
    }

    @Override
    public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
            g.discoverServices();
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
            boolean wasOpen = open;
            open = false;
            ready.countDown();
            CountDownLatch pending = writeDone;
            if (pending != null) {
                writeStatus = -1;
                pending.countDown();
            }
            try {
                g.close();
            } catch (Exception ignored) {
                // closing anyway
            }
            if (wasOpen && onDrop != null) onDrop.run();
        }
    }

    @Override
    public void onServicesDiscovered(BluetoothGatt g, int status) {
        target = pickCharacteristic(g);
        if (target == null) {
            ready.countDown();
            return;
        }
        // Bigger packets make a receipt print in one second instead of eight. Not every
        // printer agrees; if the request is refused the default 23-byte MTU stands.
        if (!g.requestMtu(247)) ready.countDown();
    }

    @Override
    public void onMtuChanged(BluetoothGatt g, int newMtu, int status) {
        if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu;
        ready.countDown();
    }

    @Override
    public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic characteristic, int status) {
        writeStatus = status;
        CountDownLatch pending = writeDone;
        if (pending != null) pending.countDown();
    }

    private static boolean writable(BluetoothGattCharacteristic c) {
        int p = c.getProperties();
        return (p & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
    }

    private static BluetoothGattCharacteristic pickCharacteristic(BluetoothGatt g) {
        for (UUID uuid : KNOWN_SERVICES) {
            BluetoothGattService service = g.getService(uuid);
            if (service == null) continue;
            for (BluetoothGattCharacteristic c : service.getCharacteristics()) {
                if (writable(c)) return c;
            }
        }
        for (BluetoothGattService service : g.getServices()) {
            for (BluetoothGattCharacteristic c : service.getCharacteristics()) {
                if (writable(c)) return c;
            }
        }
        return null;
    }

    @Override
    public void write(byte[] data, boolean slow) throws Exception {
        BluetoothGatt g = gatt;
        BluetoothGattCharacteristic c = target;
        if (g == null || c == null || !open) throw new IOException("BLE printer not connected");
        boolean withResponse = (c.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
        int writeType = withResponse ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        int chunk = slow ? 20 : Math.max(20, mtu - 3);
        for (int i = 0; i < data.length; i += chunk) {
            byte[] part = Arrays.copyOfRange(data, i, Math.min(data.length, i + chunk));
            writeOne(g, c, part, writeType);
            if (slow || !withResponse) Thread.sleep(slow ? 20 : 4);
        }
    }

    @SuppressWarnings("deprecation")
    private void writeOne(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] part, int writeType) throws Exception {
        for (int attempt = 0; attempt < 50; attempt++) {
            CountDownLatch done = new CountDownLatch(1);
            writeDone = done;
            boolean issued;
            if (Build.VERSION.SDK_INT >= 33) {
                issued = g.writeCharacteristic(c, part, writeType) == BluetoothGatt.GATT_SUCCESS;
            } else {
                c.setWriteType(writeType);
                c.setValue(part);
                issued = g.writeCharacteristic(c);
            }
            if (!issued) {
                // The stack is still busy with the previous packet; give it a moment.
                Thread.sleep(10);
                continue;
            }
            if (!done.await(5, TimeUnit.SECONDS)) throw new IOException("BLE write timed out");
            if (writeStatus != BluetoothGatt.GATT_SUCCESS) throw new IOException("BLE write failed: " + writeStatus);
            return;
        }
        throw new IOException("BLE printer busy");
    }

    @Override
    public boolean isOpen() {
        return open;
    }

    @Override
    public void close() {
        open = false;
        BluetoothGatt g = gatt;
        gatt = null;
        if (g != null) {
            try {
                g.disconnect();
                g.close();
            } catch (Exception ignored) {
                // gone already
            }
        }
    }
}
