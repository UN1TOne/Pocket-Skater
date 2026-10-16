import styled, { css } from "styled-components";
import { pop } from "@/styles/GlobalStyle";

/** Portrait-first stage: fills the viewport on portrait, letterboxes to 9:16 on landscape/desktop. */
export const Stage = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.bgDeep};

  & > .frame {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: ${({ theme }) => theme.colors.bg};
  }

  @media (min-aspect-ratio: 1/1) {
    background:
      radial-gradient(1200px 600px at 20% 0%, rgba(255, 138, 61, 0.18), transparent 60%),
      radial-gradient(900px 600px at 90% 100%, rgba(79, 141, 255, 0.15), transparent 60%),
      ${({ theme }) => theme.colors.bgDeep};
    & > .frame {
      width: min(520px, calc(100dvh * 9 / 16));
      height: min(100dvh, calc(520px * 16 / 9));
      max-height: 100dvh;
      border-radius: 20px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04);
    }
  }
`;

export const CanvasHost = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

type Variant = "primary" | "secondary" | "ghost" | "danger" | "blue";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, ReturnType<typeof css>> = {
  primary: css`
    color: #fff;
    background: linear-gradient(180deg, ${({ theme }) => theme.colors.orange}, ${({ theme }) => theme.colors.orangeDeep});
    box-shadow: 0 8px 0 #c44e1c, 0 14px 28px rgba(242, 103, 43, 0.35);
    &:active { transform: translateY(5px); box-shadow: 0 3px 0 #c44e1c, 0 6px 14px rgba(242, 103, 43, 0.3); }
  `,
  blue: css`
    color: #fff;
    background: linear-gradient(180deg, ${({ theme }) => theme.colors.blue}, ${({ theme }) => theme.colors.blueDeep});
    box-shadow: 0 8px 0 #2a52b0, 0 14px 28px rgba(58, 111, 224, 0.35);
    &:active { transform: translateY(5px); box-shadow: 0 3px 0 #2a52b0, 0 6px 14px rgba(58, 111, 224, 0.3); }
  `,
  secondary: css`
    color: ${({ theme }) => theme.colors.ink};
    background: linear-gradient(180deg, #ffffff, #f3eef9);
    box-shadow: 0 6px 0 #d7cfe6, 0 12px 24px rgba(31, 20, 60, 0.14);
    &:active { transform: translateY(4px); box-shadow: 0 2px 0 #d7cfe6, 0 6px 12px rgba(31, 20, 60, 0.12); }
  `,
  ghost: css`
    color: #fff;
    background: rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.25);
    &:active { background: rgba(255, 255, 255, 0.24); }
  `,
  danger: css`
    color: #fff;
    background: linear-gradient(180deg, #ff6b7b, #e9445a);
    box-shadow: 0 6px 0 #b22a3e;
    &:active { transform: translateY(4px); box-shadow: 0 2px 0 #b22a3e; }
  `,
};

const sizeStyles: Record<Size, ReturnType<typeof css>> = {
  sm: css` height: 40px; padding: 0 16px; font-size: 14px; border-radius: 14px; `,
  md: css` height: 52px; padding: 0 22px; font-size: 17px; border-radius: 18px; `,
  lg: css` height: 64px; padding: 0 30px; font-size: 21px; border-radius: 22px; `,
};

export const Button = styled.button<{ $variant?: Variant; $size?: Size; $block?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 600;
  letter-spacing: 0.2px;
  transition: transform 0.08s ease, box-shadow 0.08s ease, background 0.15s ease, opacity 0.15s;
  white-space: nowrap;
  ${({ $variant = "primary" }) => variantStyles[$variant]}
  ${({ $size = "md" }) => sizeStyles[$size]}
  ${({ $block }) => $block && css` width: 100%; `}
  &:disabled { opacity: 0.5; pointer-events: none; }
`;

export const IconButton = styled.button<{ $active?: boolean; $tone?: "light" | "dark" }>`
  width: 46px;
  height: 46px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 20px;
  color: ${({ $tone }) => ($tone === "dark" ? "#fff" : "inherit")};
  background: ${({ $tone, theme }) => ($tone === "dark" ? "rgba(255,255,255,0.14)" : theme.colors.surface)};
  box-shadow: ${({ $tone, theme }) => ($tone === "dark" ? "inset 0 0 0 1.5px rgba(255,255,255,0.22)" : theme.shadow.card)};
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: transform 0.1s, background 0.15s, box-shadow 0.15s;
  ${({ $active, theme }) =>
    $active &&
    css`
      background: ${theme.colors.orange};
      color: #fff;
      box-shadow: 0 6px 18px rgba(255, 138, 61, 0.45);
    `}
  &:active { transform: scale(0.94); }
`;

export const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.card};
  animation: ${pop} 0.35s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
`;

export const Title = styled.h1`
  margin: 0;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.5px;
`;

export const Label = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.inkFaint};
`;

export const Row = styled.div<{ $gap?: number; $between?: boolean; $center?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ $gap = 10 }) => $gap}px;
  ${({ $between }) => $between && css` justify-content: space-between; `}
  ${({ $center }) => $center && css` justify-content: center; `}
`;

export const Chip = styled.span<{ $tone?: "orange" | "blue" | "green" | "neutral" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.4px;
  ${({ $tone = "neutral", theme }) =>
    ({
      orange: css` background: #ffe6d2; color: ${theme.colors.orangeDeep}; `,
      blue: css` background: #dde8ff; color: ${theme.colors.blueDeep}; `,
      green: css` background: #d8f7e5; color: #1f9a57; `,
      neutral: css` background: #ece8f3; color: ${theme.colors.inkSoft}; `,
    })[$tone]}
`;

/** Safe-area aware top/bottom padding helpers */
export const safeTop = css` padding-top: max(14px, env(safe-area-inset-top)); `;
export const safeBottom = css` padding-bottom: max(14px, env(safe-area-inset-bottom)); `;
