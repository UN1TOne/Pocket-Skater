import { useEffect, useState } from "react";
import styled, { css } from "styled-components";
import { useGameStore } from "@/store/useGameStore";
import { PRESET_MAPS } from "@/data/presets";
import { bgUrl } from "@/data/catalog";
import type { CharacterId, RideId } from "@/types/game";
import { Button, Card, Chip, IconButton, Label, Row, Title, safeBottom, safeTop } from "@/ui/primitives";
import { pop, shimmer } from "@/styles/GlobalStyle";
import { useThumbnail } from "@/engine/assets/useThumbnail";
import { getMapThumbnailService } from "@/engine/assets/MapThumbnailService";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

const Wrap = styled.div<{ $translucent: boolean }>`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.modal};
  display: flex;
  flex-direction: column;
  ${({ $translucent }) =>
    $translucent
      ? css`
          background: linear-gradient(180deg, rgba(29, 23, 48, 0.55) 0%, rgba(29, 23, 48, 0.72) 60%, rgba(29, 23, 48, 0.9) 100%);
          backdrop-filter: blur(6px) saturate(1.1);
          -webkit-backdrop-filter: blur(6px) saturate(1.1);
        `
      : css`
          background: url(${bgUrl("dusk")}) center / cover;
        `}
  ${safeTop}
  ${safeBottom}
  padding-left: 18px;
  padding-right: 18px;
`;

const Steps = styled.div`
  display: flex;
  gap: 6px;
  flex: 1;
  margin: 0 12px;
  span {
    flex: 1;
    height: 6px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.18);
    transition: background 0.3s;
    &.done { background: ${({ theme }) => theme.colors.yellow}; }
    &.now { background: ${({ theme }) => theme.colors.orange}; }
  }
`;

const Center = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const H = styled(Title)`
  color: #fff;
  font-size: 34px;
  margin: 0 0 4px;
`;
const Sub = styled.p`
  margin: 0 0 18px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 700;
`;

const Grid = styled.div<{ $cols?: number }>`
  display: grid;
  grid-template-columns: repeat(${({ $cols = 2 }) => $cols}, 1fr);
  gap: 14px;
  overflow-y: auto;
  overflow-x: visible;
  padding: 6px 6px 14px;
  margin: 0 -6px;
  scrollbar-width: none;
`;

const Option = styled(Card)<{ $selected: boolean; $delay?: number }>`
  position: relative;
  padding: 14px;
  display: grid;
  gap: 8px;
  cursor: pointer;
  border-radius: 22px;
  box-shadow: ${({ theme }) => theme.shadow.card};
  transition: transform 0.12s, box-shadow 0.15s;
  animation-delay: ${({ $delay = 0 }) => $delay}ms;
  img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    filter: drop-shadow(0 10px 10px rgba(31, 20, 60, 0.2));
  }
  h3 {
    margin: 0;
    font-family: ${({ theme }) => theme.font.display};
    font-weight: 600;
    font-size: 18px;
  }
  p {
    margin: 0;
    font-size: 12.5px;
    color: ${({ theme }) => theme.colors.inkSoft};
    line-height: 1.3;
  }
  &:active { transform: scale(0.97); }
  ${({ $selected, theme }) =>
    $selected &&
    css`
      box-shadow: 0 0 0 3px ${theme.colors.orange}, ${theme.shadow.pop};
      transform: translateY(-3px);
    `}
`;

const Check = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: ${({ theme }) => theme.colors.green};
  color: #fff;
  font-weight: 900;
  animation: ${pop} 0.3s both;
`;

const MiniMap = styled.div`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  background: #8f88a9;
  display: grid;
  overflow: hidden;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
`;

const RenderedThumb = styled.div<{ $src: string }>`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  background: #8f88a9 url(${(p) => p.$src}) center / cover;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
`;

const Bottom = styled.div`
  margin-top: auto;
  padding-top: 14px;
  display: grid;
  gap: 10px;
