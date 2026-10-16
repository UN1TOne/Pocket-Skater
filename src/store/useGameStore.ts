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
      selectItem: (selectedItemId) => set({ selectedItemId, builderTool: "place" }),
      rotateSelection: () => set((s) => ({ builderRotation: ((s.builderRotation + 1) % 4) as Rotation })),
      setBuilderTool: (builderTool) => set({ builderTool }),

      placeItem: (x, z) => {
        const { customMap, selectedItemId, builderRotation } = get();
        if (!selectedItemId) return false;
        const cells = footprintCells(selectedItemId, x, z, builderRotation);
        const inBounds = cells.every(([cx, cz]) => cx >= 0 && cz >= 0 && cx < customMap.size && cz < customMap.size);
        if (!inBounds) return false;
        const isFloor = CATALOG_BY_ID[selectedItemId]?.category === "floors";
        // Floors stack with anything; other items replace whatever shares their footprint.
        const occupied = new Set<string>();
        for (const [cx, cz] of cells) occupied.add(`${cx},${cz}`);
        const remaining = customMap.items.filter((it) => {
          const itIsFloor = CATALOG_BY_ID[it.itemId]?.category === "floors";
          if (itIsFloor !== isFloor) return true;
          return !footprintCells(it.itemId, it.x, it.z, it.rot).some(([cx, cz]) => occupied.has(`${cx},${cz}`));
        });
        const placed: PlacedItem = { uid: uid(), itemId: selectedItemId, x, z, rot: builderRotation };
        set({ customMap: { ...customMap, items: [...remaining, placed] } });
        return true;
      },

      removeItemAt: (x, z) => {
        const { customMap } = get();
        const hit = [...customMap.items]
          .reverse()
          .sort((a, b) => Number(CATALOG_BY_ID[a.itemId]?.category === "floors") - Number(CATALOG_BY_ID[b.itemId]?.category === "floors"))
          .find((it) => footprintCells(it.itemId, it.x, it.z, it.rot).some(([cx, cz]) => cx === x && cz === z));
        if (!hit) return;
        set({ customMap: { ...customMap, items: customMap.items.filter((it) => it.uid !== hit.uid) } });
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
        // Keep the dial open so the user can keep tapping Rotate for 90° increments.
        set({
          customMap: {
            ...customMap,
            items: customMap.items.map((it) => (it.uid === uid ? { ...it, rot: ((it.rot + 1) % 4) as Rotation } : it)),
          },
        });
      },
      removePiece: (uid) => {
        const { customMap } = get();
        set({
          customMap: { ...customMap, items: customMap.items.filter((it) => it.uid !== uid) },
          activeDial: null,
        });
      },
      startCopyPiece: (uid) => {
        // Keep the dial open — the user can keep tapping Copy to spawn more copies on nearby cells.
        const { customMap } = get();
        const src = customMap.items.find((it) => it.uid === uid);
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
        const src = customMap.items.find((it) => it.uid === uid);
        if (!src) return false;
        const cells = footprintCells(src.itemId, x, z, src.rot);
        const inBounds = cells.every(([cx, cz]) => cx >= 0 && cz >= 0 && cx < customMap.size && cz < customMap.size);
        if (!inBounds) return false;
        const occupied = new Set<string>();
        for (const [cx, cz] of cells) occupied.add(`${cx},${cz}`);
        const isFloor = CATALOG_BY_ID[src.itemId]?.category === "floors";
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
        customMap: { ...get().customMap, items: [] },
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
