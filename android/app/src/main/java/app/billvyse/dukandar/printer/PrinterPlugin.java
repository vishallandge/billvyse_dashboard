package app.billvyse.dukandar.printer;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * Printers for the Android app.
 *
 * Android's WebView has no Web Bluetooth, WebUSB or Web Serial, so without this the app
 * could not reach a single printer directly — and `window.print()` is a silent no-op in a
 * WebView too. This plugin covers all of it:
 *
 *   bt   Bluetooth Classic (SPP). What most cheap 58/80mm counter printers actually are.
 *   ble  Bluetooth Low Energy. The newer "BLE only" printers.
 *   usb  USB printers over an OTG cable.
 *   net  WiFi / LAN printers on port 9100 (the raw-print port every network POS printer opens).
 *
 * The JS side (lib/printer/nativeTransport.js) builds the print bytes; this file only finds
 * devices, keeps connections, writes bytes and reports drops. Plus `printWebView`, which
 * hands the page to Android's own print screen for everything that is not a POS printer.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "BillVysePrinter",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = { "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT" }
        )
    }
)
public class PrinterPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "app.billvyse.dukandar.USB_PRINTER_PERMISSION";
    private static final long SCAN_MS = 12000;
    private static final Pattern LIKELY_PRINTER = Pattern.compile(
        "(?i).*(print|pos|mtp|rpp|xp-|pt-?\\d|tp-?\\d|thermal|receipt|inner|zjiang|goojprt|bluetooth printer|rugtek|tvs|retsol|everycom|epson|tm-|star|bixolon|sunmi|label|tsc).*"
    );

    private final Map<String, PrinterConnection> connections = new ConcurrentHashMap<>();
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());

    private BluetoothAdapter adapter;
    private UsbManager usbManager;

    // Scan state
    private final AtomicBoolean scanning = new AtomicBoolean(false);
    private final Set<String> seen = ConcurrentHashMap.newKeySet();
    private BroadcastReceiver discoveryReceiver;
    private ScanCallback bleCallback;
    private ExecutorService netScanPool;
    private final Runnable scanTimeout = this::finishScan;

    // USB permission handshake
    private final Map<String, CountDownLatch> usbPermissionWaits = new ConcurrentHashMap<>();
    private final Map<String, Boolean> usbPermissionResults = new ConcurrentHashMap<>();
    private BroadcastReceiver systemReceiver;

    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = bm != null ? bm.getAdapter() : null;
        usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);

        // Drops: a Bluetooth link going away, a USB cable pulled, and our own USB grant.
        systemReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) dropped(device.getAddress());
                } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    if (device != null) dropped(usbAddress(device));
                } else if (ACTION_USB_PERMISSION.equals(action)) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    if (device == null) return;
                    String key = usbAddress(device);
                    usbPermissionResults.put(key, intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
                    CountDownLatch wait = usbPermissionWaits.remove(key);
                    if (wait != null) wait.countDown();
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        filter.addAction(ACTION_USB_PERMISSION);
        ContextCompat.registerReceiver(getContext(), systemReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        finishScan();
        for (PrinterConnection connection : connections.values()) connection.close();
        connections.clear();
        try {
            getContext().unregisterReceiver(systemReceiver);
        } catch (Exception ignored) {
            // never registered
        }
        io.shutdownNow();
    }

    // ------------------------------------------------------------------ capability ---

    private boolean needsRuntimeBluetoothPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private boolean bluetoothPermitted() {
        return !needsRuntimeBluetoothPermission() || getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void getSupport(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSObject out = new JSObject();
        out.put("bluetooth", adapter != null);
        out.put("bluetoothOn", adapter != null && bluetoothPermittedSafeEnabled());
        out.put("bluetoothPermission", bluetoothPermitted());
        out.put("ble", pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE));
        out.put("usb", pm.hasSystemFeature(PackageManager.FEATURE_USB_HOST));
        out.put("network", true);
        out.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(out);
    }

    private boolean bluetoothPermittedSafeEnabled() {
        try {
            return adapter.isEnabled();
        } catch (SecurityException e) {
            return false;
        }
    }

    @PluginMethod
    public void requestBluetooth(PluginCall call) {
        if (adapter == null) {
            call.reject("This phone has no Bluetooth", "no-bluetooth");
            return;
        }
        if (bluetoothPermitted()) {
            resolveBluetoothState(call);
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult");
    }

    @PermissionCallback
    private void bluetoothPermissionResult(PluginCall call) {
        if (!bluetoothPermitted()) {
            call.reject("Bluetooth permission denied", "permission");
            return;
        }
        resolveBluetoothState(call);
    }

    private void resolveBluetoothState(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", true);
        out.put("on", bluetoothPermittedSafeEnabled());
        call.resolve(out);
    }

    /** Android's own "Turn on Bluetooth?" prompt. */
    @PluginMethod
    public void enableBluetooth(PluginCall call) {
        if (adapter == null || !bluetoothPermitted()) {
            call.reject("Bluetooth unavailable", "permission");
            return;
        }
        try {
            Intent intent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "bt-off");
        }
    }

    /** For pairing a printer that needs a PIN, and for old phones that cannot scan. */
    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /**
     * After two refusals Android stops showing the permission prompt for good; the only
     * way back is this app's page in system settings.
     */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(android.net.Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ------------------------------------------------------------------------ scan ---

    /**
     * Starts scanning the asked kinds and resolves at once with what could NOT be scanned
     * (Bluetooth off, permission missing). Devices arrive as `deviceFound` events;
     * `scanDone` fires after SCAN_MS or on stopScan.
     */
    @PluginMethod
    public void startScan(PluginCall call) {
        finishScan();
        JSONArray kindsArray = call.getArray("kinds", new com.getcapacitor.JSArray());
        Set<String> kinds = new HashSet<>();
        for (int i = 0; i < kindsArray.length(); i++) kinds.add(kindsArray.optString(i));

        scanning.set(true);
        seen.clear();
        JSObject out = new JSObject();

        if (kinds.contains("bt") || kinds.contains("ble")) {
            if (adapter == null) {
                out.put("bluetooth", "absent");
            } else if (!bluetoothPermitted()) {
                out.put("bluetooth", "denied");
            } else if (!bluetoothPermittedSafeEnabled()) {
                out.put("bluetooth", "off");
            } else {
                out.put("bluetooth", "ok");
                if (kinds.contains("bt")) scanClassic();
                if (kinds.contains("ble")) scanBle();
            }
        }
        if (kinds.contains("usb")) scanUsb();
        if (kinds.contains("net")) scanNetwork();

        main.postDelayed(scanTimeout, SCAN_MS);
        call.resolve(out);
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        finishScan();
        call.resolve();
    }

    private void finishScan() {
        main.removeCallbacks(scanTimeout);
        boolean wasScanning = scanning.getAndSet(false);
        if (discoveryReceiver != null) {
            try {
                getContext().unregisterReceiver(discoveryReceiver);
            } catch (Exception ignored) {
                // already gone
            }
            discoveryReceiver = null;
        }
        if (adapter != null) {
            try {
                if (adapter.isDiscovering()) adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
                // permission revoked mid-scan
            }
            if (bleCallback != null) {
                try {
                    BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
                    if (scanner != null) scanner.stopScan(bleCallback);
                } catch (Exception ignored) {
                    // adapter switched off
                }
            }
        }
        bleCallback = null;
        if (netScanPool != null) {
            netScanPool.shutdownNow();
            netScanPool = null;
        }
        if (wasScanning) notifyListeners("scanDone", new JSObject());
    }

    private void found(String kind, String address, String name, boolean paired, boolean likely) {
        if (!scanning.get() || address == null) return;
        if (!seen.add(kind + "|" + address)) return;
        JSObject device = new JSObject();
        device.put("kind", kind);
        device.put("address", address);
        device.put("name", name == null ? "" : name.trim());
        device.put("paired", paired);
        device.put("likely", likely);
        notifyListeners("deviceFound", device);
    }

    /**
     * The name the shop sees in its own phone's Bluetooth settings: the alias they gave the
     * printer (Android 11+), else the printer's own name. Never the MAC — the JS side builds a
     * readable fallback for a nameless device.
     */
    private String displayName(BluetoothDevice device) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                String alias = device.getAlias();
                if (alias != null && !alias.trim().isEmpty()) return alias;
            }
            return device.getName();
        } catch (SecurityException e) {
            return null;
        }
    }

    private boolean looksLikePrinter(BluetoothDevice device, String name) {
        try {
            BluetoothClass cls = device.getBluetoothClass();
            if (cls != null && cls.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING) return true;
        } catch (Exception ignored) {
            // no class info
        }
        return name != null && LIKELY_PRINTER.matcher(name).matches();
    }

    private void scanClassic() {
        // Paired printers first — they are listed instantly and need no discovery at all,
        // which is also the only way an Android 10/11 phone sees them without location access.
        try {
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                int type = device.getType();
                if (type == BluetoothDevice.DEVICE_TYPE_LE) continue;
                String name = displayName(device);
                found("bt", device.getAddress(), name, true, looksLikePrinter(device, name));
            }
        } catch (SecurityException ignored) {
            return;
        }
        discoveryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) return;
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device == null || device.getType() == BluetoothDevice.DEVICE_TYPE_LE) return;
                String name = displayName(device);
                if (name == null) return; // nameless classic devices are never printers worth listing
                found("bt", device.getAddress(), name, device.getBondState() == BluetoothDevice.BOND_BONDED, looksLikePrinter(device, name));
            }
        };
        ContextCompat.registerReceiver(getContext(), discoveryReceiver, new IntentFilter(BluetoothDevice.ACTION_FOUND), ContextCompat.RECEIVER_NOT_EXPORTED);
        try {
            adapter.startDiscovery();
        } catch (SecurityException ignored) {
            // bonded list above still stands
        }
    }

    private void scanBle() {
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) return;
        bleCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                String name = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
                if (name == null) {
                    try {
                        name = device.getName();
                    } catch (SecurityException ignored) {
                        // leave it null
                    }
                }
                if (name == null) return; // an unnamed BLE advert is a tag or a watch, not a printer
                found("ble", device.getAddress(), name, device.getBondState() == BluetoothDevice.BOND_BONDED, looksLikePrinter(device, name));
            }
        };
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            scanner.startScan(null, settings, bleCallback);
        } catch (Exception ignored) {
            bleCallback = null;
        }
    }

    private void scanUsb() {
        if (usbManager == null) return;
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            if (UsbPrinterConnection.findBulkOut(device) == null) continue;
            String name = device.getProductName();
            if (name == null || name.trim().isEmpty()) name = usbBrandName(device.getVendorId());
            if (name == null) name = "USB printer " + String.format("%04X:%04X", device.getVendorId(), device.getProductId());
            found("usb", usbAddress(device), name, true, UsbPrinterConnection.isPrinterClass(device));
        }
    }

    /**
     * Knocks on port 9100 of every address in this phone's /24. 48 parallel knocks with a
     * 400ms timeout covers 254 addresses in about two seconds, and a network printer is the
     * only thing on a shop's WiFi that answers on that port.
     */
    private void scanNetwork() {
        final Inet4Address self = localIpv4();
        if (self == null) return;
        final byte[] base = self.getAddress();
        netScanPool = Executors.newFixedThreadPool(48);
        final ExecutorService pool = netScanPool;
        for (int host = 1; host < 255; host++) {
            final int last = host;
            if ((base[3] & 0xff) == last) continue;
            pool.submit(() -> {
                if (!scanning.get()) return;
                String ip = (base[0] & 0xff) + "." + (base[1] & 0xff) + "." + (base[2] & 0xff) + "." + last;
                boolean open;
                try (Socket socket = new Socket()) {
                    socket.connect(new InetSocketAddress(ip, 9100), 400);
                    open = true;
                } catch (Exception ignored) {
                    open = false; // nothing there
                }
                if (open) {
                    String model = SnmpName.lookup(ip);
                    found("net", ip + ":9100", model != null ? model + " (" + ip + ")" : "Network printer " + ip, true, true);
                }
            });
        }
        pool.shutdown();
    }

    private Inet4Address localIpv4() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network network = cm.getActiveNetwork();
            LinkProperties props = network != null ? cm.getLinkProperties(network) : null;
            if (props == null) return null;
            for (LinkAddress link : props.getLinkAddresses()) {
                InetAddress address = link.getAddress();
                if (address instanceof Inet4Address && !address.isLoopbackAddress()) return (Inet4Address) address;
            }
        } catch (Exception ignored) {
            // no network
        }
        return null;
    }

    // ------------------------------------------------------------------ connection ---

    @PluginMethod
    public void connect(PluginCall call) {
        final String kind = call.getString("kind", "");
        final String address = call.getString("address", "");
        if (("bt".equals(kind) || "ble".equals(kind)) && !preflightBluetooth(call)) return;
        io.execute(() -> {
            try {
                PrinterConnection existing = connections.get(address);
                if (existing != null && existing.isOpen()) {
                    call.resolve(connected(address));
                    return;
                }
                if (existing != null) existing.close();
                // Discovery hogs the radio and makes RFCOMM connects fail; stop it first.
                if (adapter != null) {
                    try {
                        if (adapter.isDiscovering()) adapter.cancelDiscovery();
                    } catch (SecurityException ignored) {
                        // fine
                    }
                }
                PrinterConnection connection = open(kind, address);
                connections.put(address, connection);
                call.resolve(connected(address));
                emitConnection(kind, address, true);
            } catch (PrinterException e) {
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "connect failed" : e.getMessage(), "printer-unreachable");
            }
        });
    }

    private boolean preflightBluetooth(PluginCall call) {
        if (adapter == null) {
            call.reject("This phone has no Bluetooth", "unsupported-here");
            return false;
        }
        if (!bluetoothPermitted()) {
            call.reject("Bluetooth permission denied", "permission");
            return false;
        }
        if (!bluetoothPermittedSafeEnabled()) {
            call.reject("Bluetooth is off", "bt-off");
            return false;
        }
        return true;
    }

    private PrinterConnection open(String kind, String address) throws Exception {
        switch (kind) {
            case "bt":
                return ClassicPrinterConnection.open(adapter.getRemoteDevice(address));
            case "ble":
                return BlePrinterConnection.open(getContext(), adapter.getRemoteDevice(address), () -> dropped(address));
            case "net": {
                String[] parts = address.split(":");
                int port;
                try {
                    port = parts.length > 1 ? Integer.parseInt(parts[1]) : 9100;
                } catch (NumberFormatException e) {
                    throw new PrinterException("Bad printer address", "unsupported-here");
                }
                // Same rule as the Print Bridge: a shop printer on the shop's own network, on a
                // raw print port — never an arbitrary host on the internet.
                if (!isPrivateIpv4(parts[0]) || port < 9100 || port > 9103) {
                    throw new PrinterException("Only printers on the local network", "unsupported-here");
                }
                return NetworkPrinterConnection.open(parts[0], port);
            }
            case "usb":
                return openUsb(address);
            default:
                throw new PrinterException("Unknown printer type", "unsupported-here");
        }
    }

    private PrinterConnection openUsb(String address) throws Exception {
        if (usbManager == null) throw new PrinterException("No USB host", "unsupported-here");
        UsbDevice target = null;
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            if (usbAddress(device).equals(address)) {
                target = device;
                break;
            }
        }
        if (target == null) throw new PrinterException("USB printer not plugged in", "printer-unreachable");
        if (!usbManager.hasPermission(target)) {
            CountDownLatch wait = new CountDownLatch(1);
            usbPermissionWaits.put(address, wait);
            usbPermissionResults.remove(address);
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
            Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(getContext().getPackageName());
            PendingIntent pending = PendingIntent.getBroadcast(getContext(), 0, intent, flags);
            usbManager.requestPermission(target, pending);
            wait.await(90, TimeUnit.SECONDS);
            Boolean granted = usbPermissionResults.remove(address);
            if (granted == null || !granted) throw new PrinterException("USB permission denied", "permission");
        }
        return UsbPrinterConnection.open(usbManager, target);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        final String address = call.getString("address", "");
        final String kind = call.getString("kind", "");
        PrinterConnection connection = connections.remove(address);
        if (connection != null) {
            io.execute(connection::close);
            emitConnection(kind, address, false);
        }
        call.resolve();
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        PrinterConnection connection = connections.get(call.getString("address", ""));
        JSObject out = new JSObject();
        out.put("connected", connection != null && connection.isOpen());
        call.resolve(out);
    }

    @PluginMethod
    public void write(PluginCall call) {
        final String address = call.getString("address", "");
        final String kind = call.getString("kind", "");
        final String data = call.getString("data", "");
        final boolean slow = Boolean.TRUE.equals(call.getBoolean("slow", false));
        io.execute(() -> {
            PrinterConnection connection = connections.get(address);
            try {
                if (connection == null || !connection.isOpen()) {
                    if (("bt".equals(kind) || "ble".equals(kind)) && (adapter == null || !bluetoothPermitted() || !bluetoothPermittedSafeEnabled())) {
                        throw new PrinterException("Bluetooth is off", "bt-off");
                    }
                    connection = open(kind, address);
                    connections.put(address, connection);
                    emitConnection(kind, address, true);
                }
                connection.write(Base64.decode(data, Base64.DEFAULT), slow);
                call.resolve();
            } catch (PrinterException e) {
                call.reject(e.getMessage(), e.code);
            } catch (Exception e) {
                if (connection != null) connection.close();
                connections.remove(address);
                emitConnection(kind, address, false);
                call.reject(e.getMessage() == null ? "write failed" : e.getMessage(), "printer-unreachable");
            }
        });
    }

    private void dropped(String address) {
        PrinterConnection connection = connections.remove(address);
        if (connection == null) return;
        io.execute(connection::close);
        emitConnection(null, address, false);
    }

    private JSObject connected(String address) {
        JSObject out = new JSObject();
        out.put("connected", true);
        out.put("address", address);
        return out;
    }

    private void emitConnection(String kind, String address, boolean isConnected) {
        JSObject event = new JSObject();
        event.put("kind", kind);
        event.put("address", address);
        event.put("connected", isConnected);
        notifyListeners("connection", event);
    }

    /** Same vendor list as dashboard/lib/printer/vendors.js — change the two together. */
    static String usbBrandName(int vendorId) {
        switch (vendorId) {
            case 0x04b8: return "Epson printer (USB)";
            case 0x0519: return "Star printer (USB)";
            case 0x1504: return "Bixolon printer (USB)";
            case 0x1d90: return "Citizen printer (USB)";
            case 0x154f: return "SNBC printer (USB)";
            case 0x0a5f: return "Zebra printer (USB)";
            case 0x1203: return "TSC printer (USB)";
            case 0x0416: case 0x0483: case 0x1fc9: case 0x28e9: case 0x0fe6: case 0x6868:
                return "POS printer (USB)";
            case 0x1a86: case 0x067b: case 0x0403: case 0x10c4:
                return "Serial printer (USB adapter)";
            default:
                return null;
        }
    }

    static boolean isPrivateIpv4(String host) {
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int[] n = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                if (!parts[i].matches("\\d{1,3}")) return false;
                n[i] = Integer.parseInt(parts[i]);
                if (n[i] > 255) return false;
            }
        } catch (NumberFormatException e) {
            return false;
        }
        return n[0] == 10 || (n[0] == 172 && n[1] >= 16 && n[1] <= 31) || (n[0] == 192 && n[1] == 168) || (n[0] == 169 && n[1] == 254);
    }

    /** The model of a network printer typed in by IP (the scan already does this itself). */
    @PluginMethod
    public void networkName(PluginCall call) {
        final String host = call.getString("host", "");
        if (!isPrivateIpv4(host)) {
            call.resolve(new JSObject());
            return;
        }
        io.execute(() -> {
            JSObject out = new JSObject();
            String name = SnmpName.lookup(host);
            if (name != null) out.put("name", name);
            call.resolve(out);
        });
    }

    static String usbAddress(UsbDevice device) {
        return String.format("%04x:%04x", device.getVendorId(), device.getProductId());
    }

    // -------------------------------------------------------------- system printing ---

    /**
     * Android's print screen for the current page. Resolves once the job is queued or the
     * person backs out — the JS side fires `afterprint` then, and not before, because the
     * page is still being rendered for the printer while that screen is open.
     */
    @PluginMethod
    public void printWebView(PluginCall call) {
        final String name = call.getString("name", "BillVyse");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter(name);
                PrintJob job = printManager.print(name, printAdapter, new PrintAttributes.Builder().build());
                watchJob(job, call, System.currentTimeMillis());
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "print failed" : e.getMessage());
            }
        });
    }

    private void watchJob(PrintJob job, PluginCall call, long startedAt) {
        boolean settled = job.isQueued() || job.isStarted() || job.isCompleted()
            || job.isCancelled() || job.isFailed() || job.isBlocked();
        boolean tooLong = System.currentTimeMillis() - startedAt > 15 * 60 * 1000;
        if (settled || tooLong) {
            JSObject out = new JSObject();
            out.put("cancelled", job.isCancelled());
            call.resolve(out);
            return;
        }
        main.postDelayed(() -> watchJob(job, call, startedAt), 600);
    }
}