`;

const CHARACTERS: Array<{ id: CharacterId; name: string; blurb: string }> = [
  { id: "character-skate-boy", name: "Max", blurb: "Street style. Loves rails and big airs." },
  { id: "character-skate-girl", name: "Juno", blurb: "Bowl rider. Smooth lines, no bails (mostly)." },
];
const RIDES: Array<{ id: RideId; name: string; blurb: string; tag: string }> = [
  { id: "skateboard", name: "Skateboard", blurb: "Classic deck. Fast and grindy.", tag: "Balanced" },
  { id: "scooter", name: "Kickboard", blurb: "Easy to steer, pops a little higher.", tag: "Beginner" },
];

function ModelThumb({ id }: { id: string }) {
  const url = useThumbnail(id);
  return url ? <img src={url} alt="" /> : <ThumbSkeleton aria-hidden="true" />;
}

const ThumbSkeleton = styled.div`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  background: linear-gradient(90deg, #ece6f3 0%, #f8f5fb 50%, #ece6f3 100%) 0 0 / 200% 100%;
  animation: ${shimmer} 1.2s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

/**
 * Map thumbnail. For custom maps we use the Builder's captured PNG (lives on
 * `customMap.thumbnail`). For presets we render once via MapThumbnailService and
 * cache the result in memory for the session. Both fall back to a colored grid
 * mini-preview on first paint before the real render is ready.
 */
function MapThumb({ mapId }: { mapId: string }) {
  const map = useGameStore((s) => s.getMap(mapId));
  const customThumbnail = useGameStore((s) =>
    mapId === "custom" ? s.customMap.thumbnail : undefined,
  );
  const customItemCount = useGameStore((s) => (mapId === "custom" ? s.customMap.items.length : 0));
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!map || mapId === "custom") return;
    let cancelled = false;
    getMapThumbnailService()
      .getThumbnail(map)
      .then((url) => {
        if (!cancelled) setRenderedUrl(url);
      })
      .catch(() => {
        /* fall back to the mini grid */
      });
    return () => {
      cancelled = true;
    };
  }, [map, mapId]);

  const url = mapId === "custom" ? customThumbnail : renderedUrl;
  if (url) return <RenderedThumb $src={url} aria-label={map?.name ?? mapId} />;

  if (!map) return <MiniMap />;
  // Empty custom map: show a hint instead of the colored grid so users know to build.
  if (mapId === "custom" && customItemCount === 0) {
    return (
      <MiniMap style={{ placeItems: "center", color: "#2b2340", fontWeight: 700, fontSize: 11, lineHeight: 1.3, textAlign: "center", padding: 10 }}>
        Build it in<br />the Builder
      </MiniMap>
    );
  }
  const cells = new Map<string, string>();
  for (const it of map.items) {
    const color = it.itemId.startsWith("rail") ? "#4f8dff" : it.itemId.startsWith("bowl") || it.itemId.startsWith("half") ? "#ff8a3d" : it.itemId.startsWith("floor") ? "#b7b0cc" : "#ffd25a";
    cells.set(`${it.x},${it.z}`, color);
  }
  const n = map.size;
  return (
    <MiniMap style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
      {Array.from({ length: n * n }, (_, i) => {
        const x = i % n;
        const z = Math.floor(i / n);
        const c = cells.get(`${x},${z}`);
        return <div key={i} style={{ background: c ?? ((x + z) % 2 ? "#857ea0" : "#8f88a9") }} />;
      })}
    </MiniMap>
  );
}

