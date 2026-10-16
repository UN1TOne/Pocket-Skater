import { useEffect, useState } from "react";
import { ThemeProvider } from "styled-components";
import { theme } from "@/styles/theme";
import { GlobalStyle } from "@/styles/GlobalStyle";
import { useGameStore } from "@/store/useGameStore";
import { Stage } from "@/ui/primitives";
import { LandingPage } from "@/landing/LandingPage";
import { Splash } from "@/landing/Splash";
import { BuilderPage } from "@/builder/BuilderPage";
import { SkatePage } from "@/skate/SkatePage";
import { CATALOG } from "@/data/catalog";
import { PRESET_MAPS } from "@/data/presets";
import { getThumbnailService } from "@/engine/assets/ThumbnailService";
import { getMapThumbnailService } from "@/engine/assets/MapThumbnailService";

export default function App() {
  const page = useGameStore((s) => s.page);
  const [showSplash, setShowSplash] = useState(true);

  // Pre-render thumbnails in the background while the splash is up, so the Builder/Setup
  // tiles are already cached by the time the user opens them. Skaters and rides go first:
  // queued behind the ~60-piece catalog they used to pop in late on the Setup screen.
  useEffect(() => {
    const svc = getThumbnailService();
    const riders = ["character-skate-boy", "character-skate-girl", "skateboard", "scooter"];
    const ridersReady = Promise.all(riders.map((id) => svc.getThumbnail(id).catch(() => undefined)));
    // Preset park previews are full scene renders; start them once the rider tiles are done
    // so the two offscreen engines don't fight over the main thread.
    void ridersReady.then(() => {
      const maps = getMapThumbnailService();
      for (const m of PRESET_MAPS) void maps.getThumbnail(m).catch(() => undefined);
    });
    for (const c of CATALOG) void svc.getThumbnail(c.id).catch(() => undefined);
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <Stage>
        <div className="frame">
          {page === "landing" && <LandingPage />}
          {page === "builder" && <BuilderPage />}
          {page === "skate" && <SkatePage />}
        </div>
      </Stage>
      {showSplash && <Splash onDone={() => setShowSplash(false)} />}
    </ThemeProvider>
  );
}
