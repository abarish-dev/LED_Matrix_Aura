import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/src/theme";
import SyncFab from "@/src/components/SyncFab";

export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brand,
          tabBarInactiveTintColor: colors.onSurfaceSecondary,
          tabBarStyle: {
            backgroundColor: colors.surfaceSecondary,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 64,
            paddingTop: 6,
            paddingBottom: 8,
          },
          tabBarLabelStyle: {
            fontFamily: fonts.textMedium,
            fontSize: 11,
            letterSpacing: 0.3,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Device",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="hardware-chip-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="flights"
          options={{
            title: "Flights",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="airplane-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="sports"
          options={{
            title: "Sports",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="trophy-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="weather"
          options={{
            title: "Weather",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="thunderstorm-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
      <SyncFab />
    </View>
  );
}