export function SetupFlow() {
  const step = useGameStore((s) => s.setupStep);
  const setup = useGameStore((s) => s.setup);
  const customCount = useGameStore((s) => s.customMap.items.length);
  const customName = useGameStore((s) => s.customMap.name);
  const { setSetup, setSetupStep, setPage } = useGameStore.getState();
  const [needsBuild, setNeedsBuild] = useState(false);

  // An empty custom park can't be ridden: offer the Builder instead of selecting it.
  const pickMap = (id: string) => {
    if (id === "custom" && customCount === 0) setNeedsBuild(true);
    else setSetup({ mapId: id });
  };

  const maps = [
    ...PRESET_MAPS.map((m) => ({ id: m.id, name: m.name, blurb: m.blurb ?? "", tag: "Preset" })),
    { id: "custom", name: customName, blurb: customCount ? `${customCount} pieces from the Builder.` : "Empty — build something first!", tag: "Custom" },
  ];

  const canNext = step === 0 ? setup.mapId !== null && !(setup.mapId === "custom" && customCount === 0) : true;

  const hasMap = setup.mapId != null && !(setup.mapId === "custom" && customCount === 0);

  return (
    <Wrap $translucent={step > 0 && hasMap}>
      <Row $between>
        <IconButton $tone="dark" onClick={() => (step === 0 ? setPage("landing") : setSetupStep((step - 1) as 0 | 1 | 2))} aria-label="Back">
          ←
        </IconButton>
        <Steps>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < step ? "done" : i === step ? "now" : ""} />
          ))}
        </Steps>
        <Chip $tone="orange">{step + 1} / 3</Chip>
      </Row>

      <Center>
      {step === 0 && (
        <>
          <H>Pick a park</H>
          <Sub>Preset dioramas, or the one you built.</Sub>
          <Grid $cols={2}>
            {maps.map((m, i) => (
              <Option key={m.id} $selected={setup.mapId === m.id} $delay={i * 60} onClick={() => pickMap(m.id)}>
                {setup.mapId === m.id && <Check>✓</Check>}
                <MapThumb mapId={m.id} />
                <h3>{m.name}</h3>
                <p>{m.blurb}</p>
                <Chip $tone={m.tag === "Custom" ? "blue" : "neutral"}>{m.tag}</Chip>
              </Option>
            ))}
          </Grid>
        </>
      )}

      {step === 1 && (
        <>
          <H>Choose your skater</H>
          <Sub>Both can skate, grind and (sometimes) eat pavement.</Sub>
          <Grid $cols={2}>
            {CHARACTERS.map((c, i) => (
              <Option key={c.id} $selected={setup.character === c.id} $delay={i * 60} onClick={() => setSetup({ character: c.id })}>
                {setup.character === c.id && <Check>✓</Check>}
                <ModelThumb id={c.id} />
                <h3>{c.name}</h3>
                <p>{c.blurb}</p>
              </Option>
            ))}
          </Grid>
        </>
      )}

      {step === 2 && (
        <>
          <H>Pick a ride</H>
          <Sub>And decide who's driving.</Sub>
          <Grid $cols={2}>
            {RIDES.map((r, i) => (
              <Option key={r.id} $selected={setup.ride === r.id} $delay={i * 60} onClick={() => setSetup({ ride: r.id })}>
                {setup.ride === r.id && <Check>✓</Check>}
                <ModelThumb id={r.id} />
                <h3>{r.name}</h3>
                <p>{r.blurb}</p>
                <Chip $tone="neutral">{r.tag}</Chip>
              </Option>
            ))}
          </Grid>
          <Label style={{ color: "rgba(255,255,255,0.55)", margin: "16px 0 8px" }}>Play mode</Label>
          <Row $gap={10}>
            <Button $block $variant={setup.mode === "manual" ? "primary" : "ghost"} onClick={() => setSetup({ mode: "manual" })}>
              🎮 Manual
            </Button>
            <Button $block $variant={setup.mode === "ai" ? "blue" : "ghost"} onClick={() => setSetup({ mode: "ai" })}>
              🤖 AI auto-drive
            </Button>
          </Row>
        </>
      )}
      </Center>

      <Bottom>
        <Button $size="lg" $block disabled={!canNext} onClick={() => setSetupStep((step + 1) as 1 | 2 | 3)}>
          {step === 2 ? "Drop in 🛹" : "Next →"}
        </Button>
      </Bottom>
      {needsBuild && (
        <ConfirmDialog
          title="No custom park yet"
          message="You need to build a park before you can ride it. Head to the Builder and make one now?"
          icon={<BuildIcon />}
          onConfirm={() => {
            setNeedsBuild(false);
            setPage("builder");
          }}
          onCancel={() => setNeedsBuild(false)}
        />
      )}
    </Wrap>
  );
}

function BuildIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}
