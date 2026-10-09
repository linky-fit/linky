package fit.linky.app;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.ScanRecord;
import android.os.Handler;
import android.os.ParcelUuid;
import android.util.Log;

import androidx.annotation.RequiresApi;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Cross-platform discovery for {@link BeaconService}: a connectable LINKY_SERVICE_UUID advertisement, the GATT server
 * peers hand their contact packets to, and outgoing handshakes with non-Android Linky phones found by the scan.
 */
@RequiresApi(31)
@SuppressLint("MissingPermission")
@SuppressWarnings("deprecation") // The pre-API 33 GATT client calls are the ones that also work on API 31 and 32.
final class BeaconGatt {
	static final ParcelUuid SERVICE = new ParcelUuid(BeaconCodec.LINKY_SERVICE_UUID);
	private static final String TAG = "LinkyBeacon";
	private static final long THROTTLE_MS = 40_000L;
	private static final long FALSE_POSITIVE_THROTTLE_MS = 120_000L;
	private static final long TIMEOUT_MS = 10_000L;
	private static final int MAX_HANDSHAKES = 2;
	private static final int MAX_MTU = 517;
	private static final int MAX_LOGGED_OVERFLOWS = 1000;
	// iOS keeps one random address for about 15 minutes, so a confirmed iPhone stays recognizable for that long.
	private static final long LINKY_PEER_MEMORY_MS = 15 * 60_000L;

	private final BeaconService service;
	private final Handler main;
	private final BluetoothLeAdvertiser advertiser;
	private final BluetoothGattServer server;
	private final Map<String, Long> throttledUntil = new HashMap<>();
	private final Set<String> overflowLogged = new HashSet<>();
	private final Map<String, Long> linkyPeersSeenAt = new HashMap<>();
	private final Set<Handshake> handshakes = new HashSet<>();
	private final Map<String, byte[]> reads = new HashMap<>();
	private final Map<String, byte[]> preparedWrites = new HashMap<>();

	private final AdvertisingSetCallback advertisingCallback = new AdvertisingSetCallback() {
		@Override
		public void onAdvertisingSetStarted(AdvertisingSet set, int txPower, int status) {
			if (status != ADVERTISE_SUCCESS) {
				Log.d(TAG, "service set failed status=" + status);
			}
		}
	};

	private final BluetoothGattServerCallback serverCallback = new BluetoothGattServerCallback() {
		@Override
		public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
			if (newState == BluetoothProfile.STATE_DISCONNECTED) {
				main.post(() -> {
					reads.keySet().removeIf(key -> key.startsWith(device.getAddress()));
					preparedWrites.remove(device.getAddress());
				});
			}
		}

