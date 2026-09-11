package fit.linky.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.os.SystemClock;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "LinkyBluetooth", permissions = {
    @Permission(alias = "bluetooth", strings = {
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT
    }),
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
})
@SuppressLint("MissingPermission")
@SuppressWarnings("deprecation")
public class LinkyBluetoothPlugin extends Plugin {
    private static final UUID SERVICE = UUID.fromString("F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C");
    private static final UUID MESH = UUID.fromString("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D");
    private static final UUID IDENTITY = UUID.fromString("75B7A4D1-6620-4B5C-92C3-4EB8D918D097");
    private static final UUID CCC = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");
    private static final int MAX_PEERS = 8;
    private static final int MAX_QUEUE = 128;
    private static final long TIMEOUT_MS = 15000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, Peer> peers = new HashMap<>();
    private final LinkedHashMap<String, Long> retryAfter = new LinkedHashMap<>();
    private final ArrayDeque<Notification> notifications = new ArrayDeque<>();
    private BluetoothAdapter adapter;
    private BluetoothManager manager;
    private BluetoothGattServer server;
    private BluetoothLeScanner scanner;
    private BluetoothLeAdvertiser advertiser;
    private ScanCallback scanCallback;
    private AdvertiseCallback advertiseCallback;
    private BluetoothGattCharacteristic meshCharacteristic;
    private BluetoothGattCharacteristic identityCharacteristic;
    private Notification sendingNotification;
    private PluginCall pendingStart;
    private boolean foreground;
    private boolean running;
    private boolean active;
    private long generation;
    private long notificationStartedAt;

    private static final class Peer {
        final String id = UUID.randomUUID().toString();
        final BluetoothDevice device;
        final boolean central;
        final ArrayDeque<Write> writes = new ArrayDeque<>();
        final ArrayDeque<Incoming> incoming = new ArrayDeque<>();
        BluetoothGatt gatt;
        BluetoothGattCharacteristic mesh;
        BluetoothGattCharacteristic identity;
        boolean meshSubscribed;
        boolean identitySubscribed;
        boolean ready;
        boolean waitingForActivation;
        int maxPacketSize = 20;
        long operationStartedAt = SystemClock.elapsedRealtime();
        boolean writing;

        Peer(BluetoothDevice device, boolean central) {
            this.device = device;
            this.central = central;
        }
    }

    private static final class Write {
        final BluetoothGattCharacteristic characteristic;
        final byte[] data;

        Write(BluetoothGattCharacteristic characteristic, byte[] data) {
            this.characteristic = characteristic;
            this.data = data;
        }
    }

    private static final class Incoming {
        final UUID characteristic;
        final byte[] data;

        Incoming(UUID characteristic, byte[] data) {
            this.characteristic = characteristic;
            this.data = data;
        }
    }

    private static final class Notification {
        final Peer peer;
        final BluetoothGattCharacteristic characteristic;
        final byte[] data;

        Notification(Peer peer, BluetoothGattCharacteristic characteristic, byte[] data) {
            this.peer = peer;
            this.characteristic = characteristic;
            this.data = data;
        }
    }

