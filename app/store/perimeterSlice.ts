import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Position } from "../core/types";

/**
 * PERIMETERS
 *
 * A perimeter is a ring on the chart with boats assigned to it. Dragging it or
 * resizing it re-plans every boat assigned to it, which is the whole point:
 * the operator moves the shape, not the routes.
 *
 * The missions themselves live in the fleet slice; this slice only owns the
 * shape and who is screening it, so there is still one owner for boat state.
 */
export interface Perimeter {
  id: string;
  name: string;
  center: Position;
  radiusNm: number;
  boatIds: string[];
  /** Mission IDs currently flying this ring, in slot order. */
  missionIds: string[];
}

export interface PerimeterSliceState {
  perimeters: Perimeter[];
  activeId: string | null;
  sequence: number;
}

const initialState: PerimeterSliceState = {
  perimeters: [],
  activeId: null,
  sequence: 1,
};

const perimeterSlice = createSlice({
  name: "perimeters",
  initialState,
  reducers: {
    perimeterAdded: {
      reducer(state, action: PayloadAction<Perimeter>) {
        state.perimeters.push(action.payload);
        state.activeId = action.payload.id;
        state.sequence += 1;
      },
      prepare(input: {
        center: Position;
        radiusNm: number;
        boatIds: readonly string[];
        id: string;
        name: string;
      }) {
        return {
          payload: {
            id: input.id,
            name: input.name,
            center: input.center,
            radiusNm: input.radiusNm,
            boatIds: [...input.boatIds],
            missionIds: [],
          },
        };
      },
    },

    /** The drag itself. Centre, radius, or both. */
    perimeterShaped(
      state,
      action: PayloadAction<{ id: string; center?: Position; radiusNm?: number }>,
    ) {
      const perimeter = state.perimeters.find((item) => item.id === action.payload.id);
      if (!perimeter) return;

      if (action.payload.center) perimeter.center = action.payload.center;
      if (action.payload.radiusNm !== undefined) {
        perimeter.radiusNm = Math.max(0.05, action.payload.radiusNm);
      }
    },

    perimeterMissionsSet(
      state,
      action: PayloadAction<{ id: string; missionIds: readonly string[] }>,
    ) {
      const perimeter = state.perimeters.find((item) => item.id === action.payload.id);
      if (perimeter) perimeter.missionIds = [...action.payload.missionIds];
    },

    perimeterSelected(state, action: PayloadAction<string | null>) {
      // Selecting the active ring again clears it, so a perimeter can be put
      // down and picked up again rather than being a one-way choice.
      state.activeId = state.activeId === action.payload ? null : action.payload;
    },

    perimeterRemoved(state, action: PayloadAction<string>) {
      state.perimeters = state.perimeters.filter((item) => item.id !== action.payload);
      if (state.activeId === action.payload) state.activeId = null;
    },
  },
});

export const {
  perimeterAdded,
  perimeterMissionsSet,
  perimeterRemoved,
  perimeterSelected,
  perimeterShaped,
} = perimeterSlice.actions;

export default perimeterSlice.reducer;
