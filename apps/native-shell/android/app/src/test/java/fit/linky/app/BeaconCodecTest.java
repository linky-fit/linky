package fit.linky.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
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
