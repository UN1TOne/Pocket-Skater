import { useEffect, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { useGameStore } from "@/store/useGameStore";
import { attachKeyboard } from "@/engine/input";
import { Button, CanvasHost, Card, Chip, IconButton, Label, Row, safeBottom, safeTop } from "@/ui/primitives";
import { fadeIn } from "@/styles/GlobalStyle";
import { SkateScene } from "./SkateScene";
import { SetupFlow } from "./SetupFlow";
import { MapPreviewScene } from "./MapPreviewScene";
import { JumpButton, VirtualJoystick } from "./VirtualJoystick";

const Hud = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.hud};
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  ${safeTop}
  ${safeBottom}
  padding-left: 14px;
  padding-right: 14px;
  & button, & [data-touch] { pointer-events: auto; }
`;

const Score = styled(Card)`
  display: grid;
  gap: 2px;
  padding: 8px 14px;
  min-width: 110px;
  border-radius: 18px;
  animation: none;
  strong {
    font-family: ${({ theme }) => theme.font.display};
    font-size: 26px;
    line-height: 1;
    color: ${({ theme }) => theme.colors.orangeDeep};
    font-variant-numeric: tabular-nums;
  }
`;

const Speed = styled.div<{ $pct: number }>`
  height: 6px;
  border-radius: 99px;
  background: #ece8f3;
  overflow: hidden;
  &::after {
    content: "";
    display: block;
    height: 100%;
    width: ${({ $pct }) => Math.round($pct * 100)}%;
    background: linear-gradient(90deg, #4f8dff, #ffd25a, #ff8a3d);
    transition: width 0.1s linear;
  }
`;

const popToast = keyframes`
  0% { transform: translateX(-50%) scale(0.92) translateY(8px); opacity: 0; }
  60% { transform: translateX(-50%) scale(1.03) translateY(-2px); opacity: 1; }
  100% { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
`;

const Toast = styled.div<{ $tone: "grind" | "ai" }>`
  position: absolute;
  left: 50%;
  top: 22%;
  padding: 10px 18px;
  border-radius: 999px;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  font-size: 20px;
  color: #fff;
  transform: translateX(-50%);
  animation: ${popToast} 0.3s both;
  ${({ $tone }) =>
    ({
      grind: css` background: linear-gradient(180deg, #ffd25a, #ff8a3d); text-shadow: 0 2px 0 rgba(0,0,0,0.2); `,
      ai: css` background: rgba(43, 35, 64, 0.8); font-size: 15px; `,
    })[$tone]}
`;

const popCentered = keyframes`
  0% { transform: translate(-50%, -50%) scale(0.92); opacity: 0; }
  60% { transform: translate(-50%, -50%) scale(1.03); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
`;

const scrimIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;
const scrimOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;
const infoIn = keyframes`
  from { opacity: 0; transform: translate(-50%, -46%) scale(0.95); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`;
const infoOut = keyframes`
  from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  to { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
`;

const InfoScrim = styled.div<{ $exiting: boolean }>`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.modal};
  background: rgba(10, 6, 24, 0.4);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: ${({ $exiting }) => ($exiting ? scrimOut : scrimIn)} ${({ $exiting }) => ($exiting ? "150ms" : "220ms")} ease-out both;
`;

const InfoCard = styled.div<{ $exiting: boolean }>`
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(280px, calc(100% - 48px));
  padding: 20px 22px 18px;
  border-radius: 22px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
  color: ${({ theme }) => theme.colors.ink};
  transform: translate(-50%, -50%);
  animation: ${({ $exiting }) => ($exiting ? infoOut : infoIn)}
    ${({ $exiting }) => ($exiting ? "150ms cubic-bezier(0.4, 0, 1, 1)" : "240ms cubic-bezier(0.2, 0.9, 0.25, 1.2)")} both;

  h3 { margin: 0 0 10px; font-family: ${({ theme }) => theme.font.display}; font-size: 18px; }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    font-size: 13.5px;
    color: ${({ theme }) => theme.colors.inkSoft};
  }
  li strong {
    font-family: ${({ theme }) => theme.font.display};
    font-weight: 700;
    color: ${({ theme }) => theme.colors.ink};
    font-variant-numeric: tabular-nums;
  }
  li.penalty strong { color: ${({ theme }) => theme.colors.red}; }
`;

const HelpBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.inkSoft};
  box-shadow: 0 4px 10px rgba(31, 20, 60, 0.15), inset 0 0 0 1px ${({ theme }) => theme.colors.line};
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  font-size: 15px;
  transition: transform 0.1s, color 0.15s;
  &:hover { color: ${({ theme }) => theme.colors.ink}; }
  &:active { transform: scale(0.92); }
`;

const BailScrim = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 70% at 50% 60%, transparent 55%, rgba(185, 20, 40, 0.35) 100%),
    radial-gradient(50% 30% at 50% 30%, rgba(255, 220, 220, 0.12), transparent 80%);
  animation: ${fadeIn} 0.18s;
`;

const BailCard = styled.div`
  position: absolute;
  left: 50%;
  top: 32%;
  display: grid;
  gap: 4px;
  justify-items: center;
  padding: 12px 22px 14px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 240, 240, 0.94));
  box-shadow: 0 20px 50px rgba(185, 20, 40, 0.35), inset 0 0 0 1.5px rgba(255, 255, 255, 0.4);
  color: ${({ theme }) => theme.colors.ink};
  transform: translate(-50%, -50%);
  animation: ${popCentered} 0.35s cubic-bezier(0.2, 0.9, 0.25, 1.25) both;
  min-width: 180px;
  text-align: center;

  .glyph {
    font-size: 30px;
    line-height: 1;
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.15));
  }
  h3 {
    margin: 2px 0 0;
    font-family: ${({ theme }) => theme.font.display};
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: ${({ theme }) => theme.colors.red};
  }
  small {
    font-family: ${({ theme }) => theme.font.body};
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: ${({ theme }) => theme.colors.inkFaint};
  }
