import { useEffect, useId, useRef, type ReactNode } from "react";
import styled, { keyframes } from "styled-components";
import { Button } from "./primitives";

const scrimIn = keyframes`
  from { opacity: 0; } to { opacity: 1; }
`;
const dialogIn = keyframes`
  0% { transform: scale(0.9) translateY(12px); opacity: 0; }
  65% { transform: scale(1.02) translateY(-2px); opacity: 1; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
`;

const Scrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${({ theme }) => theme.z.toast};
  display: grid;
  place-items: center;
  padding: 24px 18px;
  background: rgba(20, 15, 36, 0.72);
  backdrop-filter: blur(8px) saturate(1.1);
  -webkit-backdrop-filter: blur(8px) saturate(1.1);
  animation: ${scrimIn} 0.18s ease-out both;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

const Panel = styled.div`
  width: min(100%, 340px);
  padding: 26px 22px 22px;
  border-radius: ${({ theme }) => theme.radius.xl};
  background: ${({ theme }) => theme.colors.cream};
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4), inset 0 -5px 0 rgba(43, 35, 64, 0.08);
  text-align: center;
  animation: ${dialogIn} 0.32s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

const Badge = styled.div`
  width: 64px;
  height: 64px;
  margin: -58px auto 12px;
  border-radius: 22px;
  display: grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(180deg, ${({ theme }) => theme.colors.blue}, ${({ theme }) => theme.colors.blueDeep});
  box-shadow: 0 6px 0 #2a52b0, 0 12px 24px rgba(58, 111, 224, 0.35);
  svg { width: 32px; height: 32px; }
`;

const Heading = styled.h2`
  margin: 0 0 8px;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 600;
  font-size: 23px;
  line-height: 1.2;
  color: ${({ theme }) => theme.colors.ink};
`;

const Body = styled.p`
  margin: 0 0 22px;
  font-size: 16px;
  line-height: 1.5;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.inkSoft};
`;

const Actions = styled.div`
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 12px;
`;

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal yes/no prompt. Esc and a tap on the scrim both cancel; focus starts on the confirm
 * button, stays trapped inside while open, and returns to the opener when it closes.
 */
export function ConfirmDialog({ title, message, confirmLabel = "OK", cancelLabel = "Cancel", icon, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
      } else if (e.key === "Tab" && panelRef.current) {
        const buttons = panelRef.current.querySelectorAll<HTMLButtonElement>("button");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <Scrim onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <Panel ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        {icon && <Badge aria-hidden="true">{icon}</Badge>}
        <Heading id={titleId}>{title}</Heading>
        <Body id={bodyId}>{message}</Body>
        <Actions>
          <Button $variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} $variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Actions>
      </Panel>
    </Scrim>
  );
}
