package fit.linky.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.ChecksSdkIntAtLeast;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** {@code window.LinkyNativeBeacon}: beacon permissions, key table, service lifecycle and the identity scan. */
@SuppressLint("MissingPermission")
final class LinkyNativeBeaconBridge {
	private static final String TAG = "LinkyBeacon";
	private static final String EVENT_PERMISSION = "linky-beacon-permission";
	private static final String EVENT_IDENTITIES = "linky-beacon-identities";
	private static final String EVENT_OPEN_CONVERSATION = "linky-beacon-open-conversation";
	private static final String PREF_PERMISSION_REQUESTED = "beacon_permission_requested";
	private static final long IDENTITY_TTL_MS = 120_000L;
	private static final long IDENTITY_TICK_MS = 10_000L;

	private final MainActivity activity;
	private final SharedPreferences preferences;
	private final ActivityResultLauncher<String[]> permissionLauncher;
	private final Handler main = new Handler(Looper.getMainLooper());
	private final Map<String, Long> identities = new LinkedHashMap<>();
	private boolean identityScanWanted;
	private boolean activityResumed;
	private BluetoothLeScanner identityScanner;
	private boolean webAppListening;
	private String pendingOpenPubkey;

	private final ScanCallback identityCallback = new ScanCallback() {
		@Override
		public void onScanResult(int callbackType, ScanResult result) {
			ScanRecord record = result.getScanRecord();
			byte[] pubkey = record == null ? null : BeaconCodec.identityPubkey(
				record.getManufacturerSpecificData(BeaconCodec.IDENTITY_ADV_ID),
				record.getManufacturerSpecificData(BeaconCodec.IDENTITY_SCAN_RESPONSE_ID)
			);
			if (pubkey != null && identities.put(BeaconCodec.hex(pubkey), System.currentTimeMillis()) == null) {
				dispatchIdentities();
			}
		}

		@Override
		public void onScanFailed(int errorCode) {
			Log.d(TAG, "identity scan failed code=" + errorCode);
			main.removeCallbacks(identityExpiry);
			identityScanner = null;
		}
	};

	private final Runnable identityExpiry = new Runnable() {
		@Override
		public void run() {
			long cutoff = System.currentTimeMillis() - IDENTITY_TTL_MS;
			if (identities.values().removeIf(lastSeenMs -> lastSeenMs < cutoff)) {
				dispatchIdentities();
			}
			main.postDelayed(this, IDENTITY_TICK_MS);
		}
	};

	LinkyNativeBeaconBridge(MainActivity activity, SharedPreferences preferences) {
		this.activity = activity;
		this.preferences = preferences;
		permissionLauncher = activity.registerForActivityResult(
			new ActivityResultContracts.RequestMultiplePermissions(),
			result -> dispatchPermission()
		);
	}

	@JavascriptInterface
	public String getPermissionState() {
		if (!isSupported()) {
			return "unsupported";
		}
		String[] permissions = bluetoothPermissions();
		if (Arrays.stream(permissions).allMatch(this::isGranted)) {
			return "granted";
		}
		boolean canAsk = !preferences.getBoolean(PREF_PERMISSION_REQUESTED, false) || Arrays.stream(permissions)
			.anyMatch(permission -> !isGranted(permission) && activity.shouldShowRequestPermissionRationale(permission));
		return canAsk ? "prompt" : "denied";
	}

	@JavascriptInterface
	public void requestPermissions() {
		if (!isSupported()) {
			dispatchPermission();
			return;
		}
		preferences.edit().putBoolean(PREF_PERMISSION_REQUESTED, true).apply();
		List<String> permissions = new ArrayList<>(Arrays.asList(bluetoothPermissions()));
		if (Build.VERSION.SDK_INT >= 33) {
			permissions.add(Manifest.permission.POST_NOTIFICATIONS);
		}
		activity.runOnUiThread(() -> permissionLauncher.launch(permissions.toArray(new String[0])));
	}

	@JavascriptInterface
	public void setKeys(String json) {
		if (!isSupported()) {
			return;
		}
		List<BeaconService.Contact> contacts = new ArrayList<>();
		try {
			JSONArray table = new JSONArray(json);
			for (int i = 0; i < table.length(); i++) {
				JSONObject row = table.getJSONObject(i);
				String pubkey = row.optString("pubkey").toLowerCase(Locale.ROOT);
				byte[] key = BeaconCodec.unhex(row.optString("beaconKeyHex"), 32);
				if (BeaconCodec.unhex(pubkey, 32) != null && key != null) {
					contacts.add(new BeaconService.Contact(pubkey, key, row.optDouble("priority", 0), row.optString("name")));
				}
			}
		} catch (JSONException error) {
			Log.d(TAG, "setKeys ignored malformed table");
			return;
		}
		BeaconService.setContacts(contacts);
	}

	@JavascriptInterface
	public void setTrade(String trade) {
		if (!isSupported()) {
			return;
		}
		BeaconService.setTrade(switch (String.valueOf(trade)) {
			case "buy" -> BeaconCodec.STATE_BUY;
			case "sell" -> BeaconCodec.STATE_SELL;
			default -> BeaconCodec.STATE_NEARBY;
		});
	}

