package fit.linky.app;

import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Beacon wire format, free of Android dependencies.
 *
 * Contact set: adv = company 0xFFFF [version, nonce, 7 x entry], scan response = company 0xFFFE
 * [version, nonce, up to 8 x entry]. Identity set: adv = company 0xFFFD [version, pubkey[0..22)],
 * scan response = company 0xFFFC [pubkey[22..32)]. Cross-platform set: adv = LINKY_SERVICE_UUID, scan response =
 * its service data [0x02] (Android); the GATT CONTACTS characteristic carries one [version, nonce, up to 170 x entry] packet.
 */
final class BeaconCodec {
	static final int VERSION = 1;
	static final int CONTACT_ADV_ID = 0xFFFF;
	// Android's ScanRecord keeps one block per company id, so the scan response needs its own id.
	static final int CONTACT_SCAN_RESPONSE_ID = 0xFFFE;
	static final int IDENTITY_ADV_ID = 0xFFFD;
	static final int IDENTITY_SCAN_RESPONSE_ID = 0xFFFC;
	static final int ADV_ENTRIES = 7;
	static final int SCAN_RESPONSE_ENTRIES = 8;
	static final int STATE_NEARBY = 0;
	static final int STATE_BUY = 1;
	static final int STATE_SELL = 2;
	static final long SLOT_MS = 600_000L;
	static final UUID LINKY_SERVICE_UUID = UUID.fromString("D967055A-693F-4F5D-A9F4-4AD0CCA0FFC2");
	static final UUID CONTACTS_CHARACTERISTIC_UUID = UUID.fromString("5A42933B-89B7-4BA1-85BA-11B4655CFABB");
	static final UUID IDENTITY_CHARACTERISTIC_UUID = UUID.fromString("CEDFD0D0-FDDC-434C-BAF6-820E631A49BF");
	static final byte[] ANDROID_MARKER = { 0x02 };
	static final int APPLE_COMPANY_ID = 0x004C;
	private static final int APPLE_OVERFLOW_TYPE = 0x01;
	static final int MAX_PACKET_BYTES = 512;
	private static final int ENTRY_BYTES = 3;
	private static final int HEADER_BYTES = 2;
	private static final int MAX_PACKET_ENTRIES = (MAX_PACKET_BYTES - HEADER_BYTES) / ENTRY_BYTES;
	private static final int OVERFLOW_AREA_BYTES = 16;
	private static final int AD_MANUFACTURER_DATA = 0xFF;
	// Bit 40 of iOS's background overflow area belongs to OVERFLOW_MARKER_UUID 0x...0017, which the iOS app advertises;
	// iOS counts bits from the most significant one of each byte (seen on an iOS 27 iPhone).
	private static final int LINKY_OVERFLOW_BYTE = 5;
	private static final int LINKY_OVERFLOW_MASK = 0x80;
	private static final int PUBKEY_BYTES = 32;
	private static final int IDENTITY_ADV_PUBKEY_BYTES = 22;

	record Frame(byte[] adv, byte[] scanResponse) {}

	private record Candidate(String contact, byte mask) {}

	private BeaconCodec() {}

	static long slot(long nowMs) {
		return nowMs / SLOT_MS;
	}

	static byte[] entry(byte[] key, long slot, int nonce, int state) {
		byte[] h = hmac(key, slot, nonce);
		return new byte[] { h[0], h[1], (byte) (state ^ h[2]) };
	}

	static List<Frame> frames(int nonce, List<byte[]> entries) {
		int perFrame = ADV_ENTRIES + SCAN_RESPONSE_ENTRIES;
		List<Frame> frames = new ArrayList<>();
		for (int start = 0; start < entries.size(); start += perFrame) {
			int split = Math.min(start + ADV_ENTRIES, entries.size());
			int end = Math.min(start + perFrame, entries.size());
			frames.add(new Frame(
				packet(nonce, entries.subList(start, split)),
				split == end ? null : packet(nonce, entries.subList(split, end))
			));
		}
		return frames;
	}

	static byte[] packet(int nonce, List<byte[]> entries) {
		ByteBuffer out = ByteBuffer.allocate(HEADER_BYTES + ENTRY_BYTES * entries.size())
			.put((byte) VERSION)
			.put((byte) nonce);
		entries.forEach(out::put);
		return out.array();
	}

	/** The GATT contact packet: one entry per key, in the given order, capped to fit one ATT long value. */
	static byte[] contactPacket(List<byte[]> keys, long slot, int nonce, int state) {
		List<byte[]> entries = new ArrayList<>();
		keys.stream().limit(MAX_PACKET_ENTRIES).forEach(key -> entries.add(entry(key, slot, nonce, state)));
		return packet(nonce, entries);
	}

	/** A non-Android Linky peer: advertises LINKY_SERVICE_UUID without the Android service data, which the radio path covers. */
	static boolean isHandshakePeer(Collection<UUID> serviceUuids, byte[] linkyServiceData) {
		return serviceUuids != null && serviceUuids.contains(LINKY_SERVICE_UUID) && !Arrays.equals(linkyServiceData, ANDROID_MARKER);
	}

	/**
	 * Returns the 16-byte overflow area from a raw advertisement + scan response, or null when none carries one.
	 * Walks every Apple manufacturer block, since a backgrounded iPhone sends several and ScanRecord keeps only the last.
	 */
	static byte[] appleOverflowArea(byte[] record) {
		if (record == null) {
			return null;
		}
		for (int i = 0; i + 1 < record.length; ) {
			int end = i + 1 + (record[i] & 0xFF);
			if (end > record.length) {
				return null;
			}
			if (end - i >= 4 && (record[i + 1] & 0xFF) == AD_MANUFACTURER_DATA
				&& (record[i + 2] & 0xFF) == (APPLE_COMPANY_ID & 0xFF) && record[i + 3] == (byte) (APPLE_COMPANY_ID >> 8)) {
				byte[] area = appleOverflowItem(record, i + 4, end);
				if (area != null) {
					return area;
				}
			}
			i = end;
		}
		return null;
	}

