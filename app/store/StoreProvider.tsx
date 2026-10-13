"use client";

import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore } from "./index.ts";

export default function StoreProvider({ children }: { children: ReactNode }) {
  // One store per mount, built by a lazy initialiser so the first paint already
  // has the seeded fleet and a re-render never rebuilds it.
  const [store] = useState(makeStore);

  return <Provider store={store}>{children}</Provider>;
}
