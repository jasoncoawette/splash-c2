import type { Map as MapboxMap } from "mapbox-gl";

/**
 * WHAT THE CHART COMPLAINS ABOUT
 *
 * Mapbox GL has one rule about its `error` event: if nothing is listening, it
 * prints the error to the console itself. No map in this app listened, so every
 * transient tile failure — and a moving chart over three third-party tile
 * services produces a steady drip of them — went straight to `console.error`
 * from inside the GL worker. In the browser that reads as dozens of stack
 * traces pointing at a blob URL with no message attached to them, which says
 * nothing about what is wrong and buries anything that does.
 *
 * Two kinds of thing arrive here and they deserve opposite treatment.
 *
 * Aborts are not failures. Panning cancels the tiles you panned away from, and
 * leaving a view cancels every request the map it is tearing down had open —
 * that is the loader working, and it is the bulk of the noise.
 *
 * Everything else is reported once per map and then counted. A tile service
 * that is refusing requests will refuse hundreds of them, and the second
 * through five-hundredth report teaches nothing the first did not.
 */

/** Requests the loader cancelled on purpose. Not worth a word. */
function isAbort(error: unknown): boolean {
  if (!error) return false;

  const name = (error as { name?: string }).name ?? "";
  const message = (error as { message?: string }).message ?? "";

  return name === "AbortError"
    || message.includes("aborted")
    || message.includes("signal is aborted");
}

export function attachChartErrors(map: MapboxMap, label: string): () => void {
  const seen = new Map<string, number>();

  const onError = (event: { error?: Error }) => {
    const error = event.error;
    if (isAbort(error)) return;

    const message = error?.message ?? String(error ?? "unknown chart error");
    const count = (seen.get(message) ?? 0) + 1;
    seen.set(message, count);

    // Once, loudly enough to act on, and never again for the same message.
    if (count === 1) console.warn(`[${label}] ${message}`);
  };

  map.on("error", onError);

  return () => {
    map.off("error", onError);
  };
}