`;

const Controls = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  @media (hover: hover) and (pointer: fine) { display: none; }
`;

const Loading = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.modal};
  display: grid;
  place-items: center;
  gap: 8px;
  background: ${({ theme }) => theme.colors.bg};
  color: #fff;
  font-family: ${({ theme }) => theme.font.display};
  font-size: 20px;
  animation: ${fadeIn} 0.2s;
  div { display: grid; gap: 6px; justify-items: center; }
  small { font-family: ${({ theme }) => theme.font.body}; font-weight: 700; color: rgba(255,255,255,0.55); }
`;

const PauseMenu = styled(Card)`
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: ${({ theme }) => theme.z.modal};
  width: 260px;
  padding: 18px;
  display: grid;
  gap: 10px;
  text-align: center;
  transform: translate(-50%, -50%);
  animation: ${popCentered} 0.35s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
  h2 { margin: 0 0 4px; font-family: ${({ theme }) => theme.font.display}; }

  /* Separate the exit action from the two in-session controls with extra space + hairline. */
  .quit-divider {
    margin: 10px -6px -2px;
    height: 1px;
    background: ${({ theme }) => theme.colors.line};
  }
`;

const KeyHint = styled.div`
  display: none;
  @media (hover: hover) and (pointer: fine) {
    display: block;
    font-size: 12px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.75);
    text-align: center;
    margin-bottom: 8px;
    kbd { background: rgba(255,255,255,0.18); padding: 1px 6px; border-radius: 6px; margin: 0 1px; }
  }
