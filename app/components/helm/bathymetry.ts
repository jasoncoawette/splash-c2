// DEPTH UNDER THE BOAT
//
// Open Waters publish their bathymetry twice: as the vector depth areas and
// soundings the charts draw, and as a terrarium-encoded raster DEM. Mapbox GL
// cannot decode the raster one — the tiles are WebP, and a `raster-dem` source
// pointed at them reports loaded, raises no error and paints nothing, which is
// recorded in the chart module and still true.
//
// Nothing stops US decoding it. The browser reads WebP natively, so a tile goes
// image -> canvas -> pixels, and terrarium turns three channels into one
// number: metres relative to sea level, where everything negative is water.
// That is what the helm needs to draw the bottom it is floating over.
//
// Context, not truth: the same caveat the charts carry applies here. These
// depths are not reduced to a chart datum, take no account of tide, and are not
// charted depths.

const RASTER_TILES = "https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp";

/**
 * Zoom 13 is about eight metres a pixel at this latitude, which is finer than
 * the mesh that reads it and keeps the whole scene inside four tiles.
 */
const TILE_ZOOM = 13;

/** Metres of latitude per degree, near enough for a two-kilometre scene. */
const METRES_PER_DEGREE_LAT = 110574;

function tileCount(zoom: number): number {
  return 2 ** zoom;
}

function tileXOf(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * tileCount(zoom);
}

function tileYOf(latitude: number, zoom: number): number {
  const radians = (latitude * Math.PI) / 180;
  const mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians));
  return ((1 - mercator / Math.PI) / 2) * tileCount(zoom);
}

interface DepthTile {
  /** Metres relative to sea level, row-major, one per pixel. Land is positive. */
  heights: Int16Array;
  size: number;
}

export interface DepthField {
  /**
   * Metres of water at a position: positive where there is water over the
   * bottom, zero over land and wherever no tile has arrived yet. A caller
   * cannot tell "dry" from "unknown" from the number alone, which is why
   * `ready` exists — nothing should be drawn as a seabed until a tile lands.
   */
  depthAt: (latitude: number, longitude: number) => number;
  /** Fetch whatever tiles cover this circle. Resolves when they have landed. */
  ensure: (origin: { latitude: number; longitude: number }, radiusM: number) => Promise<void>;
  /** Bumps every time a tile arrives, so a mesh knows it is worth rebuilding. */
  revision: () => number;
  ready: () => boolean;
  dispose: () => void;
}

export function createDepthField(): DepthField {
  const tiles = new Map<string, DepthTile | null>();
  const pending = new Set<string>();
  let revision = 0;
  let disposed = false;

  async function loadTile(x: number, y: number): Promise<void> {
    const key = `${TILE_ZOOM}/${x}/${y}`;
    if (tiles.has(key) || pending.has(key)) return;
    pending.add(key);

    try {
      const url = RASTER_TILES
        .replace("{z}", String(TILE_ZOOM))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const response = await fetch(url);
      if (!response.ok) {
        tiles.set(key, null);
        return;
      }

      const bitmap = await createImageBitmap(await response.blob());
      // Read the size out before releasing the bitmap: close() zeroes its
      // width and height, and reading them afterwards asks the canvas for a
      // zero-wide region, which throws and loses the tile.
      const size = bitmap.width;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        bitmap.close();
        tiles.set(key, null);
        return;
      }

      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, size, bitmap.height).data;
      bitmap.close();

      const heights = new Int16Array(pixels.length / 4);

      // Terrarium: height = R * 256 + G + B / 256 - 32768. A metre of
      // resolution is far more than a shaded bottom needs, so it is kept as a
      // short — four tiles of doubles would be eight megabytes of seabed.
      for (let index = 0; index < heights.length; index += 1) {
        const offset = index * 4;
        heights[index] = Math.round(
          pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768,
        );
      }

      if (disposed) return;
      tiles.set(key, { heights, size });
      revision += 1;
    } catch {
      // Offline, blocked, or a tile that is not there. The bottom simply is
      // not drawn; the helm is still flyable without it.
      tiles.set(key, null);
    } finally {
      pending.delete(key);
    }
  }

  return {
    async ensure(origin, radiusM) {
      const metresPerDegreeLon = METRES_PER_DEGREE_LAT
        * Math.cos((origin.latitude * Math.PI) / 180);
      const latitudeSpan = radiusM / METRES_PER_DEGREE_LAT;
      const longitudeSpan = radiusM / metresPerDegreeLon;

      const left = Math.floor(tileXOf(origin.longitude - longitudeSpan, TILE_ZOOM));
      const right = Math.floor(tileXOf(origin.longitude + longitudeSpan, TILE_ZOOM));
      // Tile Y runs the other way from latitude.
      const top = Math.floor(tileYOf(origin.latitude + latitudeSpan, TILE_ZOOM));
      const bottom = Math.floor(tileYOf(origin.latitude - latitudeSpan, TILE_ZOOM));

      const work: Promise<void>[] = [];
      for (let x = left; x <= right; x += 1) {
        for (let y = top; y <= bottom; y += 1) work.push(loadTile(x, y));
      }

      await Promise.all(work);
    },

    depthAt(latitude, longitude) {
      const fx = tileXOf(longitude, TILE_ZOOM);
      const fy = tileYOf(latitude, TILE_ZOOM);
      const tile = tiles.get(`${TILE_ZOOM}/${Math.floor(fx)}/${Math.floor(fy)}`);
      if (!tile) return 0;

      const px = Math.min(tile.size - 1, Math.max(0, Math.floor((fx % 1) * tile.size)));
      const py = Math.min(tile.size - 1, Math.max(0, Math.floor((fy % 1) * tile.size)));
      const height = tile.heights[py * tile.size + px];

      return height < 0 ? -height : 0;
    },

    revision: () => revision,
    ready: () => [...tiles.values()].some(Boolean),

    dispose() {
      disposed = true;
      tiles.clear();
      pending.clear();
    },
  };
}
