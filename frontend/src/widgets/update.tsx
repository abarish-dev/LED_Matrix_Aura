// App-side helper to push fresh data into the Android widget while the app is
// open. No-op on web / iOS. Uses require() inside the Android guard so the
// widget library is never evaluated on other platforms.
import React from "react";
import { Platform } from "react-native";
import type { Plane } from "@/src/services/adsb";

function nowLabel(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export async function refreshOverheadWidget(plane?: Plane | null, located = true): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const { requestWidgetUpdate } = require("react-native-android-widget");
    const { OverheadWidget } = require("@/src/widgets/OverheadWidget");
    const data = plane
      ? {
          ok: true,
          located: true,
          callsign: plane.callsign,
          airline: plane.airlineName || "",
          altFt: plane.altFt,
          distanceMi: plane.distanceMi,
          heading: plane.headingDeg,
          updated: nowLabel(),
        }
      : {
          ok: false,
          located,
          callsign: "",
          airline: "",
          altFt: 0,
          distanceMi: 0,
          heading: -1,
          updated: nowLabel(),
        };
    await requestWidgetUpdate({
      widgetName: "Overhead",
      renderWidget: () => <OverheadWidget data={data} />,
      widgetNotFound: () => {},
    });
  } catch {
    /* widget not added / library unavailable */
  }
}
