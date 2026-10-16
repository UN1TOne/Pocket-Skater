import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { CATALOG, CATEGORIES } from "@/data/catalog";
import { useGameStore } from "@/store/useGameStore";
import { safeBottom } from "@/ui/primitives";
import { useThumbnail } from "@/engine/assets/useThumbnail";

const HANDLE_H = 42;

const Sheet = styled.div<{ $open: boolean }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: ${({ theme }) => theme.z.sheet};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 28px 28px 0 0;
  box-shadow: 0 -16px 40px rgba(31, 20, 60, 0.25);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transform: translateY(${({ $open }) => ($open ? "0" : `calc(100% - ${HANDLE_H}px)`)});
  transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.25, 1.1);
  ${safeBottom}
`;

const Handle = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: ${HANDLE_H}px;
  padding: 0;
  background: transparent;
  cursor: pointer;
  gap: 2px;

  .grip {
    width: 44px;
    height: 5px;
    border-radius: 99px;
    background: ${({ theme }) => theme.colors.line};
    transition: background 0.15s;
  }
  &:hover .grip { background: ${({ theme }) => theme.colors.inkFaint}; }
`;

const Rail = styled.div`
  position: relative;
`;

const Tabs = styled.div`
  display: flex;
  gap: 6px;
  padding: 8px 36px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

const Tab = styled.button<{ $active: boolean }>`
  flex: 0 0 auto;
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-family: ${({ theme }) => theme.font.display};
  font-weight: 600;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.inkSoft};
  background: #f0ecf6;
  transition: all 0.15s;
  ${({ $active, theme }) =>
    $active &&
    css`
      color: #fff;
      background: ${theme.colors.ink};
      box-shadow: 0 6px 14px rgba(43, 35, 64, 0.3);
    `}
`;

/** Single-row horizontal strip — uniform across every category. */
const Strip = styled.div`
  display: flex;
  gap: 12px;
  padding: 12px 36px 14px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  scroll-behavior: smooth;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

/** Side chevron button for scrolling tabs/strip when overflow is present. */
const Chevron = styled.button<{ $side: "left" | "right" }>`
  position: absolute;
  top: 50%;
  ${({ $side }) => ($side === "left" ? "left: 2px;" : "right: 2px;")}
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 4px 10px rgba(31, 20, 60, 0.18), inset 0 0 0 1px ${({ theme }) => theme.colors.line};
  color: ${({ theme }) => theme.colors.inkSoft};
  display: grid;
  place-items: center;
  z-index: 2;
  transition: opacity 0.18s, transform 0.1s;
  &:hover { color: ${({ theme }) => theme.colors.ink}; }
  &:active { transform: translateY(-50%) scale(0.9); }
  svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
`;

const Tile = styled.button<{ $active: boolean }>`
  flex: 0 0 92px;
  scroll-snap-align: start;
  border-radius: 18px;
  padding: 8px 6px 6px;
  background: #f7f4fb;
  box-shadow: inset 0 0 0 2px transparent;
  transition: transform 0.12s, box-shadow 0.15s, background 0.15s;
  display: grid;
  gap: 4px;
  justify-items: center;

  .thumb {
    width: 66px;
    height: 66px;
    display: grid;
    place-items: center;
  }
  img {
    width: 66px;
    height: 66px;
    object-fit: contain;
    filter: drop-shadow(0 6px 6px rgba(31, 20, 60, 0.18));
    transition: transform 0.15s;
    image-rendering: -webkit-optimize-contrast;
  }
  span {
    font-size: 11.5px;
    font-weight: 800;
    color: ${({ theme }) => theme.colors.inkSoft};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
  }
  ${({ $active, theme }) =>
    $active &&
    css`
      background: #fff1e6;
      box-shadow: inset 0 0 0 2.5px ${theme.colors.orange}, 0 10px 20px rgba(255, 138, 61, 0.25);
      transform: translateY(-3px);
      img { transform: scale(1.08) rotate(-4deg); }
      span { color: ${theme.colors.orangeDeep}; }
    `}
  &:active { transform: scale(0.96); }
`;

