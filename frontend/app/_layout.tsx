import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, StatusBar } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ToastProvider } from "@/src/components/Toast";
import { MatrixProvider } from "@/src/store/matrix";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = useFonts({
    Barlow: require("../assets/fonts/BarlowCondensed-Regular.ttf"),
    "Barlow-Medium": require("../assets/fonts/BarlowCondensed-Medium.ttf"),
    "Barlow-SemiBold": require("../assets/fonts/BarlowCondensed-SemiBold.ttf"),
    "Barlow-Bold": require("../assets/fonts/BarlowCondensed-Bold.ttf"),
    IBMPlexSans: require("../assets/fonts/IBMPlexSans-Regular.ttf"),
    "IBMPlexSans-Medium": require("../assets/fonts/IBMPlexSans-Medium.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  const iconsReady = iconsLoaded || iconsError;
  const fontsReady = fontsLoaded || fontsError;

  useEffect(() => {
    if (iconsReady && fontsReady) SplashScreen.hideAsync();
  }, [iconsReady, fontsReady]);

  if (!iconsReady || !fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ToastProvider>
            <MatrixProvider>
              <StatusBar barStyle="light-content" backgroundColor={colors.surface} />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
            </MatrixProvider>
          </ToastProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
