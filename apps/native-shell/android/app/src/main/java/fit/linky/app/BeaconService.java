package fit.linky.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Advertises the contact set (and the identity set while the app is on screen) and scans for contacts' beacons. */
@RequiresApi(31)
@SuppressLint("MissingPermission")
public final class BeaconService extends Service {
	static final String EVENT_STATUS = "linky-beacon-status";
	static final String EVENT_NEARBY = "linky-beacon-nearby";
	static final String EXTRA_OPEN_PUBKEY = "linky_beacon_open_pubkey";
	private static final String TAG = "LinkyBeacon";
	private static final String ACTION_STOP = "fit.linky.app.beacon.STOP";
	private static final String RUNNING_CHANNEL_ID = "linky_beacon";
	private static final String TRADE_CHANNEL_ID = "linky_beacon_trades";
	private static final int RUNNING_NOTIFICATION_ID = 0x6c6b62;
	private static final long NEARBY_TTL_MS = 120_000L;
	private static final long FRAME_MS = 300L;
	private static final long TICK_MS = 10_000L;

	record Contact(String pubkey, byte[] key, double priority, String name) {}

	private record Sighting(int state, long lastSeenMs) {}

	private static final Handler main = new Handler(Looper.getMainLooper());
	private static List<Contact> contacts = List.of();
	private static int trade = BeaconCodec.STATE_NEARBY;
	private static int nonce = new SecureRandom().nextInt(256);
	private static byte[] identity;
	private static boolean appResumed;
	private static BeaconService instance;
	private static volatile boolean running;

	private final Map<String, Sighting> nearby = new LinkedHashMap<>();
	private final Set<String> notified = new HashSet<>();
	private BluetoothAdapter adapter;
	private BluetoothLeAdvertiser advertiser;
	private BluetoothLeScanner scanner;
	private BeaconCodec.Listener listener = new BeaconCodec.Listener(Map.of());
	private Map<String, Contact> contactsByPubkey = Map.of();
	private List<BeaconCodec.Frame> frames = List.of();
	private long framesSlot;
	private int frameIndex;
	private AdvertisingSetCallback contactCallback;
	private AdvertisingSet contactSet;
	private AdvertisingSetCallback identityCallback;
	private String error;
	private String lastStatus;
	private boolean nearbyDirty;

	private final Runnable cycleFrames = new Runnable() {
		@Override
		public void run() {
			if (contactSet == null || frames.size() < 2) {
				return;
			}
			frameIndex = (frameIndex + 1) % frames.size();
			applyFrame();
			main.postDelayed(this, FRAME_MS);
		}
	};

	private final Runnable tick = new Runnable() {
		@Override
		public void run() {
			long now = System.currentTimeMillis();
			if (BeaconCodec.slot(now) != framesSlot) {
				refreshFrames();
			}
			if (nearby.values().removeIf(sighting -> sighting.lastSeenMs() < now - NEARBY_TTL_MS) || nearbyDirty) {
				dispatchNearby();
			}
			main.postDelayed(this, TICK_MS);
		}
	};

	private final BroadcastReceiver bluetoothStateReceiver = new BroadcastReceiver() {
		@Override
		public void onReceive(Context context, Intent intent) {
			int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
			if (state == BluetoothAdapter.STATE_ON) {
				startRadio();
			} else if (state == BluetoothAdapter.STATE_TURNING_OFF || state == BluetoothAdapter.STATE_OFF) {
				stopRadio();
			}
			dispatchStatus();
		}
	};

	private final ScanCallback scanCallback = new ScanCallback() {
		@Override
		public void onScanResult(int callbackType, ScanResult result) {
			ScanRecord record = result.getScanRecord();
			if (record == null) {
				return;
			}
			long slot = BeaconCodec.slot(System.currentTimeMillis());
			for (int id : new int[] { BeaconCodec.CONTACT_ADV_ID, BeaconCodec.CONTACT_SCAN_RESPONSE_ID }) {
				listener.match(record.getManufacturerSpecificData(id), slot).forEach(BeaconService.this::markSeen);
			}
		}

		@Override
		public void onBatchScanResults(List<ScanResult> results) {
			results.forEach(result -> onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, result));
		}

