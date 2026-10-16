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
import { getThumbnailService } from "@/engine/assets/ThumbnailService";

export default function App() {
  const page = useGameStore((s) => s.page);
  const [showSplash, setShowSplash] = useState(true);

  // Pre-render thumbnails in the background while the splash is up, so the Builder/Setup
  // tiles are already cached by the time the user opens them.
  useEffect(() => {
    const svc = getThumbnailService();
    const ids = [
      ...CATALOG.map((c) => c.id),
      "character-skate-boy",
      "character-skate-girl",
      "skateboard",
      "scooter",
    ];
    for (const id of ids) void svc.getThumbnail(id).catch(() => undefined);
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