const HandleChevron = styled.svg<{ $open: boolean }>`
  width: 14px;
  height: 14px;
  stroke: ${({ theme }) => theme.colors.inkFaint};
  fill: none;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform: rotate(${({ $open }) => ($open ? 0 : 180)}deg);
  transition: transform 0.3s;
`;

function ItemTile({ id, label, active, onSelect }: { id: string; label: string; active: boolean; onSelect: () => void }) {
  const thumb = useThumbnail(id);
  return (
    <Tile $active={active} onClick={onSelect} aria-label={label}>
      <div className="thumb">{thumb && <img src={thumb} alt="" loading="lazy" draggable={false} />}</div>
      <span>{label}</span>
    </Tile>
  );
}

/** Tracks whether a scrollable element is at its left/right edge so chevrons can toggle. */
function useScrollEdges<T extends HTMLElement>(ref: React.RefObject<T>, trigger?: unknown) {
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [ref, trigger]);
  return { atStart, atEnd };
}

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24">
      {dir === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}

/** Scrollable row: wheel→horizontal, mouse-drag swipe, chevrons when off-edge content exists. */
function ScrollRail({ children }: { children: (ref: React.RefObject<HTMLDivElement>) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { atStart, atEnd } = useScrollEdges(ref, children);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0) return;
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // Mouse-only drag-to-scroll (touch already pans natively via overflow-x: auto).
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    let moved = 0;
    let dragPointerId = -1;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      moved = 0;
      dragPointerId = e.pointerId;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4 && !el.hasPointerCapture(dragPointerId)) el.setPointerCapture(dragPointerId);
      moved = Math.max(moved, Math.abs(dx));
      el.scrollLeft = startScroll - dx;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // Suppress the trailing click when the user actually dragged.
      if (moved > 4) {
        const cancel = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener("click", cancel, { capture: true, once: true });
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);
  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };
  return (
    <Rail>
      {!atStart && (
        <Chevron $side="left" onClick={() => nudge(-1)} aria-label="Scroll left"><ChevronIcon dir="left" /></Chevron>
      )}
      {children(ref)}
      {!atEnd && (
        <Chevron $side="right" onClick={() => nudge(1)} aria-label="Scroll right"><ChevronIcon dir="right" /></Chevron>
      )}
    </Rail>
  );
}

export function ItemSheet() {
  const category = useGameStore((s) => s.builderCategory);
  const selected = useGameStore((s) => s.selectedItemId);
  const tool = useGameStore((s) => s.builderTool);
  const open = useGameStore((s) => s.builderSheetOpen);
  const { setBuilderCategory, selectItem, setBuilderSheetOpen } = useGameStore.getState();

  const items = useMemo(() => CATALOG.filter((c) => c.category === category), [category]);

  const sheetRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet ref={sheetRef} $open={open}>
      <Handle onClick={() => setBuilderSheetOpen(!open)} aria-label={open ? "Hide pieces" : "Show pieces"}>
        <div className="grip" />
        <HandleChevron $open={open} viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></HandleChevron>
      </Handle>
      <div>
        <ScrollRail>
          {(ref) => (
            <Tabs ref={ref}>
              {CATEGORIES.map((c) => (
                <Tab key={c.id} $active={c.id === category} onClick={() => setBuilderCategory(c.id)}>
                  {c.emoji} {c.label}
                </Tab>
              ))}
            </Tabs>
          )}
        </ScrollRail>
        <ScrollRail>
          {(ref) => (
            <Strip ref={ref}>
              {items.map((it) => (
                <ItemTile key={it.id} id={it.id} label={it.label} active={tool === "place" && it.id === selected} onSelect={() => selectItem(it.id)} />
              ))}
            </Strip>
          )}
        </ScrollRail>
      </div>
    </Sheet>
  );
}

