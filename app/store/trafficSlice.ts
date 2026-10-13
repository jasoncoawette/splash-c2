import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AisContact } from "../components/chart/openWaters";

/**
 * LIVE TRAFFIC
 *
 * Contacts come from the chart, because the tiles the operator is looking at
 * are the same tiles tasking reads. Nothing here is simulated and nothing is
 * persisted: a contact that stops reporting simply stops arriving.
 *
 * `targetMmsi` is what an escort or monitor order is pointed at. A target can
 * also be one of our own boats, which is held as `targetBoatId` instead, so the
 * two can never both be set.
 */
/** What a mission is screening, so the tick can move its station. */
export interface FollowAssignment {
  missionId: string;
  mode: "ESCORT" | "MONITOR";
  targetMmsi: number | null;
  targetBoatId: string | null;
  slot: number;
  groupSize: number;
  standoffNm: number;
}

export interface TrafficSliceState {
  contacts: AisContact[];
  targetMmsi: number | null;
  targetBoatId: string | null;
  standoffNm: number;
  follows: FollowAssignment[];
}

const initialState: TrafficSliceState = {
  contacts: [],
  targetMmsi: null,
  targetBoatId: null,
  standoffNm: 0.35,
  follows: [],
};

const trafficSlice = createSlice({
  name: "traffic",
  initialState,
  reducers: {
    contactsReported(state, action: PayloadAction<readonly AisContact[]>) {
      state.contacts = [...action.payload];
    },

    contactTargeted(state, action: PayloadAction<number | null>) {
      state.targetMmsi = action.payload;
      state.targetBoatId = null;
    },

    boatTargeted(state, action: PayloadAction<string | null>) {
      state.targetBoatId = action.payload;
      state.targetMmsi = null;
    },

    targetCleared(state) {
      state.targetMmsi = null;
      state.targetBoatId = null;
    },

    followsAssigned(state, action: PayloadAction<readonly FollowAssignment[]>) {
      state.follows = [...action.payload];
    },

    /** A boat that was recalled, removed or re-tasked stops being a screen. */
    followsDropped(state, action: PayloadAction<readonly string[]>) {
      const dropped = new Set(action.payload);
      state.follows = state.follows.filter((follow) => !dropped.has(follow.missionId));
    },

    standoffChanged(state, action: PayloadAction<number>) {
      if (Number.isFinite(action.payload) && action.payload > 0) {
        state.standoffNm = action.payload;
      }
    },
  },
});

export const {
  boatTargeted,
  contactTargeted,
  contactsReported,
  followsAssigned,
  followsDropped,
  standoffChanged,
  targetCleared,
} = trafficSlice.actions;

export default trafficSlice.reducer;
