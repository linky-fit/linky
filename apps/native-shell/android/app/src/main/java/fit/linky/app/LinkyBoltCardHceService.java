package fit.linky.app;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

import java.util.Arrays;

/**
 * Emulates a read-only NFC Forum Type 4 Tag whose NDEF file holds the bolt card
 * URL. The component stays disabled outside a session (MainActivity enables it),
 * and answers "not found" whenever no URL is set.
 */
public class LinkyBoltCardHceService extends HostApduService {
	interface Listener {
		void onNdefRead();

		void onDeactivated();
	}

	private static final byte[] NDEF_TAG_APPLICATION_AID = {
		(byte) 0xD2, 0x76, 0x00, 0x00, (byte) 0x85, 0x01, 0x01
	};
	private static final byte[] CC_FILE_ID = {(byte) 0xE1, 0x03};
	private static final byte[] NDEF_FILE_ID = {(byte) 0xE1, 0x04};
	private static final int MAX_NDEF_FILE_SIZE = 0x0400;
	// Capability container: mapping 2.0, MLe 0x003B, MLc 0x0034, NDEF file E104
	// up to MAX_NDEF_FILE_SIZE bytes, read granted, write denied.
	private static final byte[] CAPABILITY_CONTAINER = {
		0x00, 0x0F, 0x20, 0x00, 0x3B, 0x00, 0x34,
		0x04, 0x06, (byte) 0xE1, 0x04,
		(byte) (MAX_NDEF_FILE_SIZE >> 8), (byte) (MAX_NDEF_FILE_SIZE & 0xFF),
		0x00, (byte) 0xFF
	};

	private static final byte INS_SELECT = (byte) 0xA4;
	private static final byte INS_READ_BINARY = (byte) 0xB0;
	private static final byte INS_UPDATE_BINARY = (byte) 0xD6;

	private static final byte[] SW_OK = {(byte) 0x90, 0x00};
	private static final byte[] SW_WRONG_LENGTH = {0x67, 0x00};
	private static final byte[] SW_SECURITY_NOT_SATISFIED = {0x69, (byte) 0x82};
	private static final byte[] SW_NOT_FOUND = {0x6A, (byte) 0x82};
	private static final byte[] SW_WRONG_OFFSET = {0x6B, 0x00};
	private static final byte[] SW_INS_NOT_SUPPORTED = {0x6D, 0x00};

	private static final int FILE_NONE = 0;
	private static final int FILE_CC = 1;
	private static final int FILE_NDEF = 2;

	private static final Object lock = new Object();
	private static byte[] ndefFile = null;
	private static Listener listener = null;

	private boolean applicationSelected = false;
	private int selectedFile = FILE_NONE;
	// The NDEF file as it was when the reader selected it, so a URL swapped
	// mid-read never mixes two URLs in one response.
	private byte[] servedNdefFile = null;
	private boolean readReported = false;

	private static byte[] encodeNdefFile(String url) {
		byte[] message = new NdefMessage(NdefRecord.createUri(url)).toByteArray();
		if (message.length + 2 > MAX_NDEF_FILE_SIZE) {
			return null;
		}
		byte[] file = new byte[message.length + 2];
		file[0] = (byte) (message.length >> 8);
		file[1] = (byte) (message.length & 0xFF);
		System.arraycopy(message, 0, file, 2, message.length);
		return file;
	}

	/** Starts serving `url`; false when it does not fit the NDEF file. */
	static boolean setNdefUrl(String url) {
		byte[] file = encodeNdefFile(url);
		if (file == null) {
			return false;
		}
		synchronized (lock) {
			ndefFile = file;
		}
		return true;
	}

	/**
	 * Swaps the served URL only while a session still serves one. Checked under
	 * the lock `clear` takes, so a swap racing a stop cannot re-arm the card.
	 */
	static boolean replaceNdefUrl(String url) {
		byte[] file = encodeNdefFile(url);
		if (file == null) {
			return false;
		}
		synchronized (lock) {
			if (ndefFile == null) {
				return false;
			}
			ndefFile = file;
		}
		return true;
	}

	static void setListener(Listener next) {
		synchronized (lock) {
			listener = next;
		}
	}

	static void clear() {
		synchronized (lock) {
			ndefFile = null;
			listener = null;
		}
	}

	private static byte[] currentNdefFile() {
		synchronized (lock) {
			return ndefFile;
		}
	}

	private static Listener currentListener() {
		synchronized (lock) {
			return listener;
		}
	}

	@Override
	public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
		if (apdu == null || apdu.length < 4) {
			return SW_WRONG_LENGTH;
		}

		byte instruction = apdu[1];
		if (instruction == INS_SELECT) {
			return select(apdu);
		}
		if (instruction == INS_READ_BINARY) {
			return readBinary(apdu);
		}
		if (instruction == INS_UPDATE_BINARY) {
			return SW_SECURITY_NOT_SATISFIED;
		}
		return SW_INS_NOT_SUPPORTED;
	}

	private byte[] select(byte[] apdu) {
		if (apdu.length < 5) {
			return SW_WRONG_LENGTH;
		}
		int dataLength = apdu[4] & 0xFF;
		if (apdu.length < 5 + dataLength) {
			return SW_WRONG_LENGTH;
		}
		byte[] data = Arrays.copyOfRange(apdu, 5, 5 + dataLength);
		byte selectBy = apdu[2];

		if (selectBy == 0x04) {
			applicationSelected = Arrays.equals(data, NDEF_TAG_APPLICATION_AID)
				&& currentNdefFile() != null;
			selectedFile = FILE_NONE;
			return applicationSelected ? SW_OK : SW_NOT_FOUND;
		}

		if (selectBy == 0x00 && applicationSelected) {
			if (Arrays.equals(data, CC_FILE_ID)) {
				selectedFile = FILE_CC;
				return SW_OK;
			}
			if (Arrays.equals(data, NDEF_FILE_ID)) {
				servedNdefFile = currentNdefFile();
				if (servedNdefFile == null) {
					selectedFile = FILE_NONE;
					return SW_NOT_FOUND;
				}
				selectedFile = FILE_NDEF;
				readReported = false;
				return SW_OK;
			}
		}

		selectedFile = FILE_NONE;
		return SW_NOT_FOUND;
	}

	private byte[] readBinary(byte[] apdu) {
		byte[] file = selectedFile == FILE_CC
			? CAPABILITY_CONTAINER
			: selectedFile == FILE_NDEF ? servedNdefFile : null;
		if (file == null) {
			return SW_NOT_FOUND;
		}

		int offset = ((apdu[2] & 0x7F) << 8) | (apdu[3] & 0xFF);
		int expected = apdu.length > 4 ? apdu[4] & 0xFF : 0;
		if (expected == 0) {
			expected = 256;
		}
		if (offset > file.length) {
			return SW_WRONG_OFFSET;
		}

		int end = Math.min(file.length, offset + expected);
		byte[] response = new byte[end - offset + 2];
		System.arraycopy(file, offset, response, 0, end - offset);
		response[response.length - 2] = SW_OK[0];
		response[response.length - 1] = SW_OK[1];

		if (selectedFile == FILE_NDEF && end >= file.length && !readReported) {
			readReported = true;
			Listener current = currentListener();
			if (current != null) {
				current.onNdefRead();
			}
		}
		return response;
	}

	@Override
	public void onDeactivated(int reason) {
		boolean wasSelected = applicationSelected;
		applicationSelected = false;
		selectedFile = FILE_NONE;
		servedNdefFile = null;
		Listener current = currentListener();
		if (wasSelected && current != null) {
			current.onDeactivated();
		}
	}
}
