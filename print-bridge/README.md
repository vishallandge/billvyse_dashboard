# BillVyse Print Bridge

A browser is not allowed to open a raw connection to a WiFi/LAN printer. This small program
runs on the shop's computer and does it for the BillVyse website. It is only needed for
**WiFi/LAN receipt printers used from a browser**. Bluetooth and USB printers connect from
the browser directly, and the Android app reaches every kind of printer without it.

## What it does and does not do

- Listens only on `127.0.0.1:17777`, so nothing on the network can reach it.
- Answers only BillVyse's own sites (`app.billvyse.com`, `billvyse.com`, and `localhost:3001` for development).
  Add more with `BV_ALLOWED_ORIGINS=https://a.example,https://b.example`.
- Sends jobs only to private-network addresses (10.x, 172.16–31.x, 192.168.x, 169.254.x) on
  raw print ports 9100–9103.
- Has no dependencies. It is plain Node.

## For the shop

**Windows**
1. Download the zip from Settings → Printers → Add printer → WiFi, and unzip it.
2. Double-click **Start Print Bridge.bat**, and keep that window open or minimised.
3. Optional: double-click **Start with Windows.bat** so it starts on its own at every login.

**Mac**
1. Download the zip (the page picks the Mac one on a Mac), and unzip it.
2. Right-click **Start Print Bridge (Mac).command** → Open → Open. Right-click is needed only the
   first time, because the file is not from the App Store. Keep the Terminal window open.
3. Optional: System Settings → General → Login Items → add the same file.

Then in BillVyse press **Check again**. If Chrome asks to allow access to devices on the local
network, press Allow. The printers on the shop's WiFi will be listed.

## For us: building the downloads

On the VPS, after the dashboard's `git pull`:

```
bash /var/www/billvyse/dashboard/print-bridge/make-zip.sh
```

This builds both zips into `/var/www/billvyse-downloads/`, where nginx serves them at
`https://billvyse.com/downloads/…`. Each zip holds the official Node runtime from
nodejs.org (checksum-verified), `bridge.js` and a start script. Node's binaries are signed
by the OpenJS Foundation, so Windows and macOS raise fewer warnings than they would for an
unsigned exe of ours. The Mac `.command` file itself is unsigned, so the first open needs
right-click → Open.

`build-exe.js` (`npm run build:exe`) is the alternative: it builds a single-file exe on a
laptop. It is unsigned, and the zip route above is preferred.
