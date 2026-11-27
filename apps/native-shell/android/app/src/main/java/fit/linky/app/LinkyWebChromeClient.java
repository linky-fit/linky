package fit.linky.app;

import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Opens the system photo picker for file inputs that accept only images.
 *
 * The default chooser lets a gallery app answer, and some return a file the
 * WebView may not read, e.g. one on an SD card. The photo picker always
 * returns a content URI granted to the app, SD card photos included.
 */
public class LinkyWebChromeClient extends BridgeWebChromeClient {

	private final ActivityResultLauncher<PickVisualMediaRequest> pickOne;
	private final ActivityResultLauncher<PickVisualMediaRequest> pickMany;
	private ValueCallback<Uri[]> pendingCallback;

	public LinkyWebChromeClient(Bridge bridge) {
		super(bridge);
		pickOne = bridge.registerForActivityResult(
			new ActivityResultContracts.PickVisualMedia(),
			uri -> deliver(uri == null ? null : new Uri[] { uri })
		);
		pickMany = bridge.registerForActivityResult(
			new ActivityResultContracts.PickMultipleVisualMedia(),
			uris -> deliver(uris.isEmpty() ? null : uris.toArray(new Uri[0]))
		);
	}

	@Override
	public boolean onShowFileChooser(
		WebView webView,
		ValueCallback<Uri[]> filePathCallback,
		FileChooserParams fileChooserParams
	) {
		if (fileChooserParams.isCaptureEnabled() || !acceptsOnlyImages(fileChooserParams.getAcceptTypes())) {
			return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
		}
		// The WebView waits on every callback, so a chooser left open answers before the next one opens.
		deliver(null);
		pendingCallback = filePathCallback;
		PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
			.setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
			.build();
		if (fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
			pickMany.launch(request);
		} else {
			pickOne.launch(request);
		}
		return true;
	}

	private void deliver(Uri[] uris) {
		if (pendingCallback == null) {
			return;
		}
		pendingCallback.onReceiveValue(uris);
		pendingCallback = null;
	}

	static boolean acceptsOnlyImages(String[] acceptTypes) {
		boolean any = false;
		for (String type : acceptTypes) {
			for (String part : type.split(",")) {
				String trimmed = part.trim();
				if (trimmed.isEmpty()) {
					continue;
				}
				if (!trimmed.startsWith("image/")) {
					return false;
				}
				any = true;
			}
		}
		return any;
	}
}
