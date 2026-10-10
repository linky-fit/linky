package fit.linky.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Map;

import org.junit.Test;

public class LinkyPushNotificationsTest {
	@Test
	public void flattensTheWebPushEnvelopeOfAMessage() {
		Map<String, String> data = LinkyPushNotifications.parseWebPushEnvelope(
			"{\"title\":\"Linky - npub1abc...xyz\",\"body\":\"Nová aktivita v Linky\","
				+ "\"data\":{\"type\":\"message\",\"outerEventId\":\"wrap-id\",\"recipientPubkey\":\"pubkey\",\"createdAt\":1700000000}}"
		);

		assertEquals("Linky - npub1abc...xyz", data.get("title"));
		assertEquals("Nová aktivita v Linky", data.get("body"));
		assertEquals("wrap-id", data.get("outerEventId"));
		assertEquals("pubkey", data.get("recipientPubkey"));
		assertEquals("1700000000", data.get("createdAt"));
	}

	@Test
	public void keepsTheReminderTimeOfARecurringReminder() {
		Map<String, String> data = LinkyPushNotifications.parseWebPushEnvelope(
			"{\"title\":\"Linky\",\"body\":\"Pravidelná platba\",\"data\":{\"type\":\"recurring_reminder\",\"notifyAtSec\":1700000060}}"
		);

		assertEquals("recurring_reminder", data.get("type"));
		assertEquals("1700000060", data.get("notifyAtSec"));
		assertNull(data.get("outerEventId"));
	}

	@Test
	public void rejectsAPayloadThatIsNotJson() {
		assertNull(LinkyPushNotifications.parseWebPushEnvelope("not json"));
	}
}
