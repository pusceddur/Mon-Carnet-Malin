// Tap-to-link state for « association » questions: tap a left item, then a right item. Items are referenced by index.

export interface AssociationLink { left: number; right: number }
export interface AssociationState { links: AssociationLink[]; selectedLeft: number | null }

export const EMPTY_ASSOCIATION: AssociationState = { links: [], selectedLeft: null };

export function linkOfLeft(state: AssociationState, left: number): AssociationLink | undefined {
  return state.links.find((l) => l.left === left);
}

export function linkOfRight(state: AssociationState, right: number): AssociationLink | undefined {
  return state.links.find((l) => l.right === right);
}

/** Selecting a linked left item unlinks it so it can be linked again; tapping the selected item deselects it. */
export function selectLeft(state: AssociationState, left: number): AssociationState {
  if (state.selectedLeft === left) return { ...state, selectedLeft: null };
  return { links: state.links.filter((l) => l.left !== left), selectedLeft: left };
}

/** Links the selected left item; without a selection, tapping a linked right item unlinks it. */
export function selectRight(state: AssociationState, right: number): AssociationState {
  if (state.selectedLeft === null) {
    return linkOfRight(state, right) ? { ...state, links: state.links.filter((l) => l.right !== right) } : state;
  }
  const left = state.selectedLeft;
  const links = state.links.filter((l) => l.left !== left && l.right !== right);
  return { links: [...links, { left, right }], selectedLeft: null };
}

export function undoLast(state: AssociationState): AssociationState {
  if (state.selectedLeft !== null) return { ...state, selectedLeft: null };
  return { links: state.links.slice(0, -1), selectedLeft: null };
}

export function isAssociationComplete(state: AssociationState, leftCount: number): boolean {
  return leftCount > 0 && state.links.length === leftCount;
}

/** Pairs of strings for the answer, in left order. */
export function toResponsePairs(state: AssociationState, lefts: readonly string[], rights: readonly string[]): { left: string; right: string }[] {
  return [...state.links]
    .sort((a, b) => a.left - b.left)
    .flatMap((l) => {
      const left = lefts[l.left];
      const right = rights[l.right];
      return left !== undefined && right !== undefined ? [{ left, right }] : [];
    });
}
