package app.billvyse.dukandar.printer;

import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import java.io.IOException;

/** A USB printer on an OTG cable: find the bulk OUT endpoint and push bytes down it. */
class UsbPrinterConnection implements PrinterConnection {
    private final UsbDeviceConnection connection;
    private final UsbInterface usbInterface;
    private final UsbEndpoint endpoint;
    private volatile boolean open = true;

    private UsbPrinterConnection(UsbDeviceConnection connection, UsbInterface usbInterface, UsbEndpoint endpoint) {
        this.connection = connection;
        this.usbInterface = usbInterface;
        this.endpoint = endpoint;
    }

    static boolean isPrinterClass(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            if (device.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return true;
        }
        return false;
    }

    /** The interface + endpoint to write to; a printer-class interface wins over a vendor one. */
    static Object[] findBulkOut(UsbDevice device) {
        Object[] best = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface candidate = device.getInterface(i);
            for (int e = 0; e < candidate.getEndpointCount(); e++) {
                UsbEndpoint ep = candidate.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    if (best == null || candidate.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) {
                        best = new Object[] { candidate, ep };
                    }
                }
            }
        }
        return best;
    }

    static UsbPrinterConnection open(UsbManager manager, UsbDevice device) throws Exception {
        Object[] target = findBulkOut(device);
        if (target == null) throw new PrinterException("Not a printer", "unsupported-printer");
        UsbDeviceConnection connection = manager.openDevice(device);
        if (connection == null) throw new PrinterException("Could not open USB device", "printer-unreachable");
        UsbInterface usbInterface = (UsbInterface) target[0];
        if (!connection.claimInterface(usbInterface, true)) {
            connection.close();
            throw new PrinterException("USB printer is busy", "usb-busy");
        }
        return new UsbPrinterConnection(connection, usbInterface, (UsbEndpoint) target[1]);
    }

    @Override
    public void write(byte[] data, boolean slow) throws Exception {
        int chunk = slow ? 512 : 16384;
        for (int i = 0; i < data.length; i += chunk) {
            int length = Math.min(chunk, data.length - i);
            int sent = connection.bulkTransfer(endpoint, data, i, length, 10000);
            if (sent < 0) {
                open = false;
                throw new IOException("USB write failed");
            }
        }
    }

    @Override
    public boolean isOpen() {
        return open;
    }

    @Override
    public void close() {
        open = false;
        try {
            connection.releaseInterface(usbInterface);
        } catch (Exception ignored) {
            // unplugged
        }
        connection.close();
    }
}
