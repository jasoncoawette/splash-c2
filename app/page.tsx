import { Suspense } from "react";
import FleetDashboard from "./components/FleetDashboard";
import StoreProvider from "./store/StoreProvider";

export default function Home() {
  // Two constraints hold this order in place.
  //
  // Suspense outside: Redux builds its private INIT action type from
  // Math.random(), and with cacheComponents on Next refuses a random read
  // during prerender. The boundary streams the console instead of blocking.
  //
  // StoreProvider above everything that can remount: the store is built by a
  // lazy initialiser, so it survives re-renders but not an unmount. Nothing
  // that re-mounts its children — the dock in particular — may be hoisted
  // above this line, or a re-dock resets the fleet to the seed.
  return (
    <Suspense fallback={<div className="console-boot" aria-busy="true" />}>
      <StoreProvider>
        <FleetDashboard />
      </StoreProvider>
    </Suspense>
  );
}