    private final BroadcastReceiver adapterReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            handler.post(() -> {
                if (!powered()) stopRadio("Bluetooth was switched off.");
                emitState();
            });
        }
    };

    @Override
    public void load() {
        manager = getContext().getSystemService(BluetoothManager.class);
        adapter = manager == null ? null : manager.getAdapter();
        foreground = MainActivity.isAppInForeground();
        ContextCompat.registerReceiver(getContext(), adapterReceiver,
            new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnResume() {
        handler.post(() -> {
            foreground = true;
            emitState();
        });
    }

    @Override
    protected void handleOnPause() {
        handler.post(() -> {
            foreground = false;
            stopRadio("Bluetooth chat paused while Linky is in the background.");
            emitState();
        });
    }

    @Override
    protected void handleOnDestroy() {
        handler.post(() -> {
            foreground = false;
            stopRadio("Bluetooth chat closed.");
            getContext().unregisterReceiver(adapterReceiver);
        });
    }

    private boolean supported() {
        return adapter != null && getContext().getPackageManager()
            .hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
    }

    private String[] requiredPermissions() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new String[] { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT }
            : new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
    }

    private boolean permitted() {
        for (String permission : requiredPermissions()) {
            if (ContextCompat.checkSelfPermission(getContext(), permission) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    private boolean powered() {
        try {
            return adapter != null && adapter.isEnabled();
        } catch (SecurityException error) {
            return false;
        }
    }

    private boolean locationEnabled() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return true;
        LocationManager location = getContext().getSystemService(LocationManager.class);
        return location != null && (location.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
    }

    private JSObject state() {
        boolean requested = getContext().getSharedPreferences("linky.bluetooth", Context.MODE_PRIVATE)
            .getBoolean("permissionRequested", false);
        JSObject state = new JSObject();
        state.put("supported", supported());
        state.put("permission", permitted() ? "granted" : requested ? "denied" : "prompt");
        state.put("powered", powered());
        state.put("active", active);
        return state;
    }

    private void emitState() {
        notifyListeners("state", state());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        handler.post(() -> {
            if (running && (!permitted() || !powered())) stopRadio("Bluetooth is unavailable.");
            call.resolve(state());
        });
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        handler.post(() -> {
            if (!supported() || permitted()) {
                call.resolve(state());
                return;
            }
            getContext().getSharedPreferences("linky.bluetooth", Context.MODE_PRIVATE).edit()
                .putBoolean("permissionRequested", true).apply();
            requestPermissionForAlias(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "location",
                call, "permissionsResult");
        });
    }

    @PermissionCallback
    private void permissionsResult(PluginCall call) {
        handler.post(() -> {
            emitState();
            call.resolve(state());
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        handler.post(() -> {
            if (active) {
                call.resolve(state());
                return;
            }
            if (running) {
                call.reject("Bluetooth chat is already starting.");
                return;
            }
            if (!supported() || !permitted() || !powered() || !foreground) {
                call.reject("Bluetooth chat requires permission, Bluetooth enabled, and Linky in the foreground.");
                return;
            }
            if (!locationEnabled()) {
                call.reject("Enable system Location to discover Bluetooth devices on this Android version.");
                return;
            }
            try {
                advertiser = adapter.getBluetoothLeAdvertiser();
                scanner = adapter.getBluetoothLeScanner();
                if (advertiser == null || scanner == null) {
                    call.reject("This device does not support Bluetooth LE advertising and scanning.");
                    return;
                }
                running = true;
                pendingStart = call;
                long session = ++generation;
                meshCharacteristic = characteristic(MESH);
                identityCharacteristic = characteristic(IDENTITY);
                BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
                service.addCharacteristic(meshCharacteristic);
                service.addCharacteristic(identityCharacteristic);
                server = manager.openGattServer(getContext(), serverCallback(session));
                if (server == null || !server.addService(service)) {
                    fail("Could not create the Bluetooth chat service.");
                    return;
                }
                handler.postDelayed(() -> {
                    if (generation == session && pendingStart != null) fail("Bluetooth chat startup timed out.");
                }, TIMEOUT_MS);
                checkHealth(session);
            } catch (RuntimeException error) {
                fail("Could not start Bluetooth chat: " + error.getMessage());
            }
        });
    }

    private BluetoothGattCharacteristic characteristic(UUID uuid) {
        BluetoothGattCharacteristic characteristic = new BluetoothGattCharacteristic(uuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
                | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE);
        characteristic.addDescriptor(new BluetoothGattDescriptor(CCC,
            BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE));
        return characteristic;
    }

    private void startDiscovery(long session) {
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                handler.post(() -> {
                    if (running && generation == session) connect(result.getDevice());
                });
            }

            @Override
            public void onScanFailed(int errorCode) {
                handler.post(() -> {
                    if (generation == session) fail("Bluetooth scanning failed (" + errorCode + ").");
                });
            }
        };
        advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settings) {
                handler.post(() -> {
                    if (!running || generation != session) return;
                    active = true;
                    emitState();
                    if (pendingStart != null) {
                        pendingStart.resolve(state());
                        pendingStart = null;
                    }
                    for (Peer peer : peers.values()) {
                        if (peer.waitingForActivation) ready(peer);
                    }
                });
            }

            @Override
            public void onStartFailure(int errorCode) {
                handler.post(() -> {
                    if (generation == session) fail("Bluetooth advertising failed (" + errorCode + ").");
                });
            }
        };
        try {
            scanner.startScan(Collections.singletonList(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build()),
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            advertiser.startAdvertising(new AdvertiseSettings.Builder().setConnectable(true)
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).build(),
                new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(SERVICE)).setIncludeDeviceName(false).build(),
                advertiseCallback);
        } catch (RuntimeException error) {
            fail("Could not start Bluetooth discovery: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        handler.post(() -> {
            stopRadio("Bluetooth chat stopped.");
            emitState();
            call.resolve(state());
        });
    }

    private void stopRadio(String reason) {
        running = false;
        active = false;
        generation++;
        if (pendingStart != null) {
            pendingStart.reject(reason);
            pendingStart = null;
        }
        try {
            if (scanner != null && scanCallback != null) scanner.stopScan(scanCallback);
        } catch (RuntimeException ignored) { }
        try {
            if (advertiser != null && advertiseCallback != null) advertiser.stopAdvertising(advertiseCallback);
        } catch (RuntimeException ignored) { }
        scanCallback = null;
        advertiseCallback = null;
        for (Peer peer : new ArrayList<>(peers.values())) disconnect(peer);
        notifications.clear();
        sendingNotification = null;
        try {
            if (server != null) server.close();
        } catch (RuntimeException ignored) { }
        server = null;
        retryAfter.clear();
    }

    private void fail(String message) {
        stopRadio(message);
        emitState();
        emitError(message);
    }

    private void emitError(String message) {
        JSObject event = new JSObject();
        event.put("message", message);
        notifyListeners("error", event);
    }

    private Peer findPeer(BluetoothDevice device, boolean central) {
        for (Peer peer : peers.values()) {
            if (peer.central == central && peer.device.equals(device)) return peer;
        }
        return null;
    }

    private void connect(BluetoothDevice device) {
        if (peers.size() >= MAX_PEERS || findPeer(device, true) != null) return;
        int centralCount = 0;
        for (Peer peer : peers.values()) if (peer.central) centralCount++;
        if (centralCount >= MAX_PEERS / 2) return;
        long now = SystemClock.elapsedRealtime();
        Long retry = retryAfter.get(device.getAddress());
        if (retry != null && now < retry) return;
        delayRetry(device);
        Peer peer = new Peer(device, true);
        peers.put(peer.id, peer);
        try {
            peer.gatt = device.connectGatt(getContext(), false, clientCallback(peer), BluetoothDevice.TRANSPORT_LE);
            if (peer.gatt == null) disconnect(peer);
        } catch (RuntimeException error) {
            disconnect(peer);
        }
    }

    private void emitPeer(Peer peer, boolean connected) {
        JSObject event = new JSObject();
        event.put("id", peer.id);
        event.put("connected", connected);
        event.put("identity", peer.identitySubscribed);
        event.put("maxPacketSize", peer.maxPacketSize);
        notifyListeners("peer", event);
    }

    private void delayRetry(BluetoothDevice device) {
        retryAfter.put(device.getAddress(), SystemClock.elapsedRealtime() + 30000);
        while (retryAfter.size() > 128) retryAfter.remove(retryAfter.keySet().iterator().next());
    }

    private void ready(Peer peer) {
        if (!active) {
            peer.waitingForActivation = true;
            return;
        }
        peer.waitingForActivation = false;
        peer.ready = true;
        peer.operationStartedAt = 0;
        emitPeer(peer, true);
        Incoming incoming;
        while ((incoming = peer.incoming.poll()) != null) emitPacket(peer, incoming.characteristic, incoming.data);
    }

    private void disconnect(Peer peer) {
        if (peers.remove(peer.id) == null) return;
        if (peer.ready) emitPeer(peer, false);
        peer.writes.clear();
        peer.incoming.clear();
        for (Iterator<Notification> iterator = notifications.iterator(); iterator.hasNext();) {
            if (iterator.next().peer == peer) iterator.remove();
        }
        try {
            if (peer.central && peer.gatt != null) {
                peer.gatt.disconnect();
                peer.gatt.close();
            } else if (server != null) {
                server.cancelConnection(peer.device);
            }
        } catch (RuntimeException ignored) { }
        if (running) {
            delayRetry(peer.device);
        }
    }

    private void emitPacket(Peer peer, UUID uuid, byte[] value) {
        if (value.length == 0 || value.length > 512) return;
        if (!MESH.equals(uuid) && !IDENTITY.equals(uuid)) return;
        if (!peer.ready) {
            if (peer.incoming.size() < 16) peer.incoming.add(new Incoming(uuid, value));
            return;
        }
        JSObject event = new JSObject();
        event.put("peerId", peer.id);
        event.put("lane", IDENTITY.equals(uuid) ? "identity" : "mesh");
        event.put("data", Base64.encodeToString(value, Base64.NO_WRAP));
        notifyListeners("packet", event);
    }

    private BluetoothGattCallback clientCallback(Peer peer) {
        return new BluetoothGattCallback() {
            private void dispatch(Runnable action) {
                handler.post(() -> {
                    if (!running || peers.get(peer.id) != peer) return;
                    try {
                        action.run();
                    } catch (RuntimeException error) {
                        disconnect(peer);
                        emitError("Bluetooth connection failed: " + error.getMessage());
                    }
                });
            }

            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                dispatch(() -> {
                    if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) {
                        disconnect(peer);
                    } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                        peer.operationStartedAt = SystemClock.elapsedRealtime();
                        if (!gatt.requestMtu(517) && !gatt.discoverServices()) disconnect(peer);
                    }
                });
            }

            @Override
            public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                dispatch(() -> {
                    if (status == BluetoothGatt.GATT_SUCCESS) peer.maxPacketSize = Math.max(20, Math.min(512, mtu - 3));
                    if (peer.ready) {
                        emitPeer(peer, true);
                    } else if (peer.mesh == null && !gatt.discoverServices()) {
                        disconnect(peer);
                    }
                });
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                dispatch(() -> {
                    BluetoothGattService service = selectChatService(gatt.getServices());
                    if (status != BluetoothGatt.GATT_SUCCESS || service == null) {
                        disconnect(peer);
                        return;
                    }
                    peer.mesh = service.getCharacteristic(MESH);
                    BluetoothGattCharacteristic identity = service.getCharacteristic(IDENTITY);
                    peer.identity = supportsChat(identity) ? identity : null;
                    if (peer.mesh == null || !subscribe(peer, peer.mesh)) disconnect(peer);
                });
            }

            @Override
            public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                dispatch(() -> {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        disconnect(peer);
                        return;
                    }
                    if (MESH.equals(descriptor.getCharacteristic().getUuid())) {
                        peer.meshSubscribed = true;
                        if (peer.identity != null && subscribe(peer, peer.identity)) return;
                    } else if (IDENTITY.equals(descriptor.getCharacteristic().getUuid())) {
                        peer.identitySubscribed = true;
                    }
                    ready(peer);
                });
            }

            @Override
            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                byte[] value = characteristic.getValue();
                if (value != null) {
                    byte[] copy = value.clone();
                    dispatch(() -> emitPacket(peer, characteristic.getUuid(), copy));
                }
            }

            @Override
            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
                byte[] copy = value.clone();
                dispatch(() -> emitPacket(peer, characteristic.getUuid(), copy));
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                dispatch(() -> {
                    if (!peer.writing) return;
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        disconnect(peer);
                        emitError("Bluetooth packet write failed (" + status + ").");
                        return;
                    }
                    peer.writing = false;
                    peer.operationStartedAt = 0;
                    peer.writes.poll();
                    drainWrites(peer);
                });
            }
        };
    }

    private boolean subscribe(Peer peer, BluetoothGattCharacteristic characteristic) {
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(CCC);
        if (descriptor == null || !peer.gatt.setCharacteristicNotification(characteristic, true)) return false;
        peer.operationStartedAt = SystemClock.elapsedRealtime();
        descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
        return peer.gatt.writeDescriptor(descriptor);
    }

    static BluetoothGattService selectChatService(List<BluetoothGattService> services) {
        BluetoothGattService meshOnly = null;
        for (BluetoothGattService service : services) {
            if (!SERVICE.equals(service.getUuid()) || !supportsChat(service.getCharacteristic(MESH))) continue;
            if (supportsChat(service.getCharacteristic(IDENTITY))) return service;
            if (meshOnly == null) meshOnly = service;
        }
        return meshOnly;
    }

    private static boolean supportsChat(BluetoothGattCharacteristic characteristic) {
        if (characteristic == null) return false;
        int properties = characteristic.getProperties();
        return (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
            && (properties & (BluetoothGattCharacteristic.PROPERTY_WRITE
                | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
    }

    private BluetoothGattServerCallback serverCallback(long session) {
        return new BluetoothGattServerCallback() {
            private void dispatch(Runnable action) {
                handler.post(() -> {
                    if (!running || generation != session || server == null) return;
                    try {
                        action.run();
                    } catch (RuntimeException error) {
                        fail("Bluetooth server failed: " + error.getMessage());
                    }
                });
            }

            @Override
            public void onServiceAdded(int status, BluetoothGattService service) {
                dispatch(() -> {
                    if (status == BluetoothGatt.GATT_SUCCESS) startDiscovery(session);
                    else fail("Could not register the Bluetooth chat service (" + status + ").");
                });
            }

            @Override
            public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
                dispatch(() -> {
                    Peer peer = findPeer(device, false);
                    if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) {
                        if (peer != null) disconnect(peer);
                    } else if (newState == BluetoothProfile.STATE_CONNECTED && peer == null) {
                        if (peers.size() >= MAX_PEERS) {
                            server.cancelConnection(device);
                            return;
                        }
                        Peer connected = new Peer(device, false);
                        peers.put(connected.id, connected);
                    }
                });
            }

            @Override
            public void onMtuChanged(BluetoothDevice device, int mtu) {
                dispatch(() -> {
                    Peer peer = findPeer(device, false);
                    if (peer == null) return;
                    peer.maxPacketSize = Math.max(20, Math.min(512, mtu - 3));
                    if (peer.ready) emitPeer(peer, true);
                });
            }

            @Override
            public void onDescriptorReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattDescriptor descriptor) {
                dispatch(() -> {
                    Peer peer = findPeer(device, false);
                    boolean identity = IDENTITY.equals(descriptor.getCharacteristic().getUuid());
                    boolean subscribed = peer != null && (identity ? peer.identitySubscribed : peer.meshSubscribed);
                    server.sendResponse(device, requestId, offset == 0 ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_INVALID_OFFSET,
                        0, subscribed ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
                });
            }

            @Override
            public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor,
                boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
                byte[] copy = value.clone();
                dispatch(() -> {
                    Peer peer = findPeer(device, false);
                    boolean enable = Arrays.equals(copy, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    boolean valid = peer != null && CCC.equals(descriptor.getUuid()) && offset == 0 && !preparedWrite
                        && (enable || Arrays.equals(copy, BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE));
                    if (responseNeeded) server.sendResponse(device, requestId,
                        valid ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null);
                    if (!valid) return;
                    if (IDENTITY.equals(descriptor.getCharacteristic().getUuid())) peer.identitySubscribed = enable;
                    else peer.meshSubscribed = enable;
                    if (peer.meshSubscribed) ready(peer);
                    else if (peer.ready || peer.waitingForActivation) disconnect(peer);
                });
            }

            @Override
            public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic characteristic,
                boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
                byte[] copy = value.clone();
                dispatch(() -> {
                    Peer peer = findPeer(device, false);
                    boolean valid = peer != null && !preparedWrite && offset == 0
                        && copy.length > 0 && copy.length <= peer.maxPacketSize;
                    if (responseNeeded) server.sendResponse(device, requestId,
                        valid ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null);
                    if (valid) emitPacket(peer, characteristic.getUuid(), copy);
                });
            }

            @Override
            public void onExecuteWrite(BluetoothDevice device, int requestId, boolean execute) {
                dispatch(() -> server.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null));
            }

            @Override
            public void onNotificationSent(BluetoothDevice device, int status) {
                dispatch(() -> {
                    if (sendingNotification == null || !sendingNotification.peer.device.equals(device)) return;
                    Peer peer = sendingNotification.peer;
                    sendingNotification = null;
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        disconnect(peer);
                        emitError("Bluetooth packet notification failed (" + status + ").");
                    }
                    drainNotifications();
                });
            }
        };
    }

    @PluginMethod
    public void send(PluginCall call) {
        String peerId = call.getString("peerId");
        String lane = call.getString("lane");
        String data = call.getString("data");
        handler.post(() -> {
            Peer peer = peers.get(peerId);
            if (!active || peer == null || !peer.ready || (!"mesh".equals(lane) && !"identity".equals(lane))
                || ("identity".equals(lane) && !peer.identitySubscribed)) {
                call.reject("Bluetooth peer or lane is unavailable.");
                return;
            }
            byte[] bytes;
            try {
                if (data == null || data.length() > 684) throw new IllegalArgumentException();
                bytes = Base64.decode(data, Base64.NO_WRAP);
                if (bytes.length == 0 || bytes.length > peer.maxPacketSize) throw new IllegalArgumentException();
            } catch (IllegalArgumentException error) {
                call.reject("Invalid Bluetooth packet or packet exceeds the negotiated MTU.");
                return;
            }
            boolean identity = "identity".equals(lane);
            if (peer.central) {
                if (peer.writes.size() >= MAX_QUEUE) {
                    call.reject("Bluetooth send queue is full.");
                    return;
                }
                peer.writes.add(new Write(identity ? peer.identity : peer.mesh, bytes));
                drainWrites(peer);
            } else {
                if (notifications.size() >= MAX_QUEUE) {
                    call.reject("Bluetooth notification queue is full.");
                    return;
                }
                notifications.add(new Notification(peer, identity ? identityCharacteristic : meshCharacteristic, bytes));
                drainNotifications();
            }
            if (peers.containsKey(peer.id)) call.resolve();
            else call.reject("Bluetooth packet could not be queued.");
        });
    }

    private void drainWrites(Peer peer) {
        if (peer.writing || peer.writes.isEmpty() || !peers.containsKey(peer.id)) return;
        Write write = peer.writes.peek();
        try {
            int properties = write.characteristic.getProperties();
            int writeType = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
            write.characteristic.setWriteType(writeType);
            write.characteristic.setValue(write.data);
            peer.writing = true;
            peer.operationStartedAt = SystemClock.elapsedRealtime();
            if (!peer.gatt.writeCharacteristic(write.characteristic)) {
                disconnect(peer);
                emitError("Bluetooth packet write could not start.");
            }
        } catch (RuntimeException error) {
            disconnect(peer);
            emitError("Bluetooth packet write failed: " + error.getMessage());
        }
    }

    private void drainNotifications() {
        if (sendingNotification != null || server == null || !running) return;
        Notification notification;
        while ((notification = notifications.poll()) != null) {
            if (!peers.containsKey(notification.peer.id)) continue;
            sendingNotification = notification;
            notificationStartedAt = SystemClock.elapsedRealtime();
            try {
                notification.characteristic.setValue(notification.data);
                if (server.notifyCharacteristicChanged(notification.peer.device, notification.characteristic, false)) return;
            } catch (RuntimeException ignored) { }
            sendingNotification = null;
            disconnect(notification.peer);
            emitError("Bluetooth packet notification could not start.");
        }
    }

    private void checkHealth(long session) {
        handler.postDelayed(() -> {
            if (!running || generation != session) return;
            if (!permitted() || !powered()) {
                fail("Bluetooth permission or power is unavailable.");
                return;
            }
            if (!locationEnabled()) {
                fail("Enable system Location to discover Bluetooth devices on this Android version.");
                return;
            }
            long now = SystemClock.elapsedRealtime();
            for (Peer peer : new ArrayList<>(peers.values())) {
                if (peer.operationStartedAt != 0 && now - peer.operationStartedAt > TIMEOUT_MS) {
                    disconnect(peer);
                    emitError("Bluetooth connection operation timed out.");
                }
            }
            if (sendingNotification != null && now - notificationStartedAt > TIMEOUT_MS) {
                Peer peer = sendingNotification.peer;
                sendingNotification = null;
                disconnect(peer);
                emitError("Bluetooth packet notification timed out.");
                drainNotifications();
            }
            checkHealth(session);
        }, 2000);
    }
}
