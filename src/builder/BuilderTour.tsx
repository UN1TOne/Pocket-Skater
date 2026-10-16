import { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";

const KEY = "pst-tour-builder";

const fade = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;
const pop = keyframes`
  from { opacity: 0; transform: translate(-50%, -46%) scale(0.94); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`;

const Veil = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.modal};
  background: rgba(10, 6, 24, 0.55);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: ${fade} 0.22s ease-out both;
`;

const Card = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(300px, calc(100% - 48px));
  padding: 22px 22px 18px;
  border-radius: 22px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
  text-align: center;
  animation: ${pop} 0.3s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
  display: grid;
  gap: 10px;

  .emoji { font-size: 36px; line-height: 1; }
  h3 {
    margin: 2px 0 0;
    font-family: ${({ theme }) => theme.font.display};
    font-size: 20px;
    color: ${({ theme }) => theme.colors.ink};
    font-weight: 700;
  }
  p {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
    color: ${({ theme }) => theme.colors.inkSoft};
  }
  button {
    margin-top: 6px;
    height: 42px;
    border-radius: 14px;
    font-family: ${({ theme }) => theme.font.display};
    font-weight: 700;
    color: #fff;
    background: linear-gradient(180deg, ${({ theme }) => theme.colors.orange}, ${({ theme }) => theme.colors.orangeDeep});
    box-shadow: 0 6px 0 #c44e1c;
    &:active { transform: translateY(3px); box-shadow: 0 3px 0 #c44e1c; }
  }
`;

/** First-run Builder coach: explains tap/drag/long-press. Dismissed forever once seen. */
export function BuilderTour() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(KEY) !== "1") setShow(true);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };
  return (
    <Veil onClick={dismiss}>
      <Card onClick={(e) => e.stopPropagation()}>
        <div className="emoji">🛹</div>
        <h3>Build your park</h3>
        <p>
          Tap a cell to place the selected tile.<br />
          Drag floor tiles to brush a wide area.<br />
          <strong>Long-press any placed piece</strong> to rotate, copy, move or delete.
        </p>
        <button onClick={dismiss} type="button">Got it</button>
      </Card>
    </Veil>
  );
}