	/** Apple packs [type, length, value] items into one block; the overflow item has no length byte. */
	private static byte[] appleOverflowItem(byte[] record, int start, int end) {
		for (int j = start; j < end - 1; j += 2 + (record[j + 1] & 0xFF)) {
			if (record[j] == APPLE_OVERFLOW_TYPE) {
				return end - j - 1 >= OVERFLOW_AREA_BYTES ? Arrays.copyOfRange(record, j + 1, j + 1 + OVERFLOW_AREA_BYTES) : null;
			}
		}
		return null;
	}

	static boolean hasLinkyOverflowBit(byte[] overflowArea) {
		return (overflowArea[LINKY_OVERFLOW_BYTE] & LINKY_OVERFLOW_MASK) != 0;
	}

	static byte[] identityAdv(byte[] pubkey) {
		return ByteBuffer.allocate(1 + IDENTITY_ADV_PUBKEY_BYTES)
			.put((byte) VERSION)
			.put(pubkey, 0, IDENTITY_ADV_PUBKEY_BYTES)
			.array();
	}

	static byte[] identityScanResponse(byte[] pubkey) {
		return Arrays.copyOfRange(pubkey, IDENTITY_ADV_PUBKEY_BYTES, PUBKEY_BYTES);
	}

	static byte[] identityPubkey(byte[] adv, byte[] scanResponse) {
		if (
			adv == null || scanResponse == null ||
			adv.length != 1 + IDENTITY_ADV_PUBKEY_BYTES || adv[0] != VERSION ||
			scanResponse.length != PUBKEY_BYTES - IDENTITY_ADV_PUBKEY_BYTES
		) {
			return null;
		}
		return ByteBuffer.allocate(PUBKEY_BYTES)
			.put(adv, 1, IDENTITY_ADV_PUBKEY_BYTES)
			.put(scanResponse)
			.array();
	}

	static String hex(byte[] bytes) {
		StringBuilder out = new StringBuilder(bytes.length * 2);
		for (byte b : bytes) {
			out.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
		}
		return out.toString();
	}

	/** Returns null unless {@code value} is hex of exactly {@code length} bytes. */
	static byte[] unhex(String value, int length) {
		if (value == null || value.length() != length * 2) {
			return null;
		}
		byte[] out = new byte[length];
		for (int i = 0; i < length; i++) {
			int high = Character.digit(value.charAt(2 * i), 16);
			int low = Character.digit(value.charAt(2 * i + 1), 16);
			if (high < 0 || low < 0) {
				return null;
			}
			out[i] = (byte) ((high << 4) | low);
		}
		return out;
	}

	private static byte[] hmac(byte[] key, long slot, int nonce) {
		try {
			Mac mac = Mac.getInstance("HmacSHA256");
			mac.init(new SecretKeySpec(key, "HmacSHA256"));
			return mac.doFinal(ByteBuffer.allocate(5).putInt((int) slot).put((byte) nonce).array());
		} catch (GeneralSecurityException error) {
			throw new IllegalStateException(error);
		}
	}

	/** Matches received contact-set packets against the contacts' keys, one lazily built table per (slot, nonce). */
	static final class Listener {
		private final Map<String, byte[]> keys;
		private final Map<Long, Map<Integer, List<Candidate>>> tables = new HashMap<>();

		Listener(Map<String, byte[]> keys) {
			this.keys = keys;
		}

		/** Returns contact -> state for every entry in {@code packet} that a contact's key produced in a slot next to {@code currentSlot}. */
		Map<String, Integer> match(byte[] packet, long currentSlot) {
			Map<String, Integer> found = new LinkedHashMap<>();
			if (packet == null || packet.length < HEADER_BYTES || packet[0] != VERSION || (packet.length - HEADER_BYTES) % ENTRY_BYTES != 0) {
				return found;
			}
			int nonce = packet[1] & 0xFF;
			tables.keySet().removeIf(key -> (key >> 8) < currentSlot - 1);
			for (long slot = currentSlot - 1; slot <= currentSlot + 1; slot++) {
				Map<Integer, List<Candidate>> table = table(slot, nonce);
				for (int i = HEADER_BYTES; i < packet.length; i += ENTRY_BYTES) {
					for (Candidate candidate : table.getOrDefault(tag(packet[i], packet[i + 1]), List.of())) {
						int state = (packet[i + 2] ^ candidate.mask()) & 0xFF;
						if (state <= STATE_SELL) {
							found.put(candidate.contact(), state);
						}
					}
				}
			}
			return found;
		}

		private Map<Integer, List<Candidate>> table(long slot, int nonce) {
			return tables.computeIfAbsent((slot << 8) | nonce, ignored -> {
				Map<Integer, List<Candidate>> table = new HashMap<>();
				keys.forEach((contact, key) -> {
					byte[] h = hmac(key, slot, nonce);
					table.computeIfAbsent(tag(h[0], h[1]), tag -> new ArrayList<>()).add(new Candidate(contact, h[2]));
				});
				return table;
			});
		}

		private static int tag(byte first, byte second) {
			return ((first & 0xFF) << 8) | (second & 0xFF);
		}
	}
}
