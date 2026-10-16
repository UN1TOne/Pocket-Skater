import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import styled from "styled-components";
import { pressJump, releaseJump, setJoystick } from "@/engine/input";

const R = 62; // base radius
const KNOB = 52;

const Base = styled.div`
  position: relative;
  width: ${R * 2}px;
  height: ${R * 2}px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.28), 0 10px 30px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  touch-action: none;
  &::before {
    content: "";
    position: absolute;
    inset: 18px;
    border-radius: 50%;
    border: 2px dashed rgba(255, 255, 255, 0.25);
  }
`;

const Knob = styled.div<{ $x: number; $y: number; $active: boolean }>`
  position: absolute;
  left: 50%;
  top: 50%;
  width: ${KNOB}px;
  height: ${KNOB}px;
  margin: ${-KNOB / 2}px 0 0 ${-KNOB / 2}px;
  border-radius: 50%;
  background: linear-gradient(180deg, #ffb27a, #ff8a3d);
  box-shadow: 0 6px 0 #c44e1c, 0 10px 20px rgba(255, 138, 61, 0.45);
  transform: translate(${({ $x }) => $x}px, ${({ $y }) => $y}px) scale(${({ $active }) => ($active ? 1.08 : 1)});
  transition: ${({ $active }) => ($active ? "none" : "transform 0.18s cubic-bezier(0.2, 0.9, 0.25, 1.3)")};
  pointer-events: none;
`;

export function VirtualJoystick() {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const pid = useRef<number | null>(null);

  const apply = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const max = R - 14;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    setPos({ x: dx, y: dy });
    const nx = dx / max;
    const ny = -dy / max;
    // deadzone + slight curve for finer low-speed control
    const mag = Math.hypot(nx, ny);
    const curved = mag < 0.08 ? 0 : Math.pow((mag - 0.08) / 0.92, 1.3);
    setJoystick(mag > 0 ? (nx / mag) * curved : 0, mag > 0 ? (ny / mag) * curved : 0, true);
  };

  return (
    <Base
      ref={ref}
      onPointerDown={(e) => {
        pid.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setActive(true);
        apply(e);
      }}
      onPointerMove={(e) => {
        if (pid.current === e.pointerId) apply(e);
      }}
      onPointerUp={(e) => {
        if (pid.current !== e.pointerId) return;
        pid.current = null;
        setActive(false);
        setPos({ x: 0, y: 0 });
        setJoystick(0, 0, false);
      }}
      onPointerCancel={() => {
        pid.current = null;
        setActive(false);
        setPos({ x: 0, y: 0 });
        setJoystick(0, 0, false);
      }}
    >
      <Knob $x={pos.x} $y={pos.y} $active={active} />
    </Base>
  );
}

const JumpBtn = styled.button<{ $down: boolean }>`
  width: 92px;
  height: 92px;
  border-radius: 50%;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  font-size: 18px;
  color: #fff;
  background: linear-gradient(180deg, #6ea2ff, #3a6fe0);
  box-shadow: ${({ $down }) => ($down ? "0 2px 0 #2a52b0" : "0 8px 0 #2a52b0, 0 16px 30px rgba(58, 111, 224, 0.45)")};
  transform: translateY(${({ $down }) => ($down ? 6 : 0)}px);
  transition: transform 0.06s, box-shadow 0.06s;
  touch-action: none;
`;

export function JumpButton() {
  const [down, setDown] = useState(false);
  return (
    <JumpBtn
      $down={down}
      onPointerDown={(e) => {
        e.preventDefault();
        setDown(true);
        pressJump();
      }}
      onPointerUp={() => {
        setDown(false);
        releaseJump();
      }}
      onPointerCancel={() => {
        setDown(false);
        releaseJump();
      }}
      onPointerLeave={() => {
        if (down) {
          setDown(false);
          releaseJump();
        }
      }}
      aria-label="Jump"
    >
      JUMP
    </JumpBtn>
  );
}
