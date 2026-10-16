import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useGameStore } from "@/store/useGameStore";
import { PRESET_MAPS } from "@/data/presets";
import { Button, CanvasHost, Card, Chip, IconButton, Label, Row, safeTop } from "@/ui/primitives";
import { BuilderScene } from "./BuilderScene";
import { ItemSheet } from "./ItemSheet";
import { DialMenu } from "./DialMenu";
import { BuilderTour } from "./BuilderTour";
import { fadeIn } from "@/styles/GlobalStyle";

const TopBar = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  z-index: ${({ theme }) => theme.z.hud};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 14px;
  ${safeTop}
  pointer-events: none;
  & > * { pointer-events: auto; }
`;

const TitleCard = styled(Card)`
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 12px 0 14px;
  border-radius: 16px;
  animation: none;
  input {
    width: 120px;
    font: inherit;
    font-family: ${({ theme }) => theme.font.display};
    font-weight: 600;
    font-size: 16px;
    border: 0;
    background: transparent;
    color: ${({ theme }) => theme.colors.ink};
    outline: none;
  }
`;

const Loading = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: ${({ theme }) => theme.colors.bg};
  color: #fff;
  font-family: ${({ theme }) => theme.font.display};
  font-size: 18px;
  z-index: 5;
  animation: ${fadeIn} 0.3s;
`;

const Menu = styled(Card)`
  position: absolute;
  top: calc(max(14px, env(safe-area-inset-top)) + 56px);
  right: 14px;
  z-index: ${({ theme }) => theme.z.modal};
  width: 250px;
  padding: 14px;
  display: grid;
  gap: 8px;
`;

export function BuilderPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BuilderScene | null>(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const setPage = useGameStore((s) => s.setPage);
  const count = useGameStore((s) => s.customMap.items.length);
  const name = useGameStore((s) => s.customMap.name);
  const { clearMap, loadPresetIntoBuilder, renameMap, setSetup, setSetupStep, rotateSelection, setBuilderTool, setCustomThumbnail } = useGameStore.getState();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new BuilderScene(canvas);
    sceneRef.current = scene;
    let alive = true;
    scene
      .init()
      .then(() => alive && setReady(true))
      .catch((e) => console.error(e));
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "r") rotateSelection();
      if (e.key.toLowerCase() === "e") setBuilderTool(useGameStore.getState().builderTool === "erase" ? "place" : "erase");
    };
    window.addEventListener("keydown", onKey);
    const closeMenu = () => setMenu(false);
    window.addEventListener("builder:3d-interaction", closeMenu);
    return () => {
      alive = false;
      sceneRef.current = null;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("builder:3d-interaction", closeMenu);
      scene.dispose();
    };
  }, [rotateSelection, setBuilderTool]);

  // Capture a thumbnail of the current park, then run the exit action. Non-blocking on
  // failure so a snapshot bug can't trap users in the Builder.
  const captureThenExit = async (next: () => void) => {
    const scene = sceneRef.current;
    if (scene && useGameStore.getState().customMap.items.length > 0) {
      try {
        const url = await scene.captureSnapshot();
        if (url) setCustomThumbnail(url);
      } catch (e) {
        console.warn("Snapshot failed", e);
      }
    }
    next();
  };

  return (
    <>
      <CanvasHost ref={canvasRef} />
      {!ready && <Loading>Unpacking the toy box…</Loading>}

      <TopBar>
        <IconButton onClick={() => captureThenExit(() => setPage("landing"))} aria-label="Back">
          ←
        </IconButton>
        <TitleCard>
          <input value={name} onChange={(e) => renameMap(e.target.value)} maxLength={18} aria-label="Park name" />
          <Chip $tone="orange">{count} pcs</Chip>
        </TitleCard>
        <IconButton onClick={() => setMenu((m) => !m)} aria-label="Menu" $active={menu}>
          ☰
        </IconButton>
      </TopBar>

      {menu && (
        <Menu>
          <Label>Start from a preset</Label>
          {PRESET_MAPS.map((p) => (
            <Button
              key={p.id}
              $variant="secondary"
              $size="sm"
              $block
              onClick={() => {
                loadPresetIntoBuilder(p.id);
                setMenu(false);
              }}
            >
              {p.name}
            </Button>
          ))}
          <Label style={{ marginTop: 6 }}>Park</Label>
          <Row $gap={8}>
            <Button $variant="danger" $size="sm" onClick={() => clearMap()} style={{ flex: 1 }}>
              Clear
            </Button>
            <Button
              $variant="blue"
              $size="sm"
              style={{ flex: 1 }}
              disabled={count === 0}
              onClick={() =>
                captureThenExit(() => {
                  setSetup({ mapId: "custom" });
                  setSetupStep(1);
                  setPage("skate");
                })
              }
            >
              Skate it ▶
            </Button>
          </Row>
        </Menu>
      )}

      <ItemSheet />
      <DialMenu />
      <MoveModeHint />
      <FloorFillPrompt />
      <BuilderTour />
    </>
  );
}

const PromptScrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.modal};
  background: rgba(10, 6, 24, 0.5);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  animation: ${fadeIn} 0.2s;
`;

const PromptCard = styled(Card)`
  width: min(300px, calc(100% - 48px));
  padding: 22px;
  display: grid;
  gap: 10px;
  text-align: center;
  animation: none;
  h3 { margin: 0; font-family: ${({ theme }) => theme.font.display}; font-size: 20px; }
  p { margin: 0; font-size: 13.5px; line-height: 1.5; color: ${({ theme }) => theme.colors.inkSoft}; }
`;

function FloorFillPrompt() {
  const prompt = useGameStore((s) => s.floorFillPrompt);
  const { setFloorFillPrompt, fillFloorAll } = useGameStore.getState();
  if (!prompt) return null;
  return (
    <PromptScrim onClick={() => setFloorFillPrompt(null)}>
      <PromptCard onClick={(e) => e.stopPropagation()}>
        <h3>Fill the whole floor?</h3>
        <p>You've been brushing a while — cover every cell with this floor at once?</p>
        <Row $gap={10}>
          <Button $block $variant="secondary" onClick={() => setFloorFillPrompt(null)}>Keep brushing</Button>
          <Button $block onClick={() => fillFloorAll(prompt)}>Fill all</Button>
        </Row>
      </PromptCard>
    </PromptScrim>
  );
}

const MoveHintBar = styled.div`
  position: absolute;
  left: 50%;
  top: calc(max(14px, env(safe-area-inset-top)) + 72px);
  transform: translateX(-50%);
  z-index: ${({ theme }) => theme.z.hud};
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(43, 35, 64, 0.86);
  color: #fff;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 600;
  font-size: 13px;
  display: flex;
  gap: 10px;
  align-items: center;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
  button {
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
  }
`;

function MoveModeHint() {
  const movingUid = useGameStore((s) => s.movingPieceUid);
  if (!movingUid) return null;
  return (
    <MoveHintBar>
      Moving piece · tap a cell
      <button onClick={() => useGameStore.setState({ movingPieceUid: null })}>Cancel</button>
    </MoveHintBar>
  );
}
