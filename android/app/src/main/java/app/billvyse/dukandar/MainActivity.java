package app.billvyse.dukandar;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.billvyse.dukandar.printer.PrinterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts in super.onCreate().
        registerPlugin(PrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
