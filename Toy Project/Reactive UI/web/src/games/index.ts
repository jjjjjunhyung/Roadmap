import type { ComponentType } from "react";

import type { GameId } from "../lib/api";
import { Flip } from "./Flip";
import { Gacha } from "./Gacha";
import { Ladder } from "./Ladder";
import { Roulette } from "./Roulette";
import { Slot } from "./Slot";
import { Swipe } from "./Swipe";
import type { GameProps } from "./types";
import { WorldCup } from "./WorldCup";

/**
 * Games the app ships; keep in step with validate::GAMES on the server.
 * `luck` games end on chance, so they offer "try again".
 */
export const GAMES: Record<
  GameId,
  { name: string; desc: string; luck: boolean; Component: ComponentType<GameProps> }
> = {
  worldcup: {
    name: "이상형 월드컵",
    desc: "둘씩 맞붙여서 끝까지 남은 곳으로",
    luck: false,
    Component: WorldCup,
  },
  swipe: {
    name: "스와이프",
    desc: "한 장씩 좋아·패스로 넘기고, 좋아한 곳 중에서 하나",
    luck: false,
    Component: Swipe,
  },
  flip: {
    name: "카드 뒤집기",
    desc: "엎어 둔 카드 중 한 장을 뒤집기",
    luck: true,
    Component: Flip,
  },
  roulette: { name: "룰렛", desc: "룰렛을 손으로 잡고 돌리기", luck: true, Component: Roulette },
  slot: { name: "슬롯머신", desc: "레버를 당겨서 슬롯 돌리기", luck: true, Component: Slot },
  ladder: {
    name: "사다리 타기",
    desc: "출발 번호를 고르면 사다리를 따라 내려가기",
    luck: true,
    Component: Ladder,
  },
  gacha: {
    name: "캡슐 뽑기",
    desc: "손잡이를 돌려서 캡슐 하나 뽑기",
    luck: true,
    Component: Gacha,
  },
};
