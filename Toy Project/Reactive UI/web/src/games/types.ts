import type { Kind, Place } from "../lib/api";

export interface GameProps {
  candidates: Place[];
  kind: Kind;
  /** stable slot of a candidate in its step (colours, number) */
  indexOf: (p: Place) => number;
  /** report the result; `el` is where the celebration starts */
  onPicked: (p: Place, el: Element | null) => void;
  /** the places being looked at right now (they stand out on the map) */
  onFocus?: (ids: string[]) => void;
}
