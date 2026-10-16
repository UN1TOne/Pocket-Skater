import { createGlobalStyle, keyframes } from "styled-components";

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: ${({ theme }) => theme.colors.bgDeep};
    color: ${({ theme }) => theme.colors.ink};
    font-family: ${({ theme }) => theme.font.body};
    overscroll-behavior: none;
    touch-action: manipulation;
    -webkit-font-smoothing: antialiased;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; }
  button:focus-visible { outline: 3px solid ${({ theme }) => theme.colors.blue}; outline-offset: 2px; }
  canvas { display: block; outline: none; touch-action: none; }
  ::-webkit-scrollbar { height: 0; width: 0; }
`;

export const pop = keyframes`
  0% { transform: scale(0.92) translateY(8px); opacity: 0; }
  60% { transform: scale(1.03) translateY(-2px); opacity: 1; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
`;

export const float = keyframes`
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50% { transform: translateY(-10px) rotate(2deg); }
`;

export const shimmer = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
`;

export const fadeIn = keyframes`
  from { opacity: 0; } to { opacity: 1; }
`;

export const slideUp = keyframes`
  from { transform: translateY(100%); } to { transform: translateY(0); }
`;
