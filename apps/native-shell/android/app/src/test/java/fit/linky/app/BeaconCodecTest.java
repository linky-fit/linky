package fit.linky.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class BeaconCodecTest {
	private static final String VECTORS_PATH = "apps/web-app/src/app/lib/beaconVectors.json";
	private static final long SLOT = 2958123L;

	@Test
	public void entriesMatchSharedVectors() throws Exception {
		JSONArray vectors = new JSONObject(new String(Files.readAllBytes(findVectors().toPath()), StandardCharsets.UTF_8)).getJSONArray("vectors");
		assertTrue(vectors.length() > 0);
		for (int i = 0; i < vectors.length(); i++) {
			JSONObject vector = vectors.getJSONObject(i);
			byte[] key = BeaconCodec.unhex(vector.getString("beaconKeyHex"), 32);
			byte[] entry = BeaconCodec.entry(key, vector.getLong("slot"), vector.getInt("nonce"), vector.getInt("state"));
			assertEquals("vector " + i, vector.getString("entryHex"), BeaconCodec.hex(entry));
		}
	}

	@Test
	public void gattPacketsRoundTripTheSharedVectors() throws Exception {
		JSONArray vectors = new JSONObject(new String(Files.readAllBytes(findVectors().toPath()), StandardCharsets.UTF_8)).getJSONArray("vectors");
		for (int i = 0; i < vectors.length(); i++) {
			JSONObject vector = vectors.getJSONObject(i);
			byte[] key = BeaconCodec.unhex(vector.getString("beaconKeyHex"), 32);
			int nonce = vector.getInt("nonce");
			byte[] packet = BeaconCodec.contactPacket(List.of(key), vector.getLong("slot"), nonce, vector.getInt("state"));

			assertEquals("vector " + i, "01" + String.format("%02x", nonce) + vector.getString("entryHex"), BeaconCodec.hex(packet));
			assertEquals("vector " + i, Map.of("contact", vector.getInt("state")), new BeaconCodec.Listener(Map.of("contact", key)).match(packet, vector.getLong("slot")));
		}
	}

	@Test
	public void gattPacketKeepsTheFirstContactsThatFitOneLongValue() {
		List<byte[]> keys = new ArrayList<>();
		Map<String, byte[]> byContact = new LinkedHashMap<>();
		for (int i = 0; i < 200; i++) {
			byte[] key = new byte[32];
			key[0] = (byte) i;
			key[1] = (byte) (i >> 8);
			keys.add(key);
			byContact.put("contact" + i, key);
		}

		byte[] packet = BeaconCodec.contactPacket(keys, SLOT, 9, BeaconCodec.STATE_SELL);
		Map<String, Integer> seen = new BeaconCodec.Listener(byContact).match(packet, SLOT);

		assertTrue(packet.length <= BeaconCodec.MAX_PACKET_BYTES);
		assertEquals(170, seen.size());
		assertTrue(seen.containsKey("contact169"));
		assertFalse(seen.containsKey("contact170"));
		assertArrayEquals(new byte[] { 1, 0 }, BeaconCodec.contactPacket(List.of(), SLOT, 0, BeaconCodec.STATE_NEARBY));
	}

	@Test
	public void handshakesSkipAndroidPeersAndForeignServices() {
		List<UUID> linky = List.of(UUID.randomUUID(), BeaconCodec.LINKY_SERVICE_UUID);

		assertTrue(BeaconCodec.isHandshakePeer(linky, null));
		assertTrue(BeaconCodec.isHandshakePeer(linky, new byte[] { 0x01 }));
		assertFalse(BeaconCodec.isHandshakePeer(linky, BeaconCodec.ANDROID_MARKER));
		assertFalse(BeaconCodec.isHandshakePeer(List.of(UUID.randomUUID()), null));
		assertFalse(BeaconCodec.isHandshakePeer(null, null));
	}

	@Test
	public void overflowBitFortyMarksABackgroundedLinkyIphone() {
		byte[] backgroundedLinky = BeaconCodec.unhex("00000000808000000000000080000000", 16);
		byte[] otherApps = BeaconCodec.unhex("00000000000100000000000080000000", 16);

		assertTrue(BeaconCodec.hasLinkyOverflowBit(backgroundedLinky));
		assertFalse(BeaconCodec.hasLinkyOverflowBit(otherApps));
	}

	@Test
	public void overflowAreaIsFoundInWhicheverAppleBlockCarriesIt() {
		String flags = "020106";
		String serviceUuids = "1107" + "c2ffa0cc4d0af4a95d4f3f695a0567d9";
		String nearbyInfo = "0aff4c00" + "1005031c0e8c3a";
		String overflow = "14ff4c00" + "01" + "0000000000" + "01" + "00000000000000000000";
		String expected = "000000000001" + "00000000000000000000";

		assertEquals(expected, hexOrNull(BeaconCodec.appleOverflowArea(raw(flags + nearbyInfo + overflow + serviceUuids))));
		assertEquals(expected, hexOrNull(BeaconCodec.appleOverflowArea(raw(flags + overflow + serviceUuids + nearbyInfo))));
		assertEquals(expected, hexOrNull(BeaconCodec.appleOverflowArea(raw(flags + "1bff4c00" + "1005031c0e8c3a" + overflow.substring(8) + "000000"))));
	}

	@Test
	public void recordsWithoutAnAppleOverflowAreaYieldNothing() {
		assertNull(BeaconCodec.appleOverflowArea(null));
		assertNull(BeaconCodec.appleOverflowArea(raw("020106" + "0aff4c00" + "1005031c0e8c3a")));
		assertNull(BeaconCodec.appleOverflowArea(raw("14ffffff" + "0100000000000100000000000000000000")));
		assertNull(BeaconCodec.appleOverflowArea(raw("0aff4c00" + "01000000000001")));
		assertNull(BeaconCodec.appleOverflowArea(raw("15ff4c00" + "01000000")));
	}

	private static byte[] raw(String hex) {
		return BeaconCodec.unhex(hex, hex.length() / 2);
	}

	private static String hexOrNull(byte[] bytes) {
		return bytes == null ? null : BeaconCodec.hex(bytes);
	}

	@Test
	public void listenerDecodesEveryContactAcrossCycledFrames() {
		int nonce = 17;
		Map<String, byte[]> keys = new LinkedHashMap<>();
		List<byte[]> entries = new ArrayList<>();
		for (int i = 0; i < 20; i++) {
			byte[] key = new byte[32];
			key[31] = (byte) (i + 1);
			keys.put("contact" + i, key);
			entries.add(BeaconCodec.entry(key, SLOT, nonce, i % 3));
		}

		List<BeaconCodec.Frame> frames = BeaconCodec.frames(nonce, entries);
		assertEquals(2, frames.size());
		assertEquals(2 + 3 * BeaconCodec.ADV_ENTRIES, frames.get(0).adv().length);
		assertEquals(2 + 3 * BeaconCodec.SCAN_RESPONSE_ENTRIES, frames.get(0).scanResponse().length);
		assertEquals(2 + 3 * 5, frames.get(1).adv().length);
		assertNull(frames.get(1).scanResponse());

		BeaconCodec.Listener listener = new BeaconCodec.Listener(keys);
		Map<String, Integer> seen = new LinkedHashMap<>();
		for (BeaconCodec.Frame frame : frames) {
			seen.putAll(listener.match(frame.adv(), SLOT + 1));
			if (frame.scanResponse() != null) {
				seen.putAll(listener.match(frame.scanResponse(), SLOT + 1));
			}
		}
		assertEquals(20, seen.size());
		for (int i = 0; i < 20; i++) {
			assertEquals(Integer.valueOf(i % 3), seen.get("contact" + i));
		}
	}

	@Test
	public void listenerIgnoresSlotsOutsideTheWindowAndForeignVersions() {
		byte[] key = new byte[32];
		BeaconCodec.Listener listener = new BeaconCodec.Listener(Map.of("contact", key));
		byte[] packet = BeaconCodec.packet(3, List.of(BeaconCodec.entry(key, SLOT, 3, BeaconCodec.STATE_BUY)));

		assertEquals(Map.of("contact", BeaconCodec.STATE_BUY), listener.match(packet, SLOT - 1));
		assertTrue(listener.match(packet, SLOT + 2).isEmpty());
		packet[0] = 2;
		assertTrue(listener.match(packet, SLOT).isEmpty());
	}

	@Test
	public void identityRoundTrip() {
		byte[] pubkey = new byte[32];
		for (int i = 0; i < pubkey.length; i++) {
			pubkey[i] = (byte) (0xA0 + i);
		}
		byte[] adv = BeaconCodec.identityAdv(pubkey);
		byte[] scanResponse = BeaconCodec.identityScanResponse(pubkey);

		assertTrue(adv.length <= 24);
		assertArrayEquals(pubkey, BeaconCodec.identityPubkey(adv, scanResponse));
		assertNull(BeaconCodec.identityPubkey(adv, null));
	}

	private static File findVectors() throws IOException {
		for (File dir = new File(System.getProperty("user.dir")).getAbsoluteFile(); dir != null; dir = dir.getParentFile()) {
			File candidate = new File(dir, VECTORS_PATH);
			if (candidate.isFile()) {
				return candidate;
			}
		}
		throw new IOException(VECTORS_PATH + " not found above " + System.getProperty("user.dir"));
	}
}