	/** The user's own x-only pubkey, broadcast in the identity set. */
	@JavascriptInterface
	public void setIdentity(String pubkeyHex) {
		if (isSupported()) {
			BeaconService.setIdentity(BeaconCodec.unhex(pubkeyHex, 32));
		}
	}

	@JavascriptInterface
	public void start() {
		main.post(() -> {
			webAppListening = true;
			if (pendingOpenPubkey != null) {
				dispatchOpenConversation(pendingOpenPubkey);
				pendingOpenPubkey = null;
			}
		});
		if (!isSupported()) {
			return;
		}
		if (!"granted".equals(getPermissionState())) {
			BeaconService.dispatchIdle(activity, "permission");
		} else {
			main.post(() -> BeaconService.start(activity));
		}
	}

	@JavascriptInterface
	public void stop() {
		if (isSupported()) {
			BeaconService.stop(activity);
		}
	}

	@JavascriptInterface
	public boolean isRunning() {
		return isSupported() && BeaconService.isRunning();
	}

	@JavascriptInterface
	public void startIdentityScan() {
		if (isSupported()) {
			main.post(() -> {
				identityScanWanted = true;
				updateIdentityScan();
			});
		}
	}

	@JavascriptInterface
	public void stopIdentityScan() {
		if (isSupported()) {
			main.post(() -> {
				identityScanWanted = false;
				updateIdentityScan();
				identities.clear();
				dispatchIdentities();
			});
		}
	}

	void onResume() {
		activityResumed = true;
		if (isSupported()) {
			BeaconService.setAppResumed(true);
			updateIdentityScan();
		}
	}

	void onPause() {
		activityResumed = false;
		if (isSupported()) {
			BeaconService.setAppResumed(false);
			updateIdentityScan();
		}
	}

	/** Handles a trade notification tap; the event waits for {@link #start()} when the web app is still loading. */
	void handleIntent(Intent intent) {
		String pubkey = intent == null ? null : intent.getStringExtra(BeaconService.EXTRA_OPEN_PUBKEY);
		if (pubkey == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
			return;
		}
		intent.removeExtra(BeaconService.EXTRA_OPEN_PUBKEY);
		if (webAppListening) {
			dispatchOpenConversation(pubkey);
		} else {
			pendingOpenPubkey = pubkey;
		}
	}

	private void updateIdentityScan() {
		boolean wanted = identityScanWanted && activityResumed && "granted".equals(getPermissionState());
		if (wanted == (identityScanner != null)) {
			return;
		}
		if (!wanted) {
			main.removeCallbacks(identityExpiry);
			try {
				identityScanner.stopScan(identityCallback);
			} catch (IllegalStateException ignored) {
				// Bluetooth is already off, which ended the scan.
			}
			identityScanner = null;
			return;
		}
		BluetoothAdapter adapter = activity.getSystemService(BluetoothManager.class).getAdapter();
		identityScanner = adapter == null || !adapter.isEnabled() ? null : adapter.getBluetoothLeScanner();
		if (identityScanner == null) {
			return;
		}
		ScanFilter filter = new ScanFilter.Builder()
			.setManufacturerData(BeaconCodec.IDENTITY_ADV_ID, new byte[] { BeaconCodec.VERSION }, new byte[] { (byte) 0xFF })
			.build();
		ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
		identityScanner.startScan(List.of(filter), settings, identityCallback);
		main.postDelayed(identityExpiry, IDENTITY_TICK_MS);
	}

	private void dispatchIdentities() {
		JSONObject detail = new JSONObject();
		try {
			detail.put("pubkeys", new JSONArray(identities.keySet()));
		} catch (JSONException ignored) {
			return;
		}
		MainActivity.dispatchBeaconEvent(EVENT_IDENTITIES, detail);
	}

	private void dispatchOpenConversation(String pubkey) {
		JSONObject detail = new JSONObject();
		try {
			detail.put("pubkey", pubkey);
		} catch (JSONException ignored) {
			return;
		}
		MainActivity.dispatchBeaconEvent(EVENT_OPEN_CONVERSATION, detail);
	}

	private void dispatchPermission() {
		JSONObject detail = new JSONObject();
		try {
			detail.put("state", getPermissionState());
		} catch (JSONException ignored) {
			return;
		}
		MainActivity.dispatchBeaconEvent(EVENT_PERMISSION, detail);
	}

	@ChecksSdkIntAtLeast(api = 31)
	private boolean isSupported() {
		return Build.VERSION.SDK_INT >= 31
			&& activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
			&& activity.getSystemService(BluetoothManager.class).getAdapter() != null;
	}

	private boolean isGranted(String permission) {
		return ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED;
	}

	private static String[] bluetoothPermissions() {
		return new String[] {
			Manifest.permission.BLUETOOTH_SCAN,
			Manifest.permission.BLUETOOTH_ADVERTISE,
			Manifest.permission.BLUETOOTH_CONNECT,
		};
	}
}