		@Override
		public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattCharacteristic characteristic) {
			main.post(() -> respondToRead(device, requestId, offset, characteristic.getUuid()));
		}

		@Override
		public void onCharacteristicWriteRequest(
			BluetoothDevice device,
			int requestId,
			BluetoothGattCharacteristic characteristic,
			boolean preparedWrite,
			boolean responseNeeded,
			int offset,
			byte[] value
		) {
			main.post(() -> {
				int status = receiveWrite(device, characteristic.getUuid(), preparedWrite, offset, value);
				if (responseNeeded) {
					server.sendResponse(device, requestId, status, offset, value);
				}
			});
		}

		@Override
		public void onExecuteWrite(BluetoothDevice device, int requestId, boolean execute) {
			main.post(() -> {
				byte[] packet = preparedWrites.remove(device.getAddress());
				if (execute && packet != null) {
					service.mergePacket(packet);
				}
				server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
			});
		}
	};

	BeaconGatt(BeaconService service, Handler main, BluetoothLeAdvertiser advertiser) {
		this.service = service;
		this.main = main;
		this.advertiser = advertiser;
		server = service.getSystemService(BluetoothManager.class).openGattServer(service, serverCallback);
		if (server == null) {
			Log.d(TAG, "gatt server unavailable");
			return;
		}
		BluetoothGattService linky = new BluetoothGattService(BeaconCodec.LINKY_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);
		linky.addCharacteristic(new BluetoothGattCharacteristic(
			BeaconCodec.CONTACTS_CHARACTERISTIC_UUID,
			BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_WRITE,
			BluetoothGattCharacteristic.PERMISSION_READ | BluetoothGattCharacteristic.PERMISSION_WRITE
		));
		linky.addCharacteristic(new BluetoothGattCharacteristic(
			BeaconCodec.IDENTITY_CHARACTERISTIC_UUID,
			BluetoothGattCharacteristic.PROPERTY_READ,
			BluetoothGattCharacteristic.PERMISSION_READ
		));
		server.addService(linky);
		advertiser.startAdvertisingSet(
			new AdvertisingSetParameters.Builder()
				.setLegacyMode(true)
				.setConnectable(true)
				.setScannable(true)
				.setInterval(AdvertisingSetParameters.INTERVAL_LOW)
				.setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM)
				.build(),
			new AdvertiseData.Builder().addServiceUuid(SERVICE).build(),
			new AdvertiseData.Builder().addServiceData(SERVICE, BeaconCodec.ANDROID_MARKER).build(),
			null,
			null,
			advertisingCallback
		);
	}

	void close() {
		new ArrayList<>(handshakes).forEach(handshake -> handshake.finish("closed"));
		if (server != null) {
			server.close();
			advertiser.stopAdvertisingSet(advertisingCallback);
		}
	}

	void onScanRecord(BluetoothDevice device, ScanRecord record) {
		List<UUID> serviceUuids = new ArrayList<>();
		if (record.getServiceUuids() != null) {
			record.getServiceUuids().forEach(uuid -> serviceUuids.add(uuid.getUuid()));
		}
		if (BeaconCodec.isHandshakePeer(serviceUuids, record.getServiceData(SERVICE))) {
			handshake(device, true);
			return;
		}
		byte[] overflow = BeaconCodec.appleOverflowArea(record.getBytes());
		if (overflow == null) {
			return;
		}
		if (overflowLogged.size() >= MAX_LOGGED_OVERFLOWS) {
			overflowLogged.clear();
		}
		if (overflowLogged.add(device.getAddress())) {
			Log.d(TAG, "apple overflow " + device.getAddress() + " " + BeaconCodec.hex(overflow));
		}
		if (BeaconCodec.hasLinkyOverflowBit(overflow) || isRecentLinkyPeer(device.getAddress())) {
			handshake(device, false);
		}
	}

	private boolean isRecentLinkyPeer(String address) {
		Long seenAt = linkyPeersSeenAt.get(address);
		return seenAt != null && seenAt > System.currentTimeMillis() - LINKY_PEER_MEMORY_MS;
	}

	private void rememberLinkyPeer(String address) {
		linkyPeersSeenAt.put(address, System.currentTimeMillis());
	}

	private void handshake(BluetoothDevice device, boolean confirmed) {
		long now = System.currentTimeMillis();
		throttledUntil.values().removeIf(until -> until <= now);
		linkyPeersSeenAt.values().removeIf(seenAt -> seenAt <= now - LINKY_PEER_MEMORY_MS);
		if (server == null || handshakes.size() >= MAX_HANDSHAKES || throttledUntil.containsKey(device.getAddress()) || !service.wantsHandshake()) {
			return;
		}
		throttledUntil.put(device.getAddress(), now + THROTTLE_MS);
		Handshake handshake = new Handshake(device.getAddress(), confirmed);
		handshakes.add(handshake);
		handshake.start(device);
	}

	private void respondToRead(BluetoothDevice device, int requestId, int offset, UUID characteristic) {
		String key = device.getAddress() + characteristic;
		if (offset == 0 || !reads.containsKey(key)) {
			reads.put(key, BeaconCodec.CONTACTS_CHARACTERISTIC_UUID.equals(characteristic) ? service.contactPacket() : service.identityValue());
		}
		byte[] value = reads.get(key);
		if (offset > value.length) {
			server.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null);
		} else {
			server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, Arrays.copyOfRange(value, offset, value.length));
		}
	}

	private int receiveWrite(BluetoothDevice device, UUID characteristic, boolean prepared, int offset, byte[] value) {
		if (!BeaconCodec.CONTACTS_CHARACTERISTIC_UUID.equals(characteristic)) {
			return BluetoothGatt.GATT_WRITE_NOT_PERMITTED;
		}
		if (offset + value.length > BeaconCodec.MAX_PACKET_BYTES) {
			return BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH;
		}
		rememberLinkyPeer(device.getAddress());
		if (!prepared) {
			service.mergePacket(value);
			return BluetoothGatt.GATT_SUCCESS;
		}
		byte[] previous = preparedWrites.getOrDefault(device.getAddress(), new byte[0]);
		byte[] next = Arrays.copyOf(previous, Math.max(previous.length, offset + value.length));
		System.arraycopy(value, 0, next, offset, value.length);
		preparedWrites.put(device.getAddress(), next);
		return BluetoothGatt.GATT_SUCCESS;
	}

	/** One connection: read the peer's contacts, write ours, read its identity during identity scans, disconnect. */
	private final class Handshake extends BluetoothGattCallback {
		private final String address;
		private final boolean confirmed;
		private final Runnable timeout = () -> finish("timeout");
		private BluetoothGatt gatt;
		private BluetoothGattCharacteristic contacts;
		private BluetoothGattCharacteristic identity;

		Handshake(String address, boolean confirmed) {
			this.address = address;
			this.confirmed = confirmed;
		}

		void start(BluetoothDevice device) {
			main.postDelayed(timeout, TIMEOUT_MS);
			gatt = device.connectGatt(service, false, this, BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, main);
			if (gatt == null) {
				finish("connect");
			}
		}

		@Override
		public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
			if (status != BluetoothGatt.GATT_SUCCESS || newState != BluetoothProfile.STATE_CONNECTED) {
				finish("disconnected status=" + status);
			} else if (!gatt.requestMtu(MAX_MTU)) {
				require(gatt.discoverServices(), "discover");
			}
		}

		@Override
		public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
			require(gatt.discoverServices(), "discover");
		}

		@Override
		public void onServicesDiscovered(BluetoothGatt gatt, int status) {
			BluetoothGattService linky = gatt.getService(BeaconCodec.LINKY_SERVICE_UUID);
			if (linky == null) {
				if (!confirmed) {
					throttledUntil.put(address, System.currentTimeMillis() + FALSE_POSITIVE_THROTTLE_MS);
				}
				finish("no linky service");
				return;
			}
			rememberLinkyPeer(address);
			contacts = linky.getCharacteristic(BeaconCodec.CONTACTS_CHARACTERISTIC_UUID);
			identity = linky.getCharacteristic(BeaconCodec.IDENTITY_CHARACTERISTIC_UUID);
			require(contacts != null && gatt.readCharacteristic(contacts), "read contacts");
		}

		@Override
		public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
			if (status != BluetoothGatt.GATT_SUCCESS) {
				finish("read status=" + status);
			} else if (BeaconCodec.IDENTITY_CHARACTERISTIC_UUID.equals(characteristic.getUuid())) {
				service.mergeIdentity(characteristic.getValue());
				finish(null);
			} else {
				service.mergePacket(characteristic.getValue());
				contacts.setValue(service.contactPacket());
				contacts.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
				require(gatt.writeCharacteristic(contacts), "write contacts");
			}
		}

		@Override
		public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
			if (status != BluetoothGatt.GATT_SUCCESS) {
				finish("write status=" + status);
			} else if (identity != null && service.wantsIdentity()) {
				require(gatt.readCharacteristic(identity), "read identity");
			} else {
				finish(null);
			}
		}

		private void require(boolean started, String step) {
			if (!started) {
				finish(step);
			}
		}

		void finish(String failure) {
			if (!handshakes.remove(this)) {
				return;
			}
			main.removeCallbacks(timeout);
			if (gatt != null) {
				gatt.disconnect();
				gatt.close();
			}
			Log.d(TAG, "handshake " + address + (failure == null ? " done" : " failed: " + failure));
		}
	}
}
