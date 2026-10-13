import type { Position } from "./types";

// THE SURVEY GRID
//
// A fixed grid of squares over the whole world, so a cell means the same patch
// of water whatever the viewport is doing. Cells are addressed by index, never
// by the pixels they happened to be drawn at.
//
// Rows are a constant height in latitude. Columns are widened by the row's own
// cosine, so a cell stays roughly square on the water instead of stretching
// toward the poles — and because the width depends only on the row index, the
// grid is still deterministic.

const NM_PER_DEGREE_LAT = 60;

/** A cell address, "column:row". Stable across sessions and viewports. */
export type CellKey = string;

export interface Cell {
  column: number;
  row: number;
}

export function rowHeightDegrees(sizeNm: number): number {
  return sizeNm / NM_PER_DEGREE_LAT;
}

/** Column width for a row, in degrees of longitude. */
export function columnWidthDegrees(row: number, sizeNm: number): number {
  const height = rowHeightDegrees(sizeNm);
  const centreLatitude = (row + 0.5) * height;
  const shrink = Math.cos((centreLatitude * Math.PI) / 180);

  // Near the poles the cosine collapses and a column would span the globe.
  return height / Math.max(shrink, 0.05);
}

export function cellAt(position: Position, sizeNm: number): Cell {
  const height = rowHeightDegrees(sizeNm);
  const row = Math.floor(position.latitude / height);
  const width = columnWidthDegrees(row, sizeNm);

  return { column: Math.floor(position.longitude / width), row };
}

export function keyOf(cell: Cell): CellKey {
  return `${cell.column}:${cell.row}`;
}

export function cellOfKey(key: CellKey): Cell {
  const [column, row] = key.split(":");
  return { column: Number(column), row: Number(row) };
}

export function keyAt(position: Position, sizeNm: number): CellKey {
  return keyOf(cellAt(position, sizeNm));
}

export interface CellBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export function boundsOf(cell: Cell, sizeNm: number): CellBounds {
  const height = rowHeightDegrees(sizeNm);
  const width = columnWidthDegrees(cell.row, sizeNm);

  return {
    west: cell.column * width,
    east: (cell.column + 1) * width,
    south: cell.row * height,
    north: (cell.row + 1) * height,
  };
}

/** The cell as a closed ring, ready for a GeoJSON polygon. */
export function ringOf(cell: Cell, sizeNm: number): [number, number][] {
  const { west, east, south, north } = boundsOf(cell, sizeNm);

  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function centreOf(cell: Cell, sizeNm: number): Position {
  const { west, east, south, north } = boundsOf(cell, sizeNm);

  return { latitude: (south + north) / 2, longitude: (west + east) / 2 };
}

/**
 * Every cell overlapping a box, bounded so a careless zoom-out cannot ask for
 * a million squares. Returns an empty list rather than a truncated one when the
 * box is too big to draw honestly.
 */
export function cellsWithin(
  bounds: CellBounds,
  sizeNm: number,
  limit = 2000,
): Cell[] {
  const height = rowHeightDegrees(sizeNm);
  const firstRow = Math.floor(bounds.south / height);
  const lastRow = Math.floor(bounds.north / height);
  if ((lastRow - firstRow + 1) * (lastRow - firstRow + 1) > limit * 4) return [];

  const cells: Cell[] = [];

  for (let row = firstRow; row <= lastRow; row += 1) {
    const width = columnWidthDegrees(row, sizeNm);
    const firstColumn = Math.floor(bounds.west / width);
    const lastColumn = Math.floor(bounds.east / width);

    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (cells.length >= limit) return [];
      cells.push({ column, row });
    }
  }

  return cells;
}
