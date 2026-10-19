import { parseBankPayment } from "@linky-fit/proxy-payment";
import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Linking, Platform } from "react-native";
import { writeDeviceFile } from "../platform/deviceFile.native";
import { qrCodeBmp } from "./qrBitmap";

const SPAYD_FILENAME = "platba.spayd";
const SPD_QR_BMP_FILENAME = "platba.bmp";
const SPAYD_MIME_TYPE = "application/x-shortpaymentdescriptor";
const SPD_QR_JPEG_MIME_TYPE = "image/jpeg";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

const paymentDirectory = new Directory(Paths.cache, "linky-payments");

const shareFile = (uri: string, mimeType: string): Promise<void> =>
  Sharing.shareAsync(uri, { dialogTitle: "QR platba", mimeType });

// Czech bank apps open a viewed .spayd file; without one the share sheet lets the user pick.
const openSpdPayment = async (spdPayload: string): Promise<void> => {
  const file = writeDeviceFile(
    paymentDirectory,
    SPAYD_FILENAME,
    new TextEncoder().encode(spdPayload),
    SPAYD_MIME_TYPE,
  );
  if (Platform.OS === "android") {
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: new ExpoFile(file.uri).contentUri,
        type: SPAYD_MIME_TYPE,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
      return;
    } catch {
      // No app views SPAYD files.
    }
  }
  await shareFile(file.uri, SPAYD_MIME_TYPE);
};

export const openSpdPaymentInBank = async (
  spdPayload: string,
): Promise<void> => {
  const payment = parseBankPayment(spdPayload);
  if (payment.format === "payme") {
    await Linking.openURL(payment.payload);
    return;
  }
  if (payment.format !== "spd") {
    await shareSpdPaymentQrJpeg(payment.payload);
    return;
  }
  await openSpdPayment(payment.payload);
};

export const shareSpdPaymentQrJpeg = async (
  spdPayload: string,
): Promise<void> => {
  const bitmap = writeDeviceFile(
    paymentDirectory,
    SPD_QR_BMP_FILENAME,
    qrCodeBmp(spdPayload, { margin: 2, targetWidth: 1024 }),
    "image/bmp",
  );
  const image = await ImageManipulator.manipulate(bitmap.uri).renderAsync();
  const jpeg = await image.saveAsync({
    compress: 0.95,
    format: SaveFormat.JPEG,
  });
  await shareFile(jpeg.uri, SPD_QR_JPEG_MIME_TYPE);
};
