package fit.linky.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LinkyWebChromeClientTest {

	@Test
	public void picksPhotosOnlyForImageOnlyInputs() {
		assertTrue(LinkyWebChromeClient.acceptsOnlyImages(new String[] { "image/*" }));
		assertTrue(LinkyWebChromeClient.acceptsOnlyImages(new String[] { "image/png", "image/jpeg" }));
		assertTrue(LinkyWebChromeClient.acceptsOnlyImages(new String[] { "image/png, image/jpeg" }));
	}

	@Test
	public void keepsTheDefaultChooserForOtherInputs() {
		assertFalse(LinkyWebChromeClient.acceptsOnlyImages(new String[] { "image/*", "application/pdf", ".pdf" }));
		assertFalse(LinkyWebChromeClient.acceptsOnlyImages(new String[] { ".txt,.json" }));
		assertFalse(LinkyWebChromeClient.acceptsOnlyImages(new String[] { "" }));
		assertFalse(LinkyWebChromeClient.acceptsOnlyImages(new String[0]));
	}
}
