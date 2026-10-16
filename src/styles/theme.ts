/** Pocket Skater design tokens: warm sunset oranges on dusk purples, chunky toy-like radii. */
export const theme = {
  colors: {
    bg: "#2b2340",
    bgDeep: "#1d1730",
    surface: "rgba(255, 255, 255, 0.94)",
    surfaceDim: "rgba(255, 250, 245, 0.82)",
    glass: "rgba(43, 35, 64, 0.72)",
    ink: "#2b2340",
    inkSoft: "#5c5375",
    inkFaint: "#9a92b3",
    orange: "#ff8a3d",
    orangeDeep: "#f2672b",
    yellow: "#ffd25a",
    blue: "#4f8dff",
    blueDeep: "#3a6fe0",
    green: "#45d483",
    red: "#ff5c6e",
    cream: "#fff5ea",
    line: "rgba(43, 35, 64, 0.08)",
  },
  radius: { sm: "10px", md: "16px", lg: "24px", xl: "32px", pill: "999px" },
  shadow: {
    card: "0 12px 30px rgba(31, 20, 60, 0.18), 0 2px 6px rgba(31, 20, 60, 0.08)",
    pop: "0 18px 40px rgba(255, 110, 50, 0.35)",
    inset: "inset 0 -4px 0 rgba(0,0,0,0.12)",
  },
  font: {
    display: "'Fredoka', 'Nunito', system-ui, sans-serif",
    body: "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  z: { canvas: 0, hud: 10, sheet: 20, modal: 30, toast: 40 },
} as const;

export type AppTheme = typeof theme;

declare module "styled-components" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefaultTheme extends AppTheme {}
}
