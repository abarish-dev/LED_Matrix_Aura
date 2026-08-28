import React from "react";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { OverheadWidget } from "@/src/widgets/OverheadWidget";
import { loadOverhead, emptyOverhead } from "@/src/widgets/overheadData";

// Handles the Android widget lifecycle in a headless JS context.
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      // Show a quick placeholder, then fetch live data and re-render.
      props.renderWidget(<OverheadWidget data={emptyOverhead(true)} />);
      const data = await loadOverhead();
      props.renderWidget(<OverheadWidget data={data} />);
      break;
    }
    // OPEN_URI clicks are handled by the OS; nothing to do here.
    default:
      break;
  }
}
