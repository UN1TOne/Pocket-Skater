import styled from "styled-components";
import { useGameStore } from "@/store/useGameStore";
import { bgUrl } from "@/data/catalog";
import { Button, Chip, safeBottom, safeTop } from "@/ui/primitives";
import { float, pop, shimmer } from "@/styles/GlobalStyle";
import { useThumbnail } from "@/engine/assets/useThumbnail";

const Wrap = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: url(${bgUrl("landing")}) center / cover no-repeat;
  ${safeTop}
  ${safeBottom}
  padding-left: 22px;
  padding-right: 22px;
  overflow: hidden;

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(180deg, rgba(43, 35, 64, 0) 55%, rgba(29, 23, 48, 0.78) 100%);
  }
`;

const Top = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Hero = styled.div`
  position: relative;
  z-index: 1;
  text-align: center;
  margin-top: 6vh;
`;

const Logo = styled.h1`
  margin: 0;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  font-size: clamp(54px, 15vw, 76px);
  line-height: 0.92;
  letter-spacing: -2px;
  color: #fff;
  text-shadow:
    0 4px 0 #c44e1c,
    0 8px 0 #8a3312,
    0 16px 30px rgba(60, 20, 10, 0.4);
  transform: rotate(-3deg);
  animation: ${pop} 0.6s cubic-bezier(0.2, 0.9, 0.25, 1.25) both;

  span {
    display: block;
    background: linear-gradient(90deg, #fff 0%, #ffe9b8 40%, #fff 60%, #ffd7c2 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: ${shimmer} 4s linear infinite;
    filter: drop-shadow(0 4px 0 #c44e1c) drop-shadow(0 8px 0 #8a3312);
    text-shadow: none;
  }
`;

const Tagline = styled.p`
  margin: 18px auto 0;
  max-width: 300px;
  font-size: 16px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 2px 10px rgba(60, 20, 60, 0.35);
`;

const Showcase = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  align-items: end;
  margin: 0 auto;
  max-width: 340px;

  img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    filter: drop-shadow(0 18px 18px rgba(40, 10, 40, 0.45));
    animation: ${float} 4.5s ease-in-out infinite;
  }
  img:nth-child(1) { animation-delay: -1s; transform-origin: 50% 100%; }
  img:nth-child(2) { animation-delay: -2.2s; scale: 1.25; }
  img:nth-child(3) { animation-delay: -0.4s; }
`;

const Actions = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  margin-top: 12px;
`;

const Footer = styled.div`
  position: relative;
  z-index: 1;
  margin-top: 14px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  a { color: rgba(255, 255, 255, 0.85); font-weight: 800; text-decoration: none; }
`;

function ShowcaseImg({ id }: { id: string }) {
  const url = useThumbnail(id);
  return url ? <img src={url} alt="" /> : <div style={{ width: "100%", aspectRatio: 1 }} />;
}

export function LandingPage() {
  const setPage = useGameStore((s) => s.setPage);
  const setSetupStep = useGameStore((s) => s.setSetupStep);
  const customCount = useGameStore((s) => s.customMap.items.length);

  return (
    <Wrap>
      <Top>
        <Chip $tone="orange">v0.1</Chip>
      </Top>

      <Hero>
        <Logo>
          POCKET
          <span>SKATER</span>
        </Logo>
        <Tagline>Pocket-sized parks. Big air, tiny bails.</Tagline>
      </Hero>

      <Showcase>
        <ShowcaseImg id="half-pipe" />
        <ShowcaseImg id="character-skate-boy" />
        <ShowcaseImg id="rail-high-curve" />
      </Showcase>

      <div>
        <Actions>
          <Button
            $size="lg"
            $block
            onClick={() => {
              setSetupStep(0);
              setPage("skate");
            }}
          >
            🛹 Skate now
          </Button>
          <Button $size="lg" $block $variant="blue" onClick={() => setPage("builder")}>
            🧱 Build a park
            {customCount > 0 && <Chip $tone="neutral">{customCount} pieces saved</Chip>}
          </Button>
        </Actions>
        <Footer>
          Models &amp; previews by{" "}
          <a href="https://kenney.nl" target="_blank" rel="noreferrer">
            Kenney
          </a>{" "}
          (CC0) · Rendered live with BabylonJS
        </Footer>
      </div>
    </Wrap>
  );
}
