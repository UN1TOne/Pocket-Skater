import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CharacterId, ItemCategory, MapData, Page, PlacedItem, PlayMode, RideId, Rotation } from "@/types/game";
import { DEFAULT_GRID_SIZE, PRESET_MAPS } from "@/data/presets";
import { CATALOG_BY_ID } from "@/data/catalog";

/** Occupied cells for a placed item (handles footprints > 1 and rotation). */
export function footprintCells(itemId: string, x: number, z: number, rot: Rotation): Array<[number, number]> {
  const item = CATALOG_BY_ID[itemId];
  if (!item) return [[x, z]];
  const { w, d } = item.footprint;
  const rw = rot % 2 === 0 ? w : d;
  const rd = rot % 2 === 0 ? d : w;
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < rw; i++) for (let j = 0; j < rd; j++) cells.push([x + i, z + j]);
  return cells;
}

/** How many cells of outer-ring area are allowed around the skate grid for decoration. */
export const OUTER_PADDING = 3;

/** True iff ALL cells fall inside the inner skate grid (0..size-1). */
export function allCellsInner(cells: Array<[number, number]>, size: number): boolean {
  return cells.every(([x, z]) => x >= 0 && z >= 0 && x < size && z < size);
}

/** True iff AT LEAST one cell is outside the inner skate grid. */
export function anyCellOuter(cells: Array<[number, number]>, size: number): boolean {
  return cells.some(([x, z]) => x < 0 || z < 0 || x >= size || z >= size);
}

export type BuilderTool = "place" | "erase";

export interface DialState {
  uid: string;
  x: number;
  y: number;
}

export interface SkateSetup {
  mapId: string | null;
  character: CharacterId;
  ride: RideId;
  mode: PlayMode;
}

export interface GameHud {
  speed: number;
  airtime: number;
  score: number;
  grinding: boolean;
  bailed: boolean;
  /** Transient toast — set when a scoring event happens, cleared by the UI. */
  toast?: { text: string; bonus: number; t: number } | null;
}

interface GameState {
  page: Page;
  setPage: (page: Page) => void;

  customMap: MapData;
  builderCategory: ItemCategory;
  selectedItemId: string | null;
  builderRotation: Rotation;
  builderTool: BuilderTool;
  setBuilderCategory: (c: ItemCategory) => void;
  selectItem: (id: string | null) => void;
  rotateSelection: () => void;
  setBuilderTool: (t: BuilderTool) => void;
  placeItem: (x: number, z: number) => boolean;
  removeItemAt: (x: number, z: number) => void;
  clearMap: () => void;
  loadPresetIntoBuilder: (presetId: string) => void;
  renameMap: (name: string) => void;
  setCustomThumbnail: (dataUrl: string) => void;
  builderSheetOpen: boolean;
  setBuilderSheetOpen: (open: boolean) => void;
  floorFillPrompt: string | null;
  setFloorFillPrompt: (itemId: string | null) => void;
  fillFloorAll: (itemId: string) => void;
  activeDial: DialState | null;
  setActiveDial: (d: DialState | null) => void;
  movingPieceUid: string | null;
  rotatePiece: (uid: string) => void;
  removePiece: (uid: string) => void;
  startCopyPiece: (uid: string) => void;
  startMovePiece: (uid: string) => void;
  movePieceTo: (uid: string, x: number, z: number) => boolean;

  setup: SkateSetup;
  setSetup: (patch: Partial<SkateSetup>) => void;
  /** 0 map · 1 character · 2 ride · 3 playing. */
  setupStep: 0 | 1 | 2 | 3;
  setSetupStep: (s: 0 | 1 | 2 | 3) => void;
  hud: GameHud;
  setHud: (patch: Partial<GameHud>) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;

  /** Resolve a map by id (custom or preset). */
  getMap: (id: string | null) => MapData | null;
}

const emptyCustomMap = (): MapData => ({
  id: "custom",
  name: "My Park",
  size: DEFAULT_GRID_SIZE,
  items: [],
  blurb: "Your own creation from the Builder.",
});

