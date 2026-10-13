import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * APPEARANCE
 *
 * One operator preference: whether the console and the chart are read dark or
 * light. It drives both halves at once — the CSS palette and the basemap's own
 * light preset — because a dark chart under a light console reads as a bug.
 */
export type ConsoleTheme = "DARK" | "LIGHT";

export interface AppearanceSliceState {
  theme: ConsoleTheme;
}

const initialState: AppearanceSliceState = { theme: "DARK" };

const appearanceSlice = createSlice({
  name: "appearance",
  initialState,
  reducers: {
    themeToggled(state, action: PayloadAction<ConsoleTheme | undefined>) {
      state.theme = action.payload ?? (state.theme === "DARK" ? "LIGHT" : "DARK");
    },
  },
});

export const { themeToggled } = appearanceSlice.actions;
export default appearanceSlice.reducer;
