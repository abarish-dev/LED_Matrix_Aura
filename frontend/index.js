// Custom entry: keep Expo Router as the app entry, and additionally register
// the Android widget task handler so the OS can update the widget in the
// background (headless). Guarded so web / iOS are unaffected.
import "expo-router/entry";
import { Platform } from "react-native";

if (Platform.OS === "android") {
  const { registerWidgetTaskHandler } = require("react-native-android-widget");
  const { widgetTaskHandler } = require("./widget-task-handler");
  registerWidgetTaskHandler(widgetTaskHandler);
}
