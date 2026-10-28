import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "./api";

/**
 * Push registration. Needs a real device and a development/EAS build (Expo Go cannot receive
 * remote push on SDK 53+). Failures are silent: the live stream still works while the app is open.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function registerForPush(): Promise<string | null> {
  try {
    if (Platform.OS === "web" || !Device.isDevice) return null;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("orders", { name: "Orders and chief messages", importance: Notifications.AndroidImportance.HIGH, sound: "default" });
    }
    const cur = await Notifications.getPermissionsAsync();
    let status = cur.status;
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api.registerPush(token);
    return token;
  } catch {
    return null;
  }
}