let uidSeed = Date.now() % 100000;
const uid = () => `c${(uidSeed++).toString(36)}`;

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      page: "landing",
      setPage: (page) => set({ page, paused: false }),

      customMap: emptyCustomMap(),
      builderCategory: "ramps",
      selectedItemId: null,
      builderRotation: 0,
      builderTool: "place",
      setBuilderCategory: (builderCategory) => set({ builderCategory }),
      selectItem: (id) =>
        set((s) => ({
          // Tap the same tile a second time to deselect — the ghost that follows the cursor
          // was disruptive otherwise.
          selectedItemId: s.selectedItemId === id ? null : id,
          builderTool: "place",
        })),
      rotateSelection: () => set((s) => ({ builderRotation: ((s.builderRotation + 1) % 4) as Rotation })),
      setBuilderTool: (builderTool) => set({ builderTool }),

      placeItem: (x, z) => {
        const { customMap, selectedItemId, builderRotation } = get();
        if (!selectedItemId) return false;
        const def = CATALOG_BY_ID[selectedItemId];
        if (!def) return false;
        const isExterior = def.category === "exteriors";
        const cells = footprintCells(selectedItemId, x, z, builderRotation);

        // Bounds + zone rules (same as before — exteriors live outside, others inside).
        if (isExterior) {
          const inOuterBounds = cells.every(
            ([cx, cz]) =>
              cx >= -OUTER_PADDING &&
              cz >= -OUTER_PADDING &&
              cx < customMap.size + OUTER_PADDING &&
              cz < customMap.size + OUTER_PADDING,
          );
          if (!inOuterBounds) return false;
          if (!cells.every(([cx, cz]) => cx < 0 || cz < 0 || cx >= customMap.size || cz >= customMap.size)) return false;
        } else {
          if (!allCellsInner(cells, customMap.size)) return false;
        }

        const sourceKey = isExterior ? "outerItems" : "items";
        const sourceArray: PlacedItem[] = isExterior ? customMap.outerItems ?? [] : customMap.items;
        const cellKey = (cx: number, cz: number) => `${cx},${cz}`;
        const cellKeys = new Set(cells.map(([cx, cz]) => cellKey(cx, cz)));

        // Stacking: find any piece beneath whose footprint fully covers our new piece AND
        // has a defined stackTop (i.e. a flat enough roof). The AI picks the highest matching
        // base so chain-stacking works (platform on platform on ground).
        const stackableBases = sourceArray.filter((it) => {
          const bDef = CATALOG_BY_ID[it.itemId];
          if (!bDef?.stackTop) return false;
          const bCells = footprintCells(it.itemId, it.x, it.z, it.rot);
          return cells.every(([cx, cz]) => bCells.some(([bx, bz]) => bx === cx && bz === cz));
        });

        if (stackableBases.length > 0) {
          // Pick the base whose top sits highest; stack on it, don't remove anything.
          const base = stackableBases.reduce((best, it) => {
            const topOf = (p: PlacedItem) => (p.y ?? 0) + (CATALOG_BY_ID[p.itemId]?.stackTop ?? 0);
            return topOf(it) > topOf(best) ? it : best;
          });
          const stackY = (base.y ?? 0) + (CATALOG_BY_ID[base.itemId]?.stackTop ?? 0);
          // If the user is placing on a spot that already has a piece at the SAME stack level,
          // replace that one (don't accumulate forever).
          const remaining = sourceArray.filter((it) => {
            if ((it.y ?? 0) !== stackY) return true;
            const itCells = footprintCells(it.itemId, it.x, it.z, it.rot);
            return !itCells.some(([cx, cz]) => cellKeys.has(cellKey(cx, cz)));
          });
          const placed: PlacedItem = { uid: uid(), itemId: selectedItemId, x, z, rot: builderRotation, y: stackY };
          set({ customMap: { ...customMap, [sourceKey]: [...remaining, placed] } });
          return true;
        }

        // No stackable base beneath — fall back to classic "replace same-layer" semantics.
        // Floors stack with anything; other categories replace whatever shares their footprint
        // at ground level only (don't touch stacked pieces).
        const isFloor = def.category === "floors";
        const remaining = sourceArray.filter((it) => {
          if ((it.y ?? 0) !== 0) return true; // keep anything stacked up
          const itIsFloor = CATALOG_BY_ID[it.itemId]?.category === "floors";
          if (itIsFloor !== isFloor) return true;
          return !footprintCells(it.itemId, it.x, it.z, it.rot).some(([cx, cz]) => cellKeys.has(cellKey(cx, cz)));
        });
        const placed: PlacedItem = { uid: uid(), itemId: selectedItemId, x, z, rot: builderRotation };
        set({ customMap: { ...customMap, [sourceKey]: [...remaining, placed] } });
        return true;
      },

      removeItemAt: (x, z) => {
        const { customMap } = get();
        const touches = (it: PlacedItem) =>
          footprintCells(it.itemId, it.x, it.z, it.rot).some(([cx, cz]) => cx === x && cz === z);
        // Highest-stacked piece first — tapping removes what the user actually sees on top.
        const pickTop = (arr: PlacedItem[]) =>
          arr.filter(touches).sort((a, b) => (b.y ?? 0) - (a.y ?? 0))[0] ?? null;

        const outerHit = pickTop(customMap.outerItems ?? []);
        if (outerHit) {
          set({
            customMap: { ...customMap, outerItems: (customMap.outerItems ?? []).filter((it) => it.uid !== outerHit.uid) },
          });
          return;
        }
        const innerHits = customMap.items.filter(touches);
        if (innerHits.length === 0) return;
        // Prefer non-floors so a tap doesn't peel the floor out from under a stack.
        const nonFloors = innerHits.filter((it) => CATALOG_BY_ID[it.itemId]?.category !== "floors");
        const target = (nonFloors.length > 0 ? nonFloors : innerHits).sort((a, b) => (b.y ?? 0) - (a.y ?? 0))[0];
        set({ customMap: { ...customMap, items: customMap.items.filter((it) => it.uid !== target.uid) } });
      },

      builderSheetOpen: true,
      setBuilderSheetOpen: (builderSheetOpen) => set({ builderSheetOpen }),
      floorFillPrompt: null,
      setFloorFillPrompt: (floorFillPrompt) => set({ floorFillPrompt }),
      fillFloorAll: (itemId) => {
        const { customMap } = get();
        if (CATALOG_BY_ID[itemId]?.category !== "floors") return;
        const size = customMap.size;
        // Remove any existing floor tiles then lay the chosen floor across every cell.
        const nonFloor = customMap.items.filter((it) => CATALOG_BY_ID[it.itemId]?.category !== "floors");
        const fresh: PlacedItem[] = [];
        for (let x = 0; x < size; x++) {
          for (let z = 0; z < size; z++) {
            fresh.push({ uid: uid(), itemId, x, z, rot: 0 });
          }
        }
        set({
          customMap: { ...customMap, items: [...nonFloor, ...fresh] },
          floorFillPrompt: null,
        });
      },
      activeDial: null,
      setActiveDial: (activeDial) => set({ activeDial }),
      movingPieceUid: null,

      rotatePiece: (uid) => {
        const { customMap } = get();
        const rotateFn = (it: PlacedItem) => (it.uid === uid ? { ...it, rot: ((it.rot + 1) % 4) as Rotation } : it);
        set({
          customMap: {
            ...customMap,
            items: customMap.items.map(rotateFn),
            outerItems: (customMap.outerItems ?? []).map(rotateFn),
          },
        });
      },
      removePiece: (uid) => {
        const { customMap } = get();
        set({
          customMap: {
            ...customMap,
            items: customMap.items.filter((it) => it.uid !== uid),
            outerItems: (customMap.outerItems ?? []).filter((it) => it.uid !== uid),
          },
          activeDial: null,
        });
      },
      startCopyPiece: (uid) => {
        const { customMap } = get();
        const src =
          customMap.items.find((it) => it.uid === uid) ??
          (customMap.outerItems ?? []).find((it) => it.uid === uid);
        if (!src) return;
        set({
          selectedItemId: src.itemId,
          builderRotation: src.rot,
          builderTool: "place",
          movingPieceUid: null,
        });
      },
      startMovePiece: (uid) => {
        // Dial stays open; the piece dims so the user knows the next cell-tap will move it.
        set({
          movingPieceUid: uid,
          builderTool: "place",
          selectedItemId: null,
        });
      },
      movePieceTo: (uid, x, z) => {
        const { customMap } = get();
        const inInner = customMap.items.find((it) => it.uid === uid);
        const inOuter = inInner ? null : (customMap.outerItems ?? []).find((it) => it.uid === uid);
        const src = inInner ?? inOuter;
        if (!src) return false;
        const def = CATALOG_BY_ID[src.itemId];
        const isExterior = def?.category === "exteriors";
        const cells = footprintCells(src.itemId, x, z, src.rot);
        // Preserve the piece's zone (inner piece stays inner, outer piece stays outer).
        if (isExterior || inOuter) {
          const inOuterBounds = cells.every(
            ([cx, cz]) =>
              cx >= -OUTER_PADDING &&
              cz >= -OUTER_PADDING &&
              cx < customMap.size + OUTER_PADDING &&
              cz < customMap.size + OUTER_PADDING,
          );
          if (!inOuterBounds) return false;
          if (!cells.every(([cx, cz]) => cx < 0 || cz < 0 || cx >= customMap.size || cz >= customMap.size)) return false;
          const occupied = new Set<string>();
          for (const [cx, cz] of cells) occupied.add(`${cx},${cz}`);
          const outerItems = customMap.outerItems ?? [];
          const remaining = outerItems.filter((it) => {
            if (it.uid === uid) return false;
            return !footprintCells(it.itemId, it.x, it.z, it.rot).some(([cx, cz]) => occupied.has(`${cx},${cz}`));
          });
          set({
            customMap: { ...customMap, outerItems: [...remaining, { ...src, x, z }] },
            movingPieceUid: null,
          });
          return true;
        }
        if (!allCellsInner(cells, customMap.size)) return false;
        const occupied = new Set<string>();
        for (const [cx, cz] of cells) occupied.add(`${cx},${cz}`);
        const isFloor = def?.category === "floors";
        const remaining = customMap.items.filter((it) => {
          if (it.uid === uid) return false;
          const itIsFloor = CATALOG_BY_ID[it.itemId]?.category === "floors";
          if (itIsFloor !== isFloor) return true;
          return !footprintCells(it.itemId, it.x, it.z, it.rot).some(([cx, cz]) => occupied.has(`${cx},${cz}`));
        });
        set({
          customMap: { ...customMap, items: [...remaining, { ...src, x, z }] },
          movingPieceUid: null,
        });
        return true;
      },

      clearMap: () => set({
        customMap: { ...get().customMap, items: [], outerItems: [] },
        activeDial: null,
        movingPieceUid: null,
      }),
      loadPresetIntoBuilder: (presetId) => {
        const preset = PRESET_MAPS.find((m) => m.id === presetId);
        if (!preset) return;
        set({
          customMap: {
            ...get().customMap,
            size: preset.size,
            items: preset.items.map((it) => ({ ...it, uid: uid() })),
            outerItems: (preset.outerItems ?? []).map((it) => ({ ...it, uid: uid() })),
            // The custom map is now a copy of the preset — the old captured thumb no longer matches.
            thumbnail: undefined,
          },
        });
      },
      renameMap: (name) => set({ customMap: { ...get().customMap, name } }),
      setCustomThumbnail: (dataUrl) => set({ customMap: { ...get().customMap, thumbnail: dataUrl } }),

      setup: { mapId: PRESET_MAPS[0].id, character: "character-skate-boy", ride: "skateboard", mode: "manual" },
      setSetup: (patch) => set((s) => ({ setup: { ...s.setup, ...patch } })),
      setupStep: 0,
      setSetupStep: (setupStep) => set({ setupStep }),
      hud: { speed: 0, airtime: 0, score: 0, grinding: false, bailed: false },
      setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),
      paused: false,
      setPaused: (paused) => set({ paused }),

      getMap: (id) => {
        if (!id) return null;
        if (id === "custom") return get().customMap;
        return PRESET_MAPS.find((m) => m.id === id) ?? null;
      },
    }),
    {
      name: "pocket-skater-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ customMap: s.customMap, setup: s.setup }),
    },
  ),
);
