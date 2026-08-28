import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";
import { compass } from "@/src/services/adsb";
import type { OverheadData } from "./overheadData";

const BG = "#14171d";
const CHIP = "#2a2205";
const AMBER = "#f59e0b";
const TEXT = "#f4f4f5";
const SUB = "#a1a1aa";
const FAINT = "#6b7280";

function metaLine(d: OverheadData): string {
  const parts: string[] = [];
  if (d.altFt) parts.push(`${d.altFt.toLocaleString()} ft`);
  if (d.distanceMi) parts.push(`${d.distanceMi} mi`);
  const c = compass(d.heading);
  if (c) parts.push(c);
  return parts.join("   ·   ") || "—";
}

/** Medium (wide) Android widget showing the nearest overhead flight. */
export function OverheadWidget({ data }: { data: OverheadData }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: "auratwo://flights" }}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: BG,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <FlexWidget
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: CHIP,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 14,
        }}
      >
        <TextWidget text="✈" style={{ fontSize: 24, color: AMBER }} />
      </FlexWidget>

      <FlexWidget style={{ flex: 1, flexDirection: "column" }}>
        <TextWidget text="OVERHEAD NOW" style={{ fontSize: 10, color: AMBER }} />
        {data.ok ? (
          <FlexWidget style={{ flexDirection: "column" }}>
            <TextWidget
              text={data.airline ? `${data.callsign}  ·  ${data.airline}` : data.callsign}
              style={{ fontSize: 17, color: TEXT, fontWeight: "700", marginTop: 2 }}
              maxLines={1}
            />
            <TextWidget text={metaLine(data)} style={{ fontSize: 13, color: SUB, marginTop: 2 }} maxLines={1} />
          </FlexWidget>
        ) : (
          <TextWidget
            text={data.located ? "No aircraft overhead right now" : "Set your location in the app"}
            style={{ fontSize: 15, color: SUB, marginTop: 3 }}
            maxLines={2}
          />
        )}
        <TextWidget text={`Updated ${data.updated}`} style={{ fontSize: 10, color: FAINT, marginTop: 5 }} />
      </FlexWidget>
    </FlexWidget>
  );
}
