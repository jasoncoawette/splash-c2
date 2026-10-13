import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { keyAt, type CellKey } from "../core/surveyGrid.ts";
import type { Position } from "../core/types";

/**
 * SURVEY SQUARES
 *
 * The patches of water an operator has marked to be searched. Held as cell
 * addresses rather than coordinates, so a square means the same water however
 * the chart is panned, and so selecting the same square twice is idempotent.
 */
export interface SurveySliceState {
  /** Edge length of one square, in nautical miles. */
  cellSizeNm: number;
  cells: CellKey[];
}

const initialState: SurveySliceState = {
  cellSizeNm: 0.5,
  cells: [],
};

const surveySlice = createSlice({
  name: "survey",
  initialState,
  reducers: {
    cellToggled(state, action: PayloadAction<Position>) {
      const key = keyAt(action.payload, state.cellSizeNm);
      state.cells = state.cells.includes(key)
        ? state.cells.filter((cell) => cell !== key)
        : [...state.cells, key];
    },

    cellPainted(state, action: PayloadAction<Position>) {
      const key = keyAt(action.payload, state.cellSizeNm);
      if (!state.cells.includes(key)) state.cells.push(key);
    },

    cellsCleared(state) {
      state.cells = [];
    },

    /** Resizing abandons the old squares: they addressed a different grid. */
    cellSizeChanged(state, action: PayloadAction<number>) {
      if (action.payload <= 0) return;
      state.cellSizeNm = action.payload;
      state.cells = [];
    },
  },
});

export const { cellPainted, cellSizeChanged, cellToggled, cellsCleared } = surveySlice.actions;

export default surveySlice.reducer;
