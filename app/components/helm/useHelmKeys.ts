"use client";

import { useEffect } from "react";
import { useAppDispatch } from "../../store/hooks.ts";
import { centreRudder, nudgeOrbit, stepRudder, stepThrottle } from "../../store/orders.ts";

// HELM KEYS
//
//   W / S        engine telegraph, a notch at a time, astern through ahead
//   Up / Down    the same telegraph, so the arrows alone can drive the boat
//   Left / Right rudder to port and starboard
//   X            rudder amidships
//   A / D        swing the camera around the hull
//   Q / E        raise and lower the camera
//   - / =        pull the camera back and push it in
//
// Two clusters, each complete on its own: the arrows steer and drive, WASD
// drives and looks. The split is deliberate — an operator with a hand on the
// arrows never needs the other cluster to keep the boat under control.
//
// The telegraph ignores the browser's auto-repeat, so a held key cannot run the
// boat up to full; the rudder and the camera accept it, because holding a
// rudder over and holding a camera round are both things you do.
//
// Propulsion and steering keys only work after the operator has confirmed the
// manual-control dialog. Camera keys remain available before that transfer.

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

export function useHelmKeys(manual: boolean): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case "w":
        case "arrowup":
          if (!manual) return;
          if (!event.repeat) dispatch(stepThrottle(1));
          break;
        case "s":
        case "arrowdown":
          if (!manual) return;
          if (!event.repeat) dispatch(stepThrottle(-1));
          break;
        case "arrowleft":
          if (!manual) return;
          dispatch(stepRudder(-1));
          break;
        case "arrowright":
          if (!manual) return;
          dispatch(stepRudder(1));
          break;
        case "x":
          if (!manual) return;
          dispatch(centreRudder());
          break;
        case "a":
          dispatch(nudgeOrbit({ yaw: -6 }));
          break;
        case "d":
          dispatch(nudgeOrbit({ yaw: 6 }));
          break;
        case "q":
          dispatch(nudgeOrbit({ pitch: 4 }));
          break;
        case "e":
          dispatch(nudgeOrbit({ pitch: -4 }));
          break;
        case "-":
        case "_":
          dispatch(nudgeOrbit({ distance: 0.15 }));
          break;
        case "=":
        case "+":
          dispatch(nudgeOrbit({ distance: -0.15 }));
          break;
        default:
          return;
      }

      event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, manual]);
}
