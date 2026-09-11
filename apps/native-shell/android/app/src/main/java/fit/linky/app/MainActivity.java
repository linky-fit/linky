package fit.linky.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.nfc.FormatException;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.util.Log;
import android.view.View;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.zxing.BarcodeFormat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import com.journeyapps.barcodescanner.camera.CameraSettings;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class MainActivity extends BridgeActivity {
	private static final String SCAN_LOG_TAG = "LinkyScan";
	private static final int CAMERA_PERMISSION_REQUEST_CODE = 1001;
	private static final long DUPLICATE_SUPPRESS_MS = 120L;
	private static volatile WeakReference<MainActivity> activeInstanceRef = new WeakReference<>(null);
	private static volatile boolean appInForeground = false;
	private static final String EVENT_DEEP_LINK = "linky-native-deep-link";
	private static final String EVENT_BACK_BUTTON = "linky-native-back-button";
	private static final String EVENT_NOTIFICATION_OPEN = "linky-native-notification-open";
	private static final String EVENT_NFC_WRITE = "linky-native-nfc-write";
	private static final String EVENT_NOTIFICATION_PERMISSION = "linky-native-notification-permission";
	private static final String EVENT_SCAN_RESULT = "linky-native-scan-result";
	private static final String EXTRA_NOTIFICATION_ROUTE = "linky_notification_route";
	private static final String EXTRA_NOTIFICATION_OUTER_EVENT_ID = "outerEventId";
	private static final String EXTRA_NOTIFICATION_RECIPIENT_PUBKEY = "recipientPubkey";
	private static final String EXTRA_NOTIFICATION_RELAY_HINTS = "relayHints";
	private static final long NFC_READ_SUPPRESS_AFTER_WRITE_MS = 4000L;
	private static final String PREFS_NAME = "linky.native.bridge";
	private static final String PREF_PENDING_DEEP_LINK_URL = "pending_deep_link_url";
	private static final String PREF_PENDING_NOTIFICATION_OPEN_DETAIL = "pending_notification_open_detail";
	private static final String PREF_PENDING_NOTIFICATION_ROUTE = "pending_notification_route";
	private static final String PREF_NOTIFICATION_PERMISSION_REQUESTED = "notification_permission_requested";
	private static final String FIREBASE_GOOGLE_APP_ID_RESOURCE = "google_app_id";
	private long lastNativeQrScanAtMs = 0L;
	private String lastNativeQrValue = null;
	private DecoratedBarcodeView nativeQrScannerView;
	private View nativeQrScannerOverlay;
	private boolean nativeQrScannerOpen = false;
	private final OnBackPressedCallback appNavigationBackCallback = new OnBackPressedCallback(true) {
		@Override
		public void handleOnBackPressed() {
			dispatchAppBackButton();
		}
	};
	private final OnBackPressedCallback nativeQrScannerBackCallback = new OnBackPressedCallback(false) {
		@Override
		public void handleOnBackPressed() {
			stopNativeQrScanner(true);
		}
	};
	private final BarcodeCallback nativeQrBarcodeCallback = new BarcodeCallback() {
		@Override
		public void barcodeResult(BarcodeResult result) {
			String value = result.getText();
			if (value == null) {
				return;
			}

			String normalizedValue = value.trim();
			if (normalizedValue.isEmpty()) {
				return;
			}

			long now = SystemClock.elapsedRealtime();
			if (
				normalizedValue.equals(lastNativeQrValue) &&
				now - lastNativeQrScanAtMs < DUPLICATE_SUPPRESS_MS
			) {
				Log.d(SCAN_LOG_TAG, "duplicate frame suppressed value=" + summarizeScanValue(normalizedValue));
				return;
			}

			lastNativeQrValue = normalizedValue;
			lastNativeQrScanAtMs = now;
			Log.d(SCAN_LOG_TAG, "frame accepted value=" + summarizeScanValue(normalizedValue));

			dispatchScanResult("success", normalizedValue, null);
		}

		@Override
		public void possibleResultPoints(List<ResultPoint> resultPoints) {
			// no-op
		}
	};
	private int latestBottomInsetPx = 0;
	private int latestKeyboardInsetPx = 0;
	private int latestTopInsetPx = 0;
	private long lastSuccessfulNfcWriteAtMs = 0L;
	private String lastSuccessfulNfcWriteUrl = null;
	private NfcAdapter nfcAdapter;
	private String pendingNfcWriteUrl = null;

	private androidx.activity.result.ActivityResultLauncher<String> notificationPermissionLauncher;
	private SharedPreferences bridgePreferences;

	@Override
	public void onCreate(Bundle savedInstanceState) {
		// super.onCreate() re-delivers the launch intent through onNewIntent(), which
		// writes to bridgePreferences — so it must be initialized first.
		bridgePreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
		registerPlugin(LinkyBluetoothPlugin.class);
		super.onCreate(savedInstanceState);
		activeInstanceRef = new WeakReference<>(this);
		getOnBackPressedDispatcher().addCallback(this, appNavigationBackCallback);
		getOnBackPressedDispatcher().addCallback(this, nativeQrScannerBackCallback);

		nfcAdapter = NfcAdapter.getDefaultAdapter(this);
		cacheIntentDeepLinkUrl(getIntent());
		cacheIntentNotificationRoute(getIntent());

		notificationPermissionLauncher = registerForActivityResult(
			new ActivityResultContracts.RequestPermission(),
			isGranted -> dispatchWindowEvent(
				EVENT_NOTIFICATION_PERMISSION,
				createPermissionDetail(isGranted ? "granted" : getNotificationPermissionState())
			)
		);

		WebView webView = getBridgeWebView();
		if (webView == null) {
			return;
		}

		webView.addJavascriptInterface(new LinkySecretStorageBridge(this), "LinkyNativeSecretStorage");
		webView.addJavascriptInterface(new LinkyNativeScannerBridge(), "LinkyNativeScanner");
		webView.addJavascriptInterface(new LinkyNativeNotificationsBridge(), "LinkyNativeNotifications");
		webView.addJavascriptInterface(new LinkyNativeWindowInsetsBridge(), "LinkyNativeWindowInsets");
		webView.addJavascriptInterface(new LinkyNativeDeepLinksBridge(), "LinkyNativeDeepLinks");
		webView.addJavascriptInterface(new LinkyNativeNfcBridge(), "LinkyNativeNfc");

		View rootView = webView.getRootView();
		nativeQrScannerOverlay = rootView.findViewById(R.id.native_qr_scan_overlay);
		nativeQrScannerView = rootView.findViewById(R.id.zxing_barcode_scanner);
		Log.d(
			SCAN_LOG_TAG,
			"scanner views initialized overlay=" + (nativeQrScannerOverlay != null)
				+ " view=" + (nativeQrScannerView != null)
		);
		if (nativeQrScannerView != null) {
			CameraSettings cameraSettings = new CameraSettings();
			cameraSettings.setAutoFocusEnabled(true);
			cameraSettings.setContinuousFocusEnabled(true);
			cameraSettings.setBarcodeSceneModeEnabled(true);
			cameraSettings.setMeteringEnabled(true);
			cameraSettings.setExposureEnabled(true);
			nativeQrScannerView.getBarcodeView().setCameraSettings(cameraSettings);
			nativeQrScannerView.getBarcodeView().setDecoderFactory(
				new DefaultDecoderFactory(
					Collections.singletonList(BarcodeFormat.QR_CODE),
					null,
					null,
					2
				)
			);
			nativeQrScannerView.setStatusText("Scan QR code");
		}

		ViewCompat.setOnApplyWindowInsetsListener(webView, (View view, WindowInsetsCompat insets) -> {
			Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
			Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
			boolean isImeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
			latestTopInsetPx = Math.max(0, systemBars.top);
			latestBottomInsetPx = Math.max(0, systemBars.bottom);
			latestKeyboardInsetPx = isImeVisible
				? Math.max(0, imeInsets.bottom - latestBottomInsetPx)
				: 0;
			dispatchSafeAreaInsets();
			return insets;
		});

		webView.post(() -> {
			ViewCompat.requestApplyInsets(webView);
			dispatchSafeAreaInsets();
		});
	}

	private void dispatchAppBackButton() {
		WebView webView = getBridgeWebView();
		if (webView == null) {
			runDefaultBackAction();
			return;
		}

		String javascript =
			"(function(){" +
				"var event=new Event('" + EVENT_BACK_BUTTON + "',{cancelable:true});" +
				"window.dispatchEvent(event);" +
				"return event.defaultPrevented;" +
			"})()";
		webView.evaluateJavascript(javascript, result -> {
			if (!"true".equals(result)) {
				runDefaultBackAction();
			}
		});
	}

	private void runDefaultBackAction() {
		appNavigationBackCallback.setEnabled(false);
		getOnBackPressedDispatcher().onBackPressed();
		appNavigationBackCallback.setEnabled(true);
	}

	@Override
	public void onResume() {
		super.onResume();
		activeInstanceRef = new WeakReference<>(this);
		appInForeground = true;
		if (nativeQrScannerOpen && hasCameraPermission() && nativeQrScannerView != null) {
			nativeQrScannerView.resume();
		}
		WebView webView = getBridgeWebView();
		if (webView != null) {
			webView.post(() -> {
				ViewCompat.requestApplyInsets(webView);
				dispatchSafeAreaInsets();
			});
		}
	}

	@Override
	public void onPause() {
		if (nativeQrScannerView != null) {
			nativeQrScannerView.pause();
		}
		super.onPause();
		appInForeground = false;
		if (pendingNfcWriteUrl != null) {
			finishPendingNfcWrite("cancelled", null);
			return;
		}

		stopNfcReaderMode();
	}

	@Override
	public void onStop() {
		super.onStop();
		appInForeground = false;
	}

	@Override
	public void onDestroy() {
		MainActivity activeInstance = activeInstanceRef.get();
		if (activeInstance == this) {
			activeInstanceRef = new WeakReference<>(null);
		}

		super.onDestroy();
	}

	public static boolean isAppInForeground() {
		return appInForeground;
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);

		String deepLinkUrl = extractDeepLinkUrl(intent);
		if (deepLinkUrl != null) {
			cachePendingDeepLinkUrl(deepLinkUrl);
			dispatchDeepLinkUrl(deepLinkUrl);
		}

		String notificationRoute = extractNotificationRoute(intent);
		if (notificationRoute != null) {
			cachePendingNotificationRoute(notificationRoute);
			dispatchNotificationOpen(intent);
		}
	}

	static void dispatchScanResult(String status, String value, String message) {
		MainActivity activity = activeInstanceRef.get();
		if (activity == null) {
			return;
		}

		Log.d(
			SCAN_LOG_TAG,
			"dispatchScanResult status=" + String.valueOf(status)
				+ " value=" + summarizeScanValue(value)
				+ " message=" + String.valueOf(message)
		);

		JSONObject detail = new JSONObject();

		try {
			String normalizedStatus = status == null ? "cancelled" : status.trim();
			if (normalizedStatus.isEmpty()) {
				normalizedStatus = "cancelled";
			}

			detail.put("status", normalizedStatus);

			String normalizedValue = value == null ? "" : value.trim();
			if (!normalizedValue.isEmpty()) {
				detail.put("value", normalizedValue);
			}

			String normalizedMessage = message == null ? "" : message.trim();
			if (!normalizedMessage.isEmpty()) {
				detail.put("message", normalizedMessage);
			}
		} catch (Exception ignored) {
			// ignore JSON bridge payload failures
		}

		activity.dispatchWindowEvent(EVENT_SCAN_RESULT, detail);
	}

	private Bridge getCapacitorBridge() {
		return getBridge();
	}

	private WebView getBridgeWebView() {
		Bridge bridge = getCapacitorBridge();
		return bridge == null ? null : bridge.getWebView();
	}

	@Override
	public void onRequestPermissionsResult(
		int requestCode,
		@NonNull String[] permissions,
		@NonNull int[] grantResults
	) {
		super.onRequestPermissionsResult(requestCode, permissions, grantResults);

		if (requestCode != CAMERA_PERMISSION_REQUEST_CODE) {
			return;
		}

		boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
		if (granted) {
			Log.d(SCAN_LOG_TAG, "camera permission granted");
			startNativeQrScannerPreview();
			return;
		}

		Log.d(SCAN_LOG_TAG, "camera permission denied");
		stopNativeQrScanner(false);
		dispatchScanResult("error", null, "Camera permission denied");
	}

	private void dispatchWindowEvent(String eventName, JSONObject detail) {
		WebView webView = getBridgeWebView();
		if (webView == null) {
			Log.d(SCAN_LOG_TAG, "dispatchWindowEvent skipped event=" + eventName + " because webView is null");
			return;
		}

		String payload = detail == null ? "{}" : detail.toString();
		String script = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(eventName) + ", { detail: " + payload + " }));";

		runOnUiThread(() -> webView.evaluateJavascript(script, null));
	}

	private boolean hasCameraPermission() {
		return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
			== PackageManager.PERMISSION_GRANTED;
	}

	private void openNativeQrScanner() {
		Log.d(SCAN_LOG_TAG, "openNativeQrScanner requested");
		if (nativeQrScannerOverlay == null || nativeQrScannerView == null) {
			Log.d(SCAN_LOG_TAG, "openNativeQrScanner unavailable overlay=" + (nativeQrScannerOverlay != null) + " view=" + (nativeQrScannerView != null));
			dispatchScanResult("error", null, "Native scanner unavailable");
			return;
		}

		nativeQrScannerOpen = true;
		nativeQrScannerBackCallback.setEnabled(true);
		lastNativeQrValue = null;
		lastNativeQrScanAtMs = 0L;
		nativeQrScannerOverlay.setVisibility(View.VISIBLE);
		nativeQrScannerOverlay.bringToFront();

		if (hasCameraPermission()) {
			Log.d(SCAN_LOG_TAG, "openNativeQrScanner camera permission already granted");
			startNativeQrScannerPreview();
			return;
		}

		Log.d(SCAN_LOG_TAG, "openNativeQrScanner requesting camera permission");

		ActivityCompat.requestPermissions(
			this,
			new String[] { Manifest.permission.CAMERA },
			CAMERA_PERMISSION_REQUEST_CODE
		);
	}

	private void setNativeQrScannerViewport(
		double leftCssPx,
		double topCssPx,
		double widthCssPx,
		double heightCssPx,
		double viewportWidthCssPx,
		double viewportHeightCssPx
	) {
		if (
			nativeQrScannerOverlay == null ||
			nativeQrScannerView == null ||
			viewportWidthCssPx <= 0 ||
			viewportHeightCssPx <= 0 ||
			widthCssPx <= 0 ||
			heightCssPx <= 0
		) {
			return;
		}

		int overlayWidth = nativeQrScannerOverlay.getWidth();
		int overlayHeight = nativeQrScannerOverlay.getHeight();
		WebView webView = getBridgeWebView();
		if (webView != null) {
			if (overlayWidth <= 0) {
				overlayWidth = webView.getWidth();
			}
			if (overlayHeight <= 0) {
				overlayHeight = webView.getHeight();
			}
		}
		if (overlayWidth <= 0 || overlayHeight <= 0) {
			return;
		}

		double scaleX = overlayWidth / viewportWidthCssPx;
		double scaleY = overlayHeight / viewportHeightCssPx;
		FrameLayout.LayoutParams layoutParams = new FrameLayout.LayoutParams(
			Math.max(1, (int) Math.round(widthCssPx * scaleX)),
			Math.max(1, (int) Math.round(heightCssPx * scaleY))
		);
		layoutParams.leftMargin = Math.max(0, (int) Math.round(leftCssPx * scaleX));
		layoutParams.topMargin = Math.max(0, (int) Math.round(topCssPx * scaleY));
		nativeQrScannerView.setLayoutParams(layoutParams);
	}

	private void startNativeQrScannerPreview() {
		if (!nativeQrScannerOpen || nativeQrScannerView == null) {
			Log.d(SCAN_LOG_TAG, "startNativeQrScannerPreview skipped open=" + nativeQrScannerOpen + " view=" + (nativeQrScannerView != null));
			return;
		}

		Log.d(SCAN_LOG_TAG, "startNativeQrScannerPreview start");
		nativeQrScannerView.decodeContinuous(nativeQrBarcodeCallback);
		nativeQrScannerView.resume();
	}

	private void stopNativeQrScanner(boolean dispatchCancelled) {
		boolean wasOpen = nativeQrScannerOpen;
		Log.d(SCAN_LOG_TAG, "stopNativeQrScanner dispatchCancelled=" + dispatchCancelled + " wasOpen=" + wasOpen);
		if (nativeQrScannerView != null) {
			nativeQrScannerView.pause();
		}
		if (nativeQrScannerOverlay != null) {
			nativeQrScannerOverlay.setVisibility(View.GONE);
		}

		nativeQrScannerOpen = false;
		nativeQrScannerBackCallback.setEnabled(false);
		lastNativeQrValue = null;
		lastNativeQrScanAtMs = 0L;

		if (wasOpen && dispatchCancelled) {
			dispatchScanResult("cancelled", null, null);
		}
	}

	private static String summarizeScanValue(String value) {
		String normalized = value == null ? "" : value.trim();
		if (normalized.isEmpty()) {
			return "<empty>";
		}

		String prefix = normalized.length() <= 48 ? normalized : normalized.substring(0, 48) + "...";
		return "len=" + normalized.length() + ", isUr=" + normalized.regionMatches(true, 0, "ur:", 0, 3) + ", prefix=" + prefix;
	}

	private JSONObject createPermissionDetail(String permission) {
		JSONObject detail = new JSONObject();

		try {
			detail.put("permission", permission);
		} catch (Exception ignored) {
			// ignore JSON bridge payload failures
		}

		return detail;
	}

	private void dispatchSafeAreaInsets() {
		JSONObject detail = new JSONObject();

		try {
			detail.put("topInsetPx", latestTopInsetPx);
			detail.put("bottomInsetPx", latestBottomInsetPx);
			detail.put("keyboardInsetPx", latestKeyboardInsetPx);
		} catch (Exception ignored) {
			// ignore JSON bridge payload failures
		}

		dispatchWindowEvent("linky-native-window-insets", detail);
	}

	private void dispatchDeepLinkUrl(String url) {
		String normalized = url == null ? "" : url.trim();
		if (normalized.isEmpty()) {
			return;
		}

		JSONObject detail = new JSONObject();

		try {
			detail.put("url", normalized);
		} catch (Exception ignored) {
			// ignore JSON bridge payload failures
		}

		dispatchWindowEvent(EVENT_DEEP_LINK, detail);
	}

	private void dispatchNotificationOpen(Intent intent) {
		JSONObject detail = buildNotificationOpenDetail(intent);
		if (detail == null) {
			return;
		}

		dispatchWindowEvent(EVENT_NOTIFICATION_OPEN, detail);
	}

	private JSONObject buildNotificationOpenDetail(Intent intent) {
		String route = extractNotificationRoute(intent);
		String normalized = normalizeNotificationRoute(route);
		if (normalized == null) {
			return null;
		}

		JSONObject detail = new JSONObject();

		try {
			detail.put("route", normalized);

			String outerEventId = normalizeIntentStringExtra(intent, EXTRA_NOTIFICATION_OUTER_EVENT_ID);
			if (outerEventId != null) {
				detail.put("outerEventId", outerEventId);
			}

			String recipientPubkey = normalizeIntentStringExtra(intent, EXTRA_NOTIFICATION_RECIPIENT_PUBKEY);
			if (recipientPubkey != null) {
				detail.put("recipientPubkey", recipientPubkey);
			}

			String relayHints = normalizeIntentStringExtra(intent, EXTRA_NOTIFICATION_RELAY_HINTS);
			if (relayHints != null) {
				detail.put("relayHints", relayHints);
			}
		} catch (Exception ignored) {
			return null;
		}

		return detail;
	}

	private String normalizeIntentStringExtra(Intent intent, String key) {
		if (intent == null || key == null) {
			return null;
		}

		String value = intent.getStringExtra(key);
		if (value == null) {
			return null;
		}

		String normalized = value.trim();
		return normalized.isEmpty() ? null : normalized;
	}

	private void dispatchNfcWriteEvent(String status, String message) {
		JSONObject detail = new JSONObject();

		try {
			detail.put("status", status);
			if (message != null && !message.trim().isEmpty()) {
				detail.put("message", message.trim());
			}
		} catch (Exception ignored) {
			// ignore JSON bridge payload failures
		}

		dispatchWindowEvent(EVENT_NFC_WRITE, detail);
	}

	private String extractDeepLinkUrl(Intent intent) {
		if (intent == null) {
			return null;
		}

		String action = intent.getAction();
		if (Intent.ACTION_VIEW.equals(action)) {
			if (intent.getData() == null) {
				return null;
			}

			String url = intent.getDataString();
			if (url == null) {
				return null;
			}

			String normalized = normalizeDeepLinkCandidate(url);
			return normalized == null ? null : normalized;
		}

		if (!NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
			&& !NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
			&& !NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {
			return null;
		}

		return extractNfcDeepLinkUrl(intent);
	}

	private String extractNfcDeepLinkUrl(Intent intent) {
		Parcelable[] rawMessages = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
		if (rawMessages == null || rawMessages.length == 0) {
			return null;
		}

		for (Parcelable rawMessage : rawMessages) {
			if (!(rawMessage instanceof NdefMessage)) {
				continue;
			}

			NdefMessage message = (NdefMessage) rawMessage;
			for (NdefRecord record : message.getRecords()) {
				String candidate = extractDeepLinkFromNdefRecord(record);
				if (candidate != null && !shouldSuppressRecentNfcRead(candidate)) {
					return candidate;
				}
			}
		}

		return null;
	}

	private String extractDeepLinkFromNdefRecord(NdefRecord record) {
		if (record == null) {
			return null;
		}

		android.net.Uri uri = record.toUri();
		if (uri != null) {
			String normalized = normalizeDeepLinkCandidate(uri.toString());
			if (normalized != null) {
				return normalized;
			}
		}

		short tnf = record.getTnf();
		byte[] type = record.getType();

		if (tnf == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(type, NdefRecord.RTD_TEXT)) {
			return normalizeDeepLinkCandidate(readTextRecordPayload(record.getPayload()));
		}

		if (tnf == NdefRecord.TNF_MIME_MEDIA) {
			String mimeType = readAsciiBytes(type);
			if ("text/plain".equalsIgnoreCase(mimeType)) {
				return normalizeDeepLinkCandidate(readUtf8Payload(record.getPayload()));
			}
		}

		return null;
	}

	private String readAsciiBytes(byte[] bytes) {
		if (bytes == null || bytes.length == 0) {
			return "";
		}

		return new String(bytes, StandardCharsets.US_ASCII).trim();
	}

	private String readUtf8Payload(byte[] payload) {
		if (payload == null || payload.length == 0) {
			return "";
		}

		return new String(payload, StandardCharsets.UTF_8).trim();
	}

	private String readTextRecordPayload(byte[] payload) {
		if (payload == null || payload.length == 0) {
			return null;
		}

		int status = payload[0] & 0xFF;
		boolean isUtf16 = (status & 0x80) != 0;
		int languageCodeLength = status & 0x3F;
		if (payload.length <= 1 + languageCodeLength) {
			return null;
		}

		Charset charset = isUtf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8;
		return new String(
			payload,
			1 + languageCodeLength,
			payload.length - 1 - languageCodeLength,
			charset
		).trim();
	}

	private String normalizeDeepLinkCandidate(String value) {
		if (value == null) {
			return null;
		}

		String normalized = value.trim();
		if (normalized.isEmpty()) {
			return null;
		}

		String lower = normalized.toLowerCase();
		if (lower.startsWith("nostr://") || lower.startsWith("cashu://")) {
			return normalized;
		}

		return null;
	}

	private boolean isNativeNfcWriteSupported() {
		return Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && nfcAdapter != null;
	}

	private void stopNfcReaderMode() {
		if (!isNativeNfcWriteSupported()) {
			return;
		}

		runOnUiThread(() -> {
			try {
				nfcAdapter.disableReaderMode(this);
			} catch (Exception ignored) {
				// reader mode may already be disabled
			}
		});
	}

	private void finishPendingNfcWrite(String status, String message) {
		String writtenUrl = pendingNfcWriteUrl;
		if ("success".equals(status) && writtenUrl != null) {
			lastSuccessfulNfcWriteUrl = writtenUrl;
			lastSuccessfulNfcWriteAtMs = System.currentTimeMillis();
		}

		pendingNfcWriteUrl = null;
		stopNfcReaderMode();
		dispatchNfcWriteEvent(status, message);
	}

	private boolean shouldSuppressRecentNfcRead(String url) {
		String lastUrl = lastSuccessfulNfcWriteUrl;
		if (lastUrl == null) {
			return false;
		}

		long elapsedMs = System.currentTimeMillis() - lastSuccessfulNfcWriteAtMs;
		if (elapsedMs > NFC_READ_SUPPRESS_AFTER_WRITE_MS) {
			lastSuccessfulNfcWriteUrl = null;
			lastSuccessfulNfcWriteAtMs = 0L;
			return false;
		}

		String normalizedUrl = url == null ? "" : url.trim();
		return lastUrl.equals(normalizedUrl);
	}

	private void cancelPendingNfcWrite() {
		if (pendingNfcWriteUrl == null) {
			stopNfcReaderMode();
			return;
		}

		finishPendingNfcWrite("cancelled", null);
	}

	private void writePendingNfcMessage(Tag tag) {
		String url = pendingNfcWriteUrl;
		if (url == null) {
			stopNfcReaderMode();
			return;
		}

		NdefMessage message = new NdefMessage(new NdefRecord[] { NdefRecord.createUri(url) });
		byte[] encodedMessage = message.toByteArray();

		try {
			Ndef ndef = Ndef.get(tag);
			if (ndef != null) {
				try {
					ndef.connect();
					if (!ndef.isWritable()) {
						finishPendingNfcWrite("error", "NFC tag is read-only.");
						return;
					}

					int maxSize = ndef.getMaxSize();
					if (maxSize > 0 && maxSize < encodedMessage.length) {
						finishPendingNfcWrite("error", "NFC tag is too small.");
						return;
					}

					ndef.writeNdefMessage(message);
					finishPendingNfcWrite("success", null);
					return;
				} finally {
					try {
						ndef.close();
					} catch (Exception ignored) {
						// ignore tag cleanup failures
					}
				}
			}

			NdefFormatable formatable = NdefFormatable.get(tag);
			if (formatable != null) {
				try {
					formatable.connect();
					formatable.format(message);
					finishPendingNfcWrite("success", null);
					return;
				} finally {
					try {
						formatable.close();
					} catch (Exception ignored) {
						// ignore tag cleanup failures
					}
				}
			}

			finishPendingNfcWrite("error", "NFC tag does not support NDEF.");
		} catch (FormatException error) {
			finishPendingNfcWrite("error", error.getMessage() == null ? "Failed to encode NFC tag." : error.getMessage());
		} catch (Exception error) {
			finishPendingNfcWrite("error", error.getMessage() == null ? "Failed to write NFC tag." : error.getMessage());
		}
	}

	private void startPendingNfcWrite(String url) {
		String normalized = normalizeDeepLinkCandidate(url);
		if (normalized == null) {
			dispatchNfcWriteEvent("error", "Unsupported NFC payload.");
			return;
		}

		if (!isNativeNfcWriteSupported()) {
			dispatchNfcWriteEvent("unsupported", null);
			return;
		}

		if (!nfcAdapter.isEnabled()) {
			dispatchNfcWriteEvent("disabled", null);
			return;
		}

		if (pendingNfcWriteUrl != null) {
			dispatchNfcWriteEvent("busy", null);
			return;
		}

		pendingNfcWriteUrl = normalized;

		runOnUiThread(() -> {
			Bundle options = new Bundle();
			options.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 150);

			try {
				nfcAdapter.enableReaderMode(
					this,
					this::writePendingNfcMessage,
					NfcAdapter.FLAG_READER_NFC_A
						| NfcAdapter.FLAG_READER_NFC_B
						| NfcAdapter.FLAG_READER_NFC_F
						| NfcAdapter.FLAG_READER_NFC_V,
					options
				);
				dispatchNfcWriteEvent("armed", null);
			} catch (Exception error) {
				pendingNfcWriteUrl = null;
				dispatchNfcWriteEvent(
					"error",
					error.getMessage() == null ? "Failed to start NFC write." : error.getMessage()
				);
			}
		});
	}

	private void cacheIntentDeepLinkUrl(Intent intent) {
		String deepLinkUrl = extractDeepLinkUrl(intent);
		if (deepLinkUrl == null) {
			return;
		}

		cachePendingDeepLinkUrl(deepLinkUrl);
	}

	private void cacheIntentNotificationRoute(Intent intent) {
		String notificationRoute = extractNotificationRoute(intent);
		if (notificationRoute == null) {
			return;
		}

		cachePendingNotificationRoute(notificationRoute);
		cachePendingNotificationOpenDetail(intent);
	}

	private void cachePendingDeepLinkUrl(String url) {
		String normalized = url == null ? "" : url.trim();
		if (normalized.isEmpty()) {
			return;
		}

		bridgePreferences.edit().putString(PREF_PENDING_DEEP_LINK_URL, normalized).apply();
	}

	private String consumePendingDeepLinkUrl() {
		String pendingUrl = bridgePreferences.getString(PREF_PENDING_DEEP_LINK_URL, null);
		if (pendingUrl == null) {
			return null;
		}

		String normalized = pendingUrl.trim();
		bridgePreferences.edit().remove(PREF_PENDING_DEEP_LINK_URL).apply();
		return normalized.isEmpty() ? null : normalized;
	}

	private void cachePendingNotificationRoute(String route) {
		String normalized = normalizeNotificationRoute(route);
		if (normalized == null) {
			return;
		}

		bridgePreferences.edit().putString(PREF_PENDING_NOTIFICATION_ROUTE, normalized).apply();
	}

	private void cachePendingNotificationOpenDetail(Intent intent) {
		JSONObject detail = buildNotificationOpenDetail(intent);
		if (detail == null) {
			return;
		}

		bridgePreferences.edit()
			.putString(PREF_PENDING_NOTIFICATION_OPEN_DETAIL, detail.toString())
			.apply();
	}

	private String consumePendingNotificationRoute() {
		String pendingRoute = bridgePreferences.getString(PREF_PENDING_NOTIFICATION_ROUTE, null);
		if (pendingRoute == null) {
			return null;
		}

		bridgePreferences.edit().remove(PREF_PENDING_NOTIFICATION_ROUTE).apply();
		return normalizeNotificationRoute(pendingRoute);
	}

	private String consumePendingNotificationOpenDetail() {
		String pendingDetail = bridgePreferences.getString(PREF_PENDING_NOTIFICATION_OPEN_DETAIL, null);
		if (pendingDetail == null) {
			return null;
		}

		String normalized = pendingDetail.trim();
		bridgePreferences.edit().remove(PREF_PENDING_NOTIFICATION_OPEN_DETAIL).apply();
		return normalized.isEmpty() ? null : normalized;
	}

	private String extractNotificationRoute(Intent intent) {
		if (intent == null) {
			return null;
		}

		return normalizeNotificationRoute(intent.getStringExtra(EXTRA_NOTIFICATION_ROUTE));
	}

	private String normalizeNotificationRoute(String route) {
		String normalized = route == null ? "" : route.trim();
		if ("#contacts".equals(normalized) || "#wallet".equals(normalized)) {
			return normalized;
		}

		return null;
	}

	private String getNotificationPermissionState() {
		if (!isNativePushSupported()) {
			return "unsupported";
		}

		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
			return "granted";
		}

		if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
			== PackageManager.PERMISSION_GRANTED) {
			return "granted";
		}

		boolean wasRequested = bridgePreferences.getBoolean(PREF_NOTIFICATION_PERMISSION_REQUESTED, false);
		return wasRequested ? "denied" : "prompt";
	}

	private boolean isNativePushSupported() {
		return getResources().getIdentifier(
			FIREBASE_GOOGLE_APP_ID_RESOURCE,
			"string",
			getPackageName()
		) != 0;
	}

	private final class LinkyNativeScannerBridge {
		@JavascriptInterface
		public void setScanViewport(
			double leftCssPx,
			double topCssPx,
			double widthCssPx,
			double heightCssPx,
			double viewportWidthCssPx,
			double viewportHeightCssPx
		) {
			runOnUiThread(() -> setNativeQrScannerViewport(
				leftCssPx,
				topCssPx,
				widthCssPx,
				heightCssPx,
				viewportWidthCssPx,
				viewportHeightCssPx
			));
		}

		@JavascriptInterface
		public void startScan() {
			runOnUiThread(() -> openNativeQrScanner());
		}

		@JavascriptInterface
		public void stopScan() {
			runOnUiThread(() -> stopNativeQrScanner(false));
		}
	}

	private final class LinkyNativeNotificationsBridge {
		@JavascriptInterface
		public boolean areSupported() {
			return isNativePushSupported();
		}

		@JavascriptInterface
		public String getPermissionState() {
			return getNotificationPermissionState();
		}

		@JavascriptInterface
		public void requestPermission() {
			if (!isNativePushSupported()) {
				dispatchWindowEvent(
					EVENT_NOTIFICATION_PERMISSION,
					createPermissionDetail("unsupported")
				);
				return;
			}

			if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
				dispatchWindowEvent(
					EVENT_NOTIFICATION_PERMISSION,
					createPermissionDetail("granted")
				);
				return;
			}

			bridgePreferences.edit().putBoolean(PREF_NOTIFICATION_PERMISSION_REQUESTED, true).apply();

			runOnUiThread(() -> notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS));
		}
	}

	private final class LinkyNativeWindowInsetsBridge {
		@JavascriptInterface
		public int getBottomInsetPx() {
			return latestBottomInsetPx;
		}

		@JavascriptInterface
		public int getTopInsetPx() {
			return latestTopInsetPx;
		}

		@JavascriptInterface
		public int getKeyboardInsetPx() {
			return latestKeyboardInsetPx;
		}
	}

	private final class LinkyNativeDeepLinksBridge {
		@JavascriptInterface
		public String consumePendingUrl() {
			return consumePendingDeepLinkUrl();
		}

		@JavascriptInterface
		public String consumePendingNotificationRoute() {
			return MainActivity.this.consumePendingNotificationRoute();
		}

		@JavascriptInterface
		public String consumePendingNotificationOpenDetail() {
			return MainActivity.this.consumePendingNotificationOpenDetail();
		}
	}

	private final class LinkyNativeNfcBridge {
		@JavascriptInterface
		public boolean areSupported() {
			return isNativeNfcWriteSupported();
		}

		@JavascriptInterface
		public void cancelWrite() {
			cancelPendingNfcWrite();
		}

		@JavascriptInterface
		public void writeUri(String url) {
			startPendingNfcWrite(url);
		}
	}
}
