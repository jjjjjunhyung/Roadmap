import type { ComponentType } from "react";

import type { GameId } from "../lib/api";
import { Roulette } from "./Roulette";
import type { GameProps } from "./types";
import { WorldCup } from "./WorldCup";

/** Games the app ships; keep in step with validate::GAMES on the server. */
export const GAMES: Record<
  GameId,
  { name: string; luck: boolean; Component: ComponentType<GameProps> }
> = {
  worldcup: { name: "이상형 월드컵", luck: false, Component: WorldCup },
  roulette: { name: "룰렛", luck: true, Component: Roulette },
};
