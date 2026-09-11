package fit.linky.app;

import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;

import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Arrays;
import java.util.Collections;
import java.util.UUID;

import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

@RunWith(AndroidJUnit4.class)
public class LinkyBluetoothServiceSelectionTest {
    private static final UUID SERVICE = UUID.fromString("F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C");
    private static final UUID MESH = UUID.fromString("A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D");
    private static final UUID IDENTITY = UUID.fromString("75B7A4D1-6620-4B5C-92C3-4EB8D918D097");
    private static final int WRITABLE_NOTIFY = BluetoothGattCharacteristic.PROPERTY_NOTIFY
        | BluetoothGattCharacteristic.PROPERTY_WRITE;

    private BluetoothGattService service(boolean identity) {
        BluetoothGattService service = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(characteristic(MESH, WRITABLE_NOTIFY));
        if (identity) service.addCharacteristic(characteristic(IDENTITY, WRITABLE_NOTIFY));
        return service;
    }

    private BluetoothGattCharacteristic characteristic(UUID uuid, int properties) {
        return new BluetoothGattCharacteristic(uuid, properties, BluetoothGattCharacteristic.PERMISSION_WRITE);
    }

    @Test
    public void prefersLinkyWhenBitChatServiceWasRegisteredFirst() {
        BluetoothGattService bitChat = service(false);
        BluetoothGattService linky = service(true);
        assertSame(linky, LinkyBluetoothPlugin.selectChatService(Arrays.asList(bitChat, linky)));
    }

    @Test
    public void preservesLinkyWhenItWasRegisteredFirst() {
        BluetoothGattService linky = service(true);
        assertSame(linky, LinkyBluetoothPlugin.selectChatService(Arrays.asList(linky, service(false))));
    }

    @Test
    public void fallsBackToBitChatWithoutLinky() {
        BluetoothGattService bitChat = service(false);
        assertSame(bitChat, LinkyBluetoothPlugin.selectChatService(Collections.singletonList(bitChat)));
    }

    @Test
    public void doesNotMixMeshAndIdentityFromDifferentServices() {
        BluetoothGattService bitChat = service(false);
        BluetoothGattService identityOnly = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        identityOnly.addCharacteristic(characteristic(IDENTITY, WRITABLE_NOTIFY));
        assertSame(bitChat, LinkyBluetoothPlugin.selectChatService(Arrays.asList(identityOnly, bitChat)));
    }

    @Test
    public void ignoresUnusableIdentityAndAcceptsWriteWithoutResponse() {
        BluetoothGattService unusable = service(false);
        unusable.addCharacteristic(characteristic(IDENTITY, BluetoothGattCharacteristic.PROPERTY_READ));
        BluetoothGattService linky = new BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        int properties = BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE;
        linky.addCharacteristic(characteristic(MESH, properties));
        linky.addCharacteristic(characteristic(IDENTITY, properties));
        assertSame(linky, LinkyBluetoothPlugin.selectChatService(Arrays.asList(unusable, linky)));
    }

    @Test
    public void ignoresServicesWithTheWrongUuid() {
        BluetoothGattService unrelated = new BluetoothGattService(UUID.randomUUID(), BluetoothGattService.SERVICE_TYPE_PRIMARY);
        unrelated.addCharacteristic(characteristic(MESH, WRITABLE_NOTIFY));
        unrelated.addCharacteristic(characteristic(IDENTITY, WRITABLE_NOTIFY));
        assertNull(LinkyBluetoothPlugin.selectChatService(Collections.singletonList(unrelated)));
    }
}
