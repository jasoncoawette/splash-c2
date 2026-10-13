import { configureStore } from "@reduxjs/toolkit";
import appearanceReducer from "./appearanceSlice.ts";
import commandReducer from "./commandSlice.ts";
import surveyReducer from "./surveySlice.ts";
import perimeterReducer from "./perimeterSlice.ts";
import fleetReducer from "./fleetSlice.ts";
import telemetryReducer from "./telemetrySlice.ts";
import trafficReducer from "./trafficSlice.ts";
import scenarioReducer from "./scenarioSlice.ts";

export function makeStore() {
  return configureStore({
    reducer: {
      fleet: fleetReducer,
      telemetry: telemetryReducer,
      command: commandReducer,
      survey: surveyReducer,
      traffic: trafficReducer,
      perimeters: perimeterReducer,
      appearance: appearanceReducer,
      scenario: scenarioReducer,
    },
    devTools: typeof window !== "undefined",
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
