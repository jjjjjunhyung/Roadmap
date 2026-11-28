import type { ComponentType } from "react";

import type { GameId } from "../lib/api";
import { Balance } from "./Balance";
import { Blind } from "./Blind";
import { Crane } from "./Crane";
import { Dart } from "./Dart";
import { Eliminate } from "./Eliminate";
import { Flip } from "./Flip";
import { Gacha } from "./Gacha";
import { Gift } from "./Gift";
import { Hearts } from "./Hearts";
import { Ladder } from "./Ladder";
import { Lots } from "./Lots";
import { Plinko } from "./Plinko";
import { Race } from "./Race";
import { Rank } from "./Rank";
import { Roulette } from "./Roulette";
import { Scratch } from "./Scratch";
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
  balance: {
    name: "밸런스 게임",
    desc: "둘 중 하나를 고를 때마다 몰래 짝지은 후보 절반이 떨어지기",
    luck: true,
    Component: Balance,
  },
  blind: {
    name: "블라인드 픽",
    desc: "이름도 사진도 가리고, 메모 힌트만 보고 고르기",
    luck: false,
    Component: Blind,
  },
  hearts: {
    name: "하트 나눠주기",
    desc: "하트 10개를 나눠 주고, 가장 많이 받은 곳으로",
    luck: false,
    Component: Hearts,
  },
  eliminate: {
    name: "하나씩 탈락",
    desc: "제일 안 끌리는 곳부터 지우고, 끝까지 남은 곳으로",
    luck: false,
    Component: Eliminate,
  },
  rank: {
    name: "순위 매기기",
    desc: "가고 싶은 순서대로 누르고, 1등으로",
    luck: false,
    Component: Rank,
  },
  scratch: {
    name: "스크래치 복권",
    desc: "손가락으로 은박을 긁어서 당첨 확인",
    luck: true,
    Component: Scratch,
  },
  gift: {
    name: "선물 상자",
    desc: "리본 묶인 상자 중 하나를 골라 열기",
    luck: true,
    Component: Gift,
  },
  plinko: {
    name: "플링코",
    desc: "공을 떨어뜨리면 핀에 튕기며 칸 하나로",
    luck: true,
    Component: Plinko,
  },
  race: {
    name: "달리기 경주",
    desc: "후보들이 달리고, 먼저 들어온 곳으로 (톡톡 응원 가능)",
    luck: true,
    Component: Race,
  },
  dart: {
    name: "다트",
    desc: "움직이는 조준점을 보고 던져서 꽂힌 곳으로",
    luck: true,
    Component: Dart,
  },
  lots: {
    name: "제비뽑기",
    desc: "유리병 속 쪽지 하나를 뽑아 펼치기",
    luck: true,
    Component: Lots,
  },
  crane: {
    name: "인형 뽑기",
    desc: "집게를 타이밍 맞춰 내려서 뽑기 (놓치면 다시)",
    luck: true,
    Component: Crane,
  },
};
