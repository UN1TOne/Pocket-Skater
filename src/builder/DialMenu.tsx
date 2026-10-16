import { useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";
import { useGameStore } from "@/store/useGameStore";

/** Right-side fan dial (12/2/4/6 o'clock) with a small close button at the pivot. */

const RADIUS = 86;

interface Action {
  key: "move" | "rotate" | "copy" | "remove";
  label: string;
  color: string;
  icon: JSX.Element;
}

const spinIn = keyframes`
  0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
  70% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
`;

const labelIn = keyframes`
  from { opacity: 0; transform: translate(-50%, 4px); }
  to { opacity: 1; transform: translate(-50%, 0); }
`;

const Veil = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.modal};
  background: transparent;
  /* Taps pass through to the scene below so Move/Copy cell selections still work. */
  pointer-events: none;
  & > * { pointer-events: auto; }
`;

const Petal = styled.button<{ $x: number; $y: number; $delay: number; $color: string }>`
  position: absolute;
  left: ${({ $x }) => $x}px;
  top: ${({ $y }) => $y}px;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  animation: ${spinIn} 0.3s cubic-bezier(0.2, 0.9, 0.25, 1.4) forwards;
  animation-delay: ${({ $delay }) => $delay}ms;
  background: ${({ $color }) => $color};
  color: #fff;
  box-shadow: 0 10px 22px rgba(31, 20, 60, 0.3), inset 0 0 0 1.5px rgba(255, 255, 255, 0.22);
  display: grid;
  place-items: center;
  transition: filter 0.12s;

  &:hover { filter: brightness(1.08); }
  &:active { filter: brightness(0.9); }

  svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
`;

const Close = styled.button<{ $x: number; $y: number }>`
  position: absolute;
  left: ${({ $x }) => $x}px;
  top: ${({ $y }) => $y}px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  animation: ${spinIn} 0.24s cubic-bezier(0.2, 0.9, 0.25, 1.3) forwards;
  animation-delay: 40ms;
  background: rgba(43, 35, 64, 0.92);
  color: rgba(255, 255, 255, 0.78);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.3), inset 0 0 0 1.5px rgba(255, 255, 255, 0.18);
  display: grid;
  place-items: center;
  transition: color 0.1s, background 0.1s;

  &:hover { color: #fff; background: rgba(60, 50, 90, 0.95); }

  svg { width: 12px; height: 12px; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; fill: none; }
`;

const Caption = styled.div<{ $x: number; $y: number }>`
  position: absolute;
  left: ${({ $x }) => $x}px;
  top: ${({ $y }) => $y}px;
  transform: translate(-50%, 0);
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-family: ${({ theme }) => theme.font.display};
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
  pointer-events: none;
  animation: ${labelIn} 0.15s ease-out both;
`;

const actions: Action[] = [
  {
    key: "move",
    label: "Move",
    color: "linear-gradient(180deg, #a680ff, #7a52d8)",
    icon: (
      <svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" /><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /></svg>
    ),
  },
  {
    key: "rotate",
    label: "Rotate",
    color: "linear-gradient(180deg, #ffd25a, #ff8a3d)",
    icon: (
      <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.5 5.8" /><path d="M3 18V13H8" /></svg>
    ),
  },
  {
    key: "copy",
    label: "Copy",
    color: "linear-gradient(180deg, #78c7ff, #4f8dff)",
    icon: (
      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M8 20h10a2 2 0 0 0 2-2V8" /></svg>
    ),
  },
  {
    key: "remove",
    label: "Delete",
    color: "linear-gradient(180deg, #ff8894, #e9445a)",
    icon: (
      <svg viewBox="0 0 24 24"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></svg>
    ),
  },
];

export function DialMenu() {
  const dial = useGameStore((s) => s.activeDial);
  const { setActiveDial, rotatePiece, removePiece, startCopyPiece, startMovePiece } = useGameStore.getState();
  const [hover, setHover] = useState<Action["key"] | null>(null);

  useEffect(() => {
    if (!dial) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveDial(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dial, setActiveDial]);

  useEffect(() => {
    setHover(null);
  }, [dial?.uid, dial?.x, dial?.y]);

  const positions = useMemo(() => {
    if (!dial) return [];
    const clock = { move: -90, rotate: -30, copy: 30, remove: 90 } as const;
    return actions.map((a) => {
      const a0 = (clock[a.key] * Math.PI) / 180;
      return { action: a, x: dial.x + Math.cos(a0) * RADIUS, y: dial.y + Math.sin(a0) * RADIUS };
    });
  }, [dial]);

  if (!dial) return null;

  const act = (key: Action["key"]) => {
    if (key === "rotate") rotatePiece(dial.uid);
    else if (key === "remove") removePiece(dial.uid);
    else if (key === "copy") startCopyPiece(dial.uid);
    else if (key === "move") startMovePiece(dial.uid);
  };

  const hovered = positions.find((p) => p.action.key === hover);
  // Close button sits at the fan pivot (where the center dot used to be).
  const closeX = dial.x;
  const closeY = dial.y;

  return (
    <Veil>
      <Close
        $x={closeX}
        $y={closeY}
        onClick={() => setActiveDial(null)}
        aria-label="Close dial"
        title="Close"
      >
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </Close>
      {positions.map((p, i) => (
        <Petal
          key={p.action.key}
          $x={p.x}
          $y={p.y}
          $delay={60 + i * 55}
          $color={p.action.color}
          onClick={() => act(p.action.key)}
          onMouseEnter={() => setHover(p.action.key)}
          onMouseLeave={() => setHover((h) => (h === p.action.key ? null : h))}
          aria-label={p.action.label}
          title={p.action.label}
        >
          {p.action.icon}
        </Petal>
      ))}
      {hovered && (
        <Caption $x={hovered.x} $y={hovered.y + 42}>
          {hovered.action.label}
        </Caption>
      )}
    </Veil>
  );
}
