import styled, { keyframes } from "styled-components";
import { useEffect, useState } from "react";
import { previewUrl } from "@/data/catalog";
import { shimmer } from "@/styles/GlobalStyle";

/** Logo drops in, a skater sprite rides across with trail dots, then fades to landing. */

const slideAcross = keyframes`
  0% { transform: translateX(-30vw) rotate(-2deg); opacity: 0; }
  8% { opacity: 1; }
  92% { opacity: 1; }
  100% { transform: translateX(130vw) rotate(-2deg); opacity: 1; }
`;

const trailPop = keyframes`
  0% { opacity: 0; transform: translateY(0) scale(0.4); }
  30% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(6px) scale(0.6); }
`;

const titleIn = keyframes`
  0% { transform: translateY(-18px); opacity: 0; letter-spacing: 10px; }
  60% { transform: translateY(2px); opacity: 1; letter-spacing: 2px; }
  100% { transform: translateY(0); opacity: 1; letter-spacing: 2px; }
`;

const subIn = keyframes`
  0% { transform: translateY(10px); opacity: 0; }
  100% { transform: translateY(0); opacity: 0.7; }
`;

const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const Wrap = styled.div<{ $out: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  background:
    radial-gradient(1200px 700px at 20% 10%, rgba(255, 138, 61, 0.25), transparent 60%),
    radial-gradient(900px 700px at 80% 90%, rgba(79, 141, 255, 0.22), transparent 60%),
    linear-gradient(180deg, #1d1730 0%, #0f0b1e 100%);
  display: grid;
  place-items: center;
  pointer-events: ${({ $out }) => ($out ? "none" : "auto")};
  animation: ${({ $out }) => ($out ? fadeOut : "none")} 0.45s ease-out forwards;
`;

const Title = styled.div`
  position: absolute;
  top: 22%;
  width: 100%;
  text-align: center;
  color: #fff;
  font-family: ${({ theme }) => theme.font.display};
  animation: ${titleIn} 0.65s cubic-bezier(0.2, 0.9, 0.25, 1.25) both;

  h1 {
    margin: 0;
    font-size: clamp(44px, 10vw, 72px);
    font-weight: 700;
    letter-spacing: 2px;
    line-height: 0.95;
    background: linear-gradient(90deg, #fff 0%, #ffe9b8 40%, #fff 60%, #ffd7c2 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 0 #c44e1c) drop-shadow(0 10px 24px rgba(255, 110, 50, 0.35));
    animation: ${shimmer} 4s linear infinite;
  }
  small {
    display: block;
    margin-top: 10px;
    font-family: ${({ theme }) => theme.font.body};
    font-weight: 800;
    letter-spacing: 3px;
    font-size: 12px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.7);
    animation: ${subIn} 0.5s 0.3s both;
  }
`;

const Rider = styled.img`
  position: absolute;
  top: 56%;
  left: 0;
  width: clamp(90px, 18vw, 150px);
  height: auto;
  filter: drop-shadow(0 18px 20px rgba(0, 0, 0, 0.45));
  animation: ${slideAcross} 4.2s cubic-bezier(0.33, 0.1, 0.5, 1) both;
  animation-delay: 0.4s;
`;

const Trail = styled.div`
  position: absolute;
  top: calc(56% + clamp(70px, 15vw, 118px));
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 14px;
`;

const Dot = styled.span<{ $delay: number }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(180deg, #ffd25a, #ff8a3d);
  box-shadow: 0 2px 6px rgba(255, 138, 61, 0.5);
  animation: ${trailPop} 1.4s ${({ $delay }) => $delay}s infinite;
  animation-delay: ${({ $delay }) => 0.5 + $delay}s;
`;

const Loader = styled.div`
  position: absolute;
  bottom: 10%;
  text-align: center;
  font-family: ${({ theme }) => theme.font.body};
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 2px;
  animation: ${subIn} 0.6s 0.6s both;
`;

const DURATION = 4600;

export function Splash({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);

  useEffect(() => {
    const startFade = window.setTimeout(() => setOut(true), DURATION);
    const unmount = window.setTimeout(onDone, DURATION + 450);
    return () => {
      clearTimeout(startFade);
      clearTimeout(unmount);
    };
  }, [onDone]);

  return (
    <Wrap $out={out} onClick={() => setOut(true)}>
      <Title>
        <h1>POCKET SKATER</h1>
        <small>Tiny parks · Big air</small>
      </Title>
      <Rider src={previewUrl("character-skate-boy")} alt="" draggable={false} />
      <Trail>
        {[0, 0.1, 0.2, 0.3, 0.4].map((d, i) => (
          <Dot key={i} $delay={d} />
        ))}
      </Trail>
      <Loader>LOADING</Loader>
    </Wrap>
  );
}
