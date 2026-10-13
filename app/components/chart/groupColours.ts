/**
 * GROUP COLOURS
 *
 * A group is only useful if you can see it on the chart without reading a
 * label, so each one is given a hue it keeps everywhere: the hull marker, its
 * route, and its row in the panel.
 *
 * Cyan is deliberately absent — it means "our fleet" everywhere else in the
 * console, and amber means traffic. A group colour has to be neither.
 */
export const GROUP_COLOURS = [
  "#8f7bff",
  "#4ddfa0",
  "#ff7ab8",
  "#ffd166",
  "#6fd0ff",
  "#ff9a6b",
] as const;

/**
 * Keyed off the group's own id rather than its position in the list, so
 * removing one group does not re-colour the others.
 */
export function groupColour(groupId: string): string {
  const numbered = /(\d+)$/.exec(groupId);

  if (numbered) {
    return GROUP_COLOURS[(Number(numbered[1]) - 1) % GROUP_COLOURS.length];
  }

  let hash = 0;
  for (const character of groupId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 9973;
  }

  return GROUP_COLOURS[hash % GROUP_COLOURS.length];
}

export interface GroupLike {
  id: string;
  boatIds: readonly string[];
}

/** Which colour, if any, each boat inherits from the group it belongs to. */
export function colourByBoat(groups: readonly GroupLike[]): Map<string, string> {
  const colours = new Map<string, string>();

  for (const group of groups) {
    const colour = groupColour(group.id);
    // First group wins, so a boat in two groups does not flicker between them.
    for (const boatId of group.boatIds) {
      if (!colours.has(boatId)) colours.set(boatId, colour);
    }
  }

  return colours;
}