`;

export function SkatePage() {
  const step = useGameStore((s) => s.setupStep);
  return (
    <>
      {step < 3 ? <PreviewBackdrop /> : <Gameplay />}
      {step < 3 && <SetupFlow />}
    </>
  );
}

/** Slowly orbiting iso preview of the chosen map, blurred behind the picker. */
function PreviewBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapId = useGameStore((s) => s.setup.mapId);
  const getMap = useGameStore((s) => s.getMap);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map = getMap(mapId);
    if (!canvas || !map) return;
    const scene = new MapPreviewScene(canvas);
    let alive = true;
    scene.init(map).catch((e) => console.warn("preview failed", e));
    return () => {
      alive = false;
      void alive;
      scene.dispose();
    };
  }, [mapId, getMap]);

  if (!mapId) return null;
  return <CanvasHost ref={canvasRef} style={{ filter: "blur(14px)", transform: "scale(1.08)", opacity: 0.85 }} />;
}

function Gameplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SkateScene | null>(null);
  const [progress, setProgress] = useState<string>("Loading…");
  const [error, setError] = useState<string | null>(null);
  const hud = useGameStore((s) => s.hud);
  const setup = useGameStore((s) => s.setup);
  const paused = useGameStore((s) => s.paused);
  const { setHud, setPaused, setPage, setSetupStep, setSetup, getMap } = useGameStore.getState();
  const [toast, setToast] = useState<{ text: string; tone: "grind" | "ai" } | null>(null);
  const [showScoreInfo, setShowScoreInfo] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map = getMap(setup.mapId);
    if (!canvas || !map) return;
    setHud({ speed: 0, airtime: 0, score: 0, grinding: false, bailed: false });
    const scene = new SkateScene({
      canvas,
      map,
      character: setup.character,
      ride: setup.ride,
      mode: setup.mode,
      onHud: setHud,
      onProgress: setProgress,
    });
    sceneRef.current = scene;
    scene.init().catch((e) => {
      console.error(e);
      setError(String(e?.message ?? e));
    });
    const detachKeys = attachKeyboard();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaused(!useGameStore.getState().paused);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      detachKeys();
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scene is built once per session
  }, []);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.paused = paused;
  }, [paused]);

  useEffect(() => {
    sceneRef.current?.setMode(setup.mode);
    if (!progress) {
      setToast({ text: setup.mode === "ai" ? "🤖 AI is riding — sit back" : "🎮 You're in control", tone: "ai" });
      const t = setTimeout(() => setToast(null), 1800);
      return () => clearTimeout(t);
    }
  }, [setup.mode, progress]);

  useEffect(() => {
    if (hud.grinding) setToast({ text: "✨ GRIND!", tone: "grind" });
    else setToast((t) => (t?.tone === "ai" ? t : null));
  }, [hud.grinding]);

  const quit = () => {
    setPaused(false);
    setSetupStep(0);
    setPage("landing");
  };

  return (
    <>
      <CanvasHost ref={canvasRef} />
      {progress && !error && (
        <Loading>
          <div>
            <span>🛹</span>
            {progress}
            <small>Havok physics · Recast navmesh · toon post-fx</small>
          </div>
        </Loading>
      )}
      {error && (
        <Loading>
          <div>
            Something went wrong
            <small>{error}</small>
            <Button $variant="secondary" onClick={quit}>Back to menu</Button>
          </div>
        </Loading>
      )}

      <Hud>
        <Row $between>
          <Row $gap={8}>
            <Score>
              <Label>Score</Label>
              <strong>{Math.floor(hud.score)}</strong>
              <Speed $pct={Math.min(1, hud.speed / 5.5)} />
            </Score>
            <HelpBtn onClick={() => setShowScoreInfo(true)} aria-label="How scoring works" title="Scoring">?</HelpBtn>
          </Row>
          <Row $gap={8}>
            <Chip $tone={setup.mode === "ai" ? "blue" : "orange"}>{setup.mode === "ai" ? "🤖 AI" : "🎮 Manual"}</Chip>
            <IconButton onClick={() => setSetup({ mode: setup.mode === "ai" ? "manual" : "ai" })} aria-label="Toggle mode" title="Toggle AI auto-drive">
              {setup.mode === "ai" ? "🎮" : "🤖"}
            </IconButton>
            <IconButton onClick={() => setPaused(true)} aria-label="Pause">
              ❚❚
            </IconButton>
          </Row>
        </Row>

        {toast && <Toast $tone={toast.tone}>{toast.text}</Toast>}
        {hud.bailed && (
          <>
            <BailScrim />
            <BailCard>
              <div className="glyph">🩹</div>
              <h3>Wiped out</h3>
              <small>Respawning…</small>
            </BailCard>
          </>
        )}

        <div>
          <KeyHint>
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows to ride · <kbd>Space</kbd> to jump · <kbd>Esc</kbd> pause
          </KeyHint>
          {setup.mode === "manual" && (
            <Controls>
              <div data-touch><VirtualJoystick /></div>
              <div data-touch><JumpButton /></div>
            </Controls>
          )}
        </div>
      </Hud>

      {paused && (
        <PauseMenu>
          <h2>Paused</h2>
          <Button $block onClick={() => setPaused(false)}>Resume</Button>
          <Button $block $variant="secondary" onClick={() => { setPaused(false); setSetupStep(0); }}>Change park</Button>
          <div className="quit-divider" aria-hidden />
          <Button
            $block
            $variant="ghost"
            style={{ color: "#8f88a9", boxShadow: "inset 0 0 0 1.5px #ebe6f0" }}
            onClick={quit}
          >
            Quit to menu
          </Button>
        </PauseMenu>
      )}

      {showScoreInfo && <ScoreInfo onClose={() => setShowScoreInfo(false)} />}
    </>
  );
}

/**
 * Smooth fade/scale enter+exit around the dismiss action: the `exiting` flag flips
 * the keyframes, and we actually unmount only after the exit duration so the
 * animation completes before the DOM disappears.
 */
function ScoreInfo({ onClose }: { onClose: () => void }) {
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleClose = () => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(onClose, 160);
  };
  return (
    <InfoScrim $exiting={exiting} onClick={handleClose}>
      <InfoCard $exiting={exiting} onClick={(e) => e.stopPropagation()}>
        <h3>How scoring works</h3>
        <ul>
          <li><span>Grinding a rail / ledge</span><strong>+12 / sec</strong></li>
          <li><span>Clean landing (airtime)</span><strong>+40 × seconds</strong></li>
          <li className="penalty"><span>Wipe out</span><strong>−50</strong></li>
        </ul>
      </InfoCard>
    </InfoScrim>
  );
}
