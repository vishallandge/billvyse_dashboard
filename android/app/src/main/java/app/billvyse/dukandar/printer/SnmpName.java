package app.billvyse.dukandar.printer;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

/**
 * Asks a network printer for its model over SNMP (UDP 161, community "public") — the name
 * its own self-test slip prints, e.g. "EPSON TM-T82III". Same request as the Print Bridge
 * (print-bridge/bridge.js). A printer that does not answer within the timeout is listed by
 * its IP instead; nothing here ever fails a scan.
 */
final class SnmpName {
    private static final int[] DEVICE_DESCR = { 1, 3, 6, 1, 2, 1, 25, 3, 2, 1, 3, 1 };
    private static final int[] SYS_DESCR = { 1, 3, 6, 1, 2, 1, 1, 1, 0 };

    private SnmpName() {}

    static String lookup(String host) {
        String name = clean(ask(host, DEVICE_DESCR));
        return name != null ? name : clean(ask(host, SYS_DESCR));
    }

    private static String clean(String raw) {
        if (raw == null) return null;
        String text = raw.split("[\\r\\n;]")[0].replaceAll("[^\\x20-\\x7e]", "").replaceAll("\\s+", " ").trim();
        if (text.length() < 2) return null;
        return text.length() > 40 ? text.substring(0, 39) + "…" : text;
    }

    private static String ask(String host, int[] oid) {
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(700);
            byte[] request = request(oid, 1 + (int) (Math.random() * 30000));
            socket.send(new DatagramPacket(request, request.length, InetAddress.getByName(host), 161));
            byte[] buffer = new byte[1500];
            DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
            socket.receive(reply);
            return value(buffer, reply.getLength());
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- BER encoding ---

    private static byte[] tlv(int tag, byte[] content) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(tag);
        int n = content.length;
        if (n < 0x80) {
            out.write(n);
        } else if (n < 0x100) {
            out.write(0x81);
            out.write(n);
        } else {
            out.write(0x82);
            out.write(n >> 8);
            out.write(n & 0xff);
        }
        out.write(content, 0, n);
        return out.toByteArray();
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) out.write(part, 0, part.length);
        return out.toByteArray();
    }

    private static byte[] encodeOid(int[] oid) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(40 * oid[0] + oid[1]);
        for (int i = 2; i < oid.length; i++) {
            int part = oid[i];
            if (part >= 0x80) out.write(((part >> 7) & 0x7f) | 0x80);
            out.write(part & 0x7f);
        }
        return out.toByteArray();
    }

    private static byte[] request(int[] oid, int id) {
        byte[] varbind = tlv(0x30, concat(tlv(0x06, encodeOid(oid)), new byte[] { 0x05, 0x00 }));
        byte[] pdu = tlv(0xa0, concat(
            tlv(0x02, new byte[] { (byte) ((id >> 8) & 0x7f), (byte) (id & 0xff) }),
            tlv(0x02, new byte[] { 0 }),
            tlv(0x02, new byte[] { 0 }),
            tlv(0x30, varbind)
        ));
        return tlv(0x30, concat(
            tlv(0x02, new byte[] { 1 }), // SNMP v2c
            tlv(0x04, "public".getBytes(StandardCharsets.US_ASCII)),
            pdu
        ));
    }

    // ---------------------------------------------------------------- BER decoding ---

    /** [tag, contentStart, contentEnd] of the TLV at offset. */
    private static int[] read(byte[] buf, int offset) {
        int tag = buf[offset] & 0xff;
        int len = buf[offset + 1] & 0xff;
        int start = offset + 2;
        if ((len & 0x80) != 0) {
            int count = len & 0x7f;
            len = 0;
            for (int i = 0; i < count; i++) len = (len << 8) | (buf[start + i] & 0xff);
            start += count;
        }
        return new int[] { tag, start, start + len };
    }

    private static String value(byte[] buf, int length) {
        try {
            int[] msg = read(buf, 0);
            int at = msg[1];
            at = read(buf, at)[2]; // version
            at = read(buf, at)[2]; // community
            int[] pdu = read(buf, at);
            at = pdu[1];
            at = read(buf, at)[2]; // request id
            int[] status = read(buf, at);
            if (buf[status[1]] != 0) return null;
            at = status[2];
            at = read(buf, at)[2]; // error index
            int[] list = read(buf, at);
            int[] varbind = read(buf, list[1]);
            int[] oid = read(buf, varbind[1]);
            int[] val = read(buf, oid[2]);
            if (val[0] != 0x04 || val[2] > length) return null;
            return new String(buf, val[1], val[2] - val[1], StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