		@Override
		public void onScanFailed(int errorCode) {
			error = "scan_failed_" + errorCode;
			dispatchStatus();
		}
	};

	static void start(Context context) {
		ContextCompat.startForegroundService(context, new Intent(context, BeaconService.class));
	}

	static void stop(Context context) {
		main.post(() -> {
			if (instance == null) {
				dispatchIdle(context, null);
			} else {
				instance.stopSelf();
			}
		});
	}

	static boolean isRunning() {
		return running;
	}

	static void dispatchIdle(Context context, String error) {
		BluetoothAdapter adapter = context.getSystemService(BluetoothManager.class).getAdapter();
		JSONObject status = new JSONObject();
		try {
			status.put("running", false)
				.put("bluetoothOn", adapter != null && adapter.isEnabled())
				.put("advertising", false)
				.put("error", error == null ? JSONObject.NULL : error);
		} catch (JSONException ignored) {
			return;
		}
		MainActivity.dispatchBeaconEvent(EVENT_STATUS, status);
	}

	static void setContacts(List<Contact> next) {
		main.post(() -> {
			List<Contact> sorted = new ArrayList<>(next);
			sorted.sort(Comparator.comparingDouble(Contact::priority));
			contacts = sorted;
			if (instance != null) {
				instance.rebuildListener();
				instance.refreshFrames();
			}
		});
	}

	static void setTrade(int next) {
		main.post(() -> {
			if (trade == next) {
				return;
			}
			trade = next;
			// A fresh nonce keeps one (slot, nonce) mask from ever covering two different states.
			nonce = (nonce + 1) & 0xFF;
			if (instance != null) {
				instance.refreshFrames();
			}
		});
	}

	static void setIdentity(byte[] pubkey) {
		main.post(() -> {
			identity = pubkey;
			if (instance != null) {
				instance.stopIdentitySet();
				instance.updateIdentitySet();
			}
		});
	}

	static void setAppResumed(boolean resumed) {
		main.post(() -> {
			appResumed = resumed;
			if (instance != null) {
				instance.updateIdentitySet();
			}
		});
	}

	@Override
	public void onCreate() {
		super.onCreate();
		Log.d(TAG, "service created");
		instance = this;
		running = true;
		adapter = getSystemService(BluetoothManager.class).getAdapter();
		createChannels();
		rebuildListener();
		ContextCompat.registerReceiver(
			this,
			bluetoothStateReceiver,
			new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
			ContextCompat.RECEIVER_NOT_EXPORTED
		);
		if (adapter != null && adapter.isEnabled()) {
			startRadio();
		}
		main.postDelayed(tick, TICK_MS);
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		if (intent != null && ACTION_STOP.equals(intent.getAction())) {
			stopSelf();
			return START_NOT_STICKY;
		}
		startForeground(RUNNING_NOTIFICATION_ID, runningNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
		lastStatus = null;
		dispatchStatus();
		dispatchNearby();
		return START_NOT_STICKY;
	}

	@Override
	public void onDestroy() {
		Log.d(TAG, "service destroyed");
		main.removeCallbacks(tick);
		unregisterReceiver(bluetoothStateReceiver);
		stopRadio();
		nearby.clear();
		instance = null;
		running = false;
		dispatchIdle(this, null);
		dispatchNearby();
		super.onDestroy();
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}

	private void startRadio() {
		if (scanner != null) {
			return;
		}
		advertiser = adapter.getBluetoothLeAdvertiser();
		scanner = adapter.getBluetoothLeScanner();
		if (advertiser == null || scanner == null) {
			advertiser = null;
			scanner = null;
			error = "bluetooth_unavailable";
			return;
		}
		error = null;
		ScanFilter filter = new ScanFilter.Builder()
			.setManufacturerData(BeaconCodec.CONTACT_ADV_ID, new byte[] { BeaconCodec.VERSION }, new byte[] { (byte) 0xFF })
			.build();
		ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build();
		scanner.startScan(List.of(filter), settings, scanCallback);
		refreshFrames();
		updateIdentitySet();
		Log.d(TAG, "radio started");
	}

	private void stopRadio() {
		main.removeCallbacks(cycleFrames);
		try {
			if (scanner != null) {
				scanner.stopScan(scanCallback);
			}
			stopContactSet();
			stopIdentitySet();
		} catch (IllegalStateException ignored) {
			// The adapter already went down and took the scan and advertising sets with it.
		}
		contactCallback = null;
		contactSet = null;
		identityCallback = null;
		advertiser = null;
		scanner = null;
		Log.d(TAG, "radio stopped");
	}

	private void rebuildListener() {
		Map<String, byte[]> keys = new HashMap<>();
		Map<String, Contact> byPubkey = new HashMap<>();
		contacts.forEach(contact -> {
			keys.put(contact.pubkey(), contact.key());
			byPubkey.put(contact.pubkey(), contact);
		});
		listener = new BeaconCodec.Listener(keys);
		contactsByPubkey = byPubkey;
		if (nearby.keySet().retainAll(keys.keySet())) {
			dispatchNearby();
		}
	}

	private void refreshFrames() {
		framesSlot = BeaconCodec.slot(System.currentTimeMillis());
		List<byte[]> entries = new ArrayList<>(contacts.size());
		contacts.forEach(contact -> entries.add(BeaconCodec.entry(contact.key(), framesSlot, nonce, trade)));
		frames = BeaconCodec.frames(nonce, entries);
		frameIndex = 0;
		main.removeCallbacks(cycleFrames);
		if (advertiser == null) {
			return;
		}
		if (frames.isEmpty()) {
			stopContactSet();
		} else if (contactCallback == null) {
			startContactSet();
		} else if (contactSet != null) {
			applyFrame();
			main.postDelayed(cycleFrames, FRAME_MS);
		}
		dispatchStatus();
	}

	private void startContactSet() {
		contactCallback = new AdvertisingSetCallback() {
			@Override
			public void onAdvertisingSetStarted(AdvertisingSet set, int txPower, int status) {
				if (this != contactCallback) {
					return;
				}
				if (status != ADVERTISE_SUCCESS) {
					contactCallback = null;
					error = "advertise_failed_" + status;
				} else {
					contactSet = set;
					error = null;
					applyFrame();
					main.postDelayed(cycleFrames, FRAME_MS);
				}
				dispatchStatus();
			}
		};
		advertiser.startAdvertisingSet(
			advertisingParameters(AdvertisingSetParameters.INTERVAL_LOW),
			manufacturerData(BeaconCodec.CONTACT_ADV_ID, frames.get(0).adv()),
			manufacturerData(BeaconCodec.CONTACT_SCAN_RESPONSE_ID, frames.get(0).scanResponse()),
			null,
			null,
			contactCallback
		);
	}

	private void stopContactSet() {
		if (contactCallback != null && advertiser != null) {
			advertiser.stopAdvertisingSet(contactCallback);
		}
		contactCallback = null;
		contactSet = null;
	}

	private void applyFrame() {
		BeaconCodec.Frame frame = frames.get(frameIndex);
		contactSet.setAdvertisingData(manufacturerData(BeaconCodec.CONTACT_ADV_ID, frame.adv()));
		contactSet.setScanResponseData(manufacturerData(BeaconCodec.CONTACT_SCAN_RESPONSE_ID, frame.scanResponse()));
	}

	private void updateIdentitySet() {
		boolean wanted = appResumed && identity != null && advertiser != null;
		if (!wanted) {
			stopIdentitySet();
			return;
		}
		if (identityCallback != null) {
			return;
		}
		identityCallback = new AdvertisingSetCallback() {
			@Override
			public void onAdvertisingSetStarted(AdvertisingSet set, int txPower, int status) {
				if (this == identityCallback && status != ADVERTISE_SUCCESS) {
					identityCallback = null;
					Log.d(TAG, "identity set failed status=" + status);
				}
			}
		};
		advertiser.startAdvertisingSet(
			advertisingParameters(AdvertisingSetParameters.INTERVAL_MEDIUM),
			manufacturerData(BeaconCodec.IDENTITY_ADV_ID, BeaconCodec.identityAdv(identity)),
			manufacturerData(BeaconCodec.IDENTITY_SCAN_RESPONSE_ID, BeaconCodec.identityScanResponse(identity)),
			null,
			null,
			identityCallback
		);
	}

	private void stopIdentitySet() {
		if (identityCallback != null && advertiser != null) {
			advertiser.stopAdvertisingSet(identityCallback);
		}
		identityCallback = null;
	}

	private void markSeen(String pubkey, int state) {
		Sighting previous = nearby.put(pubkey, new Sighting(state, System.currentTimeMillis()));
		if (previous != null && previous.state() == state) {
			nearbyDirty = true;
			return;
		}
		dispatchNearby();
		if (state != BeaconCodec.STATE_NEARBY && notified.add(pubkey)) {
			notifyTrade(pubkey, state);
		}
	}

	private void dispatchNearby() {
		nearbyDirty = false;
		JSONArray list = new JSONArray();
		JSONObject detail = new JSONObject();
		try {
			for (Map.Entry<String, Sighting> entry : nearby.entrySet()) {
				list.put(new JSONObject()
					.put("pubkey", entry.getKey())
					.put("state", stateName(entry.getValue().state()))
					.put("lastSeenMs", entry.getValue().lastSeenMs()));
			}
			detail.put("contacts", list);
		} catch (JSONException ignored) {
			return;
		}
		MainActivity.dispatchBeaconEvent(EVENT_NEARBY, detail);
	}

	private void dispatchStatus() {
		JSONObject status = new JSONObject();
		try {
			status.put("running", true)
				.put("bluetoothOn", adapter != null && adapter.isEnabled())
				.put("advertising", contactSet != null)
				.put("error", error == null ? JSONObject.NULL : error);
		} catch (JSONException ignored) {
			return;
		}
		String serialized = status.toString();
		if (!serialized.equals(lastStatus)) {
			lastStatus = serialized;
			MainActivity.dispatchBeaconEvent(EVENT_STATUS, status);
		}
	}

	private void notifyTrade(String pubkey, int state) {
		NotificationManager manager = getSystemService(NotificationManager.class);
		if (!manager.areNotificationsEnabled()) {
			return;
		}
		Contact contact = contactsByPubkey.get(pubkey);
		String title = contact == null || contact.name().isEmpty() ? getString(R.string.beacon_trade_fallback_title) : contact.name();
		String text = getString(state == BeaconCodec.STATE_BUY ? R.string.beacon_trade_buy : R.string.beacon_trade_sell);
		Intent open = new Intent(this, MainActivity.class)
			.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
			.putExtra(EXTRA_OPEN_PUBKEY, pubkey);
		Notification notification = new NotificationCompat.Builder(this, TRADE_CHANNEL_ID)
			.setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
			.setContentTitle(title)
			.setContentText(text)
			.setAutoCancel(true)
			.setContentIntent(PendingIntent.getActivity(
				this,
				pubkey.hashCode(),
				open,
				PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			))
			.build();
		manager.notify(pubkey.hashCode(), notification);
	}

	private Notification runningNotification() {
		PendingIntent openApp = PendingIntent.getActivity(
			this,
			0,
			new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
			PendingIntent.FLAG_IMMUTABLE
		);
		PendingIntent stop = PendingIntent.getService(
			this,
			0,
			new Intent(this, BeaconService.class).setAction(ACTION_STOP),
			PendingIntent.FLAG_IMMUTABLE
		);
		return new NotificationCompat.Builder(this, RUNNING_CHANNEL_ID)
			.setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
			.setContentTitle(getString(R.string.beacon_running_title))
			.setContentText(getString(R.string.beacon_running_text))
			.setOngoing(true)
			.setContentIntent(openApp)
			.addAction(0, getString(R.string.beacon_stop), stop)
			.build();
	}

	private void createChannels() {
		NotificationManager manager = getSystemService(NotificationManager.class);
		manager.createNotificationChannel(new NotificationChannel(
			RUNNING_CHANNEL_ID,
			getString(R.string.beacon_running_channel_name),
			NotificationManager.IMPORTANCE_LOW
		));
		manager.createNotificationChannel(new NotificationChannel(
			TRADE_CHANNEL_ID,
			getString(R.string.beacon_trade_channel_name),
			NotificationManager.IMPORTANCE_DEFAULT
		));
	}

	private static AdvertisingSetParameters advertisingParameters(int interval) {
		return new AdvertisingSetParameters.Builder()
			.setLegacyMode(true)
			.setConnectable(false)
			.setScannable(true)
			.setInterval(interval)
			.setTxPowerLevel(AdvertisingSetParameters.TX_POWER_MEDIUM)
			.build();
	}

	private static AdvertiseData manufacturerData(int companyId, byte[] data) {
		AdvertiseData.Builder builder = new AdvertiseData.Builder();
		if (data != null) {
			builder.addManufacturerData(companyId, data);
		}
		return builder.build();
	}

	private static String stateName(int state) {
		return switch (state) {
			case BeaconCodec.STATE_BUY -> "buy";
			case BeaconCodec.STATE_SELL -> "sell";
			default -> "nearby";
		};
	}
}
