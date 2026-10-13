import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { BoatId, BoatMode, BoatState } from "../core/types";

// TELEMETRY
//
// The fleet slice holds what a boat *is* right now. This holds what it has been
// doing, as a bounded ring per boat, so instruments can draw a trend without
// every panel keeping its own history. It is derived data: it never feeds back
// into the fleet.

export interface TelemetrySample {
  elapsedSeconds: number;
  speedKnots: number;
  headingDegrees: number;
  energyPercent: number;
  latitude: number;
  longitude: number;
  mode: BoatMode;
}

export interface TelemetrySliceState {
  /**
   * Monotonic tick count: one per dispatched tick, whatever the sim rate.
   *
   * Anything drawn per frame rather than per second reads this. Do not swap it
   * for `elapsedSeconds` — the two look interchangeable, but simulated seconds
   * scale with the clock, so a 16x sim rate would run frame-paced motion
   * sixteen times faster. `elapsedSeconds` is for anything measured in seconds;
   * `ticks` is for anything measured in frames.
   */
  ticks: number;
  elapsedSeconds: number;
  lastSampleAt: number;
  history: Record<BoatId, TelemetrySample[]>;
}

/** Samples are taken at 2 Hz, not every 10 Hz tick: a trend, not a recording. */
const SAMPLE_INTERVAL_SECONDS = 0.5;

/** Two minutes of history per boat at the sample rate. */
const CAPACITY = 240;

/**
 * Deltas are summed in floating point, so a run of ticks lands a hair under the
 * interval (ten 0.1 s ticks sum to 0.9999999999999999). Without this tolerance
 * the sampler would drop a sample roughly every other interval.
 */
const EPSILON = 1e-9;

const initialState: TelemetrySliceState = {
  ticks: 0,
  elapsedSeconds: 0,
  lastSampleAt: 0,
  history: {},
};

const telemetrySlice = createSlice({
  name: "telemetry",
  initialState,
  reducers: {
    telemetrySampled(
      state,
      action: PayloadAction<{ deltaSeconds: number; boats: readonly BoatState[] }>,
    ) {
      const { deltaSeconds, boats } = action.payload;
      state.ticks += 1;
      state.elapsedSeconds += deltaSeconds;

      // Boats that have left the fleet take their history with them.
      const live = new Set(boats.map((boat) => boat.id));
      for (const boatId of Object.keys(state.history)) {
        if (!live.has(boatId)) delete state.history[boatId];
      }

      if (state.elapsedSeconds - state.lastSampleAt < SAMPLE_INTERVAL_SECONDS - EPSILON) return;
      state.lastSampleAt = state.elapsedSeconds;

      for (const boat of boats) {
        const samples = state.history[boat.id] ?? (state.history[boat.id] = []);
        samples.push({
          elapsedSeconds: state.elapsedSeconds,
          speedKnots: boat.speedKnots,
          headingDegrees: boat.headingDegrees,
          energyPercent: boat.energyPercent,
          latitude: boat.position.latitude,
          longitude: boat.position.longitude,
          mode: boat.mode,
        });
        if (samples.length > CAPACITY) samples.splice(0, samples.length - CAPACITY);
      }
    },

    telemetryCleared(state) {
      state.history = {};
      state.ticks = 0;
      state.elapsedSeconds = 0;
      state.lastSampleAt = 0;
    },
  },
});

export const { telemetryCleared, telemetrySampled } = telemetrySlice.actions;

export default telemetrySlice.reducer;
