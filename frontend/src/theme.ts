// Design tokens for "Aura" — Dark-First Utility / hardware command-center.
// Sourced from /app/design_guidelines.json. Zinc surfaces + Amber (LED glow) accent.

export const colors = {
  surface: "#09090b",
  onSurface: "#fafafa",
  surfaceSecondary: "#18181b",
  onSurfaceSecondary: "#a1a1aa",
  surfaceTertiary: "#27272a",
  onSurfaceTertiary: "#d4d4d8",
  surfaceInverse: "#fafafa",
  onSurfaceInverse: "#09090b",

  brand: "#f59e0b",
  brandPrimary: "#f59e0b",
  onBrandPrimary: "#000000",
  brandSecondary: "#d97706",
  onBrandSecondary: "#ffffff",
  brandTertiary: "#381e02",
  onBrandTertiary: "#fde68a",

  success: "#10b981",
  onSuccess: "#022c22",
  warning: "#eab308",
  onWarning: "#422006",
  error: "#ef4444",
  onError: "#450a0a",
  info: "#0ea5e9",
  onInfo: "#082f49",

  border: "#27272a",
  borderStrong: "#3f3f46",
  divider: "#27272a",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

// Font family keys — must match the names registered in _layout.tsx useFonts().
export const fonts = {
  display: "Barlow-SemiBold",
  displayBold: "Barlow-Bold",
  displayMedium: "Barlow-Medium",
  displayRegular: "Barlow",
  text: "IBMPlexSans",
  textMedium: "IBMPlexSans-Medium",
  mono: "SpaceMono",
} as const;

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
} as const;
