import { type CSSProperties, useEffect, useRef, useState } from "react";

import { Tile } from "../components/ui";
import type { Kind } from "../lib/api";
import { burst, haptic, reducedMotion, sfx, shuffle } from "../lib/feel";
import { aura, auraVars } from "../lib/look";
import { useReactive } from "../lib/useReactive";
import type { GameProps } from "./types";

interface Question {
  q: string;
  a: string;
  b: string;
}

/*
 * Questions are about the picker, never about the places (no "면 vs 밥"): which answer keeps
 * which places is decided by chance, so a question that sounded like it described a place would
 * feel broken when the result disagreed.
 */
const COMMON: Question[] = [
  { q: "평생 한 계절만 산다면?", a: "여름", b: "겨울" },
  { q: "연락은 어떤 쪽?", a: "바로바로 답장", b: "몰아서 길게" },
  { q: "여행 스타일은?", a: "분 단위 계획", b: "발길 닿는 대로" },
  { q: "딱 한 곳으로 떠난다면?", a: "바다", b: "산" },
  { q: "애인이 내 친구 깻잎을 떼어 준다면?", a: "그럴 수 있지", b: "절대 안 돼" },
  { q: "애인이 내 친구 새우를 까 준다면?", a: "매너지", b: "선 넘었어" },
  { q: "애인이 내 친구 패딩 지퍼를 올려 준다면?", a: "괜찮아", b: "헤어져" },
  { q: "초능력 하나만 고른다면?", a: "순간이동", b: "시간 멈추기" },
  { q: "탕수육은?", a: "부먹", b: "찍먹" },
  { q: "민트초코는?", a: "최고의 맛", b: "치약 맛" },
  { q: "쉬는 날엔?", a: "집에서 뒹굴기", b: "밖으로 나가기" },
  { q: "데이트 사진은?", a: "100장 찍기", b: "눈에만 담기" },
  { q: "같이 키운다면?", a: "강아지", b: "고양이" },
  { q: "놀이공원 첫 번째는?", a: "롤러코스터", b: "회전목마" },
  { q: "노래방 첫 곡은?", a: "발라드", b: "신나는 노래" },
  { q: "다퉜을 때는?", a: "바로 풀기", b: "하루 생각해 보기" },
  { q: "선물은?", a: "깜짝 선물", b: "갖고 싶은 거" },
  { q: "너는?", a: "아침형 인간", b: "올빼미" },
  { q: "비 오는 날엔?", a: "창밖 보며 집콕", b: "우산 쓰고 산책" },
  { q: "평생 하나만 먹는다면?", a: "떡볶이", b: "치킨" },
  { q: "딱 하루만 가 본다면?", a: "10년 전", b: "10년 뒤" },
  { q: "잠들기 전엔?", a: "통화하다 잠들기", b: "굿나잇 한 줄" },
  { q: "첫눈 오는 날엔?", a: "무조건 만나기", b: "통화로 같이 보기" },
  { q: "치킨은?", a: "후라이드", b: "양념" },
  { q: "길을 잃으면?", a: "지도 앱부터", b: "일단 걸어 보기" },
  { q: "영화 보다 무서운 장면에서?", a: "눈 가리기", b: "끝까지 보기" },
  { q: "기념일은?", a: "꼭 챙기기", b: "매일이 기념일" },
  { q: "물냉면 vs 비빔냉면?", a: "물냉", b: "비냉" },
];

const MEAL: Question[] = [
  { q: "맛집 웨이팅은?", a: "1시간도 OK", b: "10분이 한계" },
  { q: "고기는 누가 굽지?", a: "내가 굽는다", b: "구워 주는 거 먹기" },
  { q: "마지막 한 점은?", a: "양보한다", b: "가위바위보" },
  { q: "메뉴는?", a: "먹던 거", b: "처음 보는 거" },
  { q: "배불러도 디저트 배는?", a: "따로 있다", b: "진짜 없다" },
];

const BY_KIND: Record<Kind, Question[]> = {
  meal: MEAL,
  dinner: MEAL,
  cafe: [
    { q: "커피는?", a: "아아", b: "따뜻한 라떼" },
    { q: "케이크는?", a: "생크림", b: "초코" },
    { q: "카페에선?", a: "수다 떨기", b: "각자 하면서 같이" },
    { q: "한겨울 빙수는?", a: "먹는다", b: "여름에만" },
    { q: "자리는?", a: "창가", b: "구석 소파" },
  ],
  play: [
    { q: "사진 찍을 때?", a: "연출 컷", b: "자연스러운 컷" },
    { q: "게임은?", a: "이길 때까지", b: "딱 한 판" },
    { q: "방탈출에서 나는?", a: "머리 쓰는 역", b: "응원 담당" },
    { q: "같이 배운다면?", a: "요리", b: "춤" },
  ],
  drink: [
    { q: "첫 잔은?", a: "소주", b: "맥주" },
    { q: "취하면?", a: "말이 많아진다", b: "잠이 온다" },
    { q: "안주는?", a: "국물", b: "튀김" },
  ],
  walk: [
    { q: "산책할 땐?", a: "손잡고 천천히", b: "목적지 정하고" },
    { q: "밤 산책엔?", a: "이어폰 하나씩", b: "대화만" },
    { q: "걷다 보이는 편의점은?", a: "그냥 못 지나쳐", b: "지나간다" },
  ],
};

/** Two random halves (either may be the bigger one). */
function split<T>(xs: T[]): [T[], T[]] {
  const s = shuffle(xs);
  const h = Math.random() < 0.5 ? Math.floor(s.length / 2) : Math.ceil(s.length / 2);
  return [s.slice(0, h), s.slice(h)];
}

/**
 * Balance game: answer "this or that" questions about yourself. Behind each answer sits a
 * secret half of the places still in play; the other half drops out, until one is left.
 */
export function Balance({ candidates, kind, indexOf, onPicked, onFocus }: GameProps) {
  const [deck] = useState(() =>
    shuffle([...shuffle(BY_KIND[kind]).slice(0, 2), ...shuffle(COMMON).slice(0, 4)]),
  );
  const [game, setGame] = useState(() => ({
    left: candidates,
    sides: split(candidates),
    round: 0,
    answers: [] as string[],
  }));
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const tileEls = useRef(new Map<string, HTMLDivElement | null>());
  const optEls = useRef<(HTMLButtonElement | null)[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (f: () => void, ms: number) =>
    timers.current.push(window.setTimeout(f, reducedMotion() ? 30 : ms));

  // the places still in play stand out on the map
  useEffect(() => onFocus?.(game.left.map((p) => p.id)), [game.left, onFocus]);

  const question = deck[game.round % deck.length];
  const left = new Set(game.left.map((p) => p.id));

  const answer = (k: 0 | 1) => {
    if (chosen !== null || winner) return;
    setChosen(k);
    sfx.pop();
    haptic(14);
    burst(optEls.current[k], [...aura(k)], 14, 0.6);
    const keep = game.sides[k];
    const said = [...game.answers, k ? question.b : question.a];
    later(() => {
      sfx.whoosh();
      haptic([8, 30, 8]);
      if (keep.length === 1) {
        setGame({ ...game, left: keep, answers: said });
        setWinner(keep[0].id);
        later(() => {
          sfx.chime();
          onPicked(keep[0], tileEls.current.get(keep[0].id) ?? null);
        }, 900);
        return;
      }
      setGame({ left: keep, sides: split(keep), round: game.round + 1, answers: said });
      setChosen(null);
    }, 620);
  };

  return (
    <div className="bal">
      <div className="wc-top">
        <span className="wc-round">
          {winner ? "결과" : `Q${game.round + 1}`}
          <span className="it">남은 곳 {game.left.length}</span>
        </span>
        <span className="ticks" aria-hidden="true">
          {candidates.map((p) => (
            <i key={p.id} className={left.has(p.id) ? "on" : ""} />
          ))}
        </span>
      </div>

      {winner ? (
        <p className="bal-said">
          네 대답 <b>{game.answers.join(" · ")}</b>
        </p>
      ) : (
        <div className="bal-card" key={game.round}>
          <h3 className="bal-q">{question.q}</h3>
          <div className="bal-opts">
            {([0, 1] as const).map((k) => (
              <Option
                key={k}
                side={k}
                text={k ? question.b : question.a}
                state={chosen === null ? "" : chosen === k ? "chosen" : "dropped"}
                refCb={(el) => {
                  optEls.current[k] = el;
                }}
                onChoose={() => answer(k)}
              />
            ))}
            <span className="bal-vs" aria-hidden="true">
              vs
            </span>
          </div>
        </div>
      )}

      <ul className="bal-places" aria-label="남은 후보">
        {candidates.map((p) => (
          <li
            key={p.id}
            className={winner === p.id ? "win" : left.has(p.id) ? "" : "out"}
            aria-hidden={!left.has(p.id)}
          >
            <Tile
              ref={(el) => {
                tileEls.current.set(p.id, el);
              }}
              index={indexOf(p)}
              image={p.image_url}
            />
            <span>{p.name}</span>
          </li>
        ))}
      </ul>
      {!winner && (
        <p className="hint">고를 때마다 절반이 떨어져 · 어느 답이 어디를 지킬지는 비밀</p>
      )}
    </div>
  );
}

function Option(props: {
  side: 0 | 1;
  text: string;
  state: "" | "chosen" | "dropped";
  refCb: (el: HTMLButtonElement | null) => void;
  onChoose: () => void;
}) {
  const { side, text, state, refCb, onChoose } = props;
  const lean = useRef<HTMLDivElement>(null);
  useReactive(lean, { tilt: 10, magnet: 6 });
  return (
    <button
      ref={refCb}
      className={`bal-opt ${state}`}
      style={auraVars(side) as CSSProperties}
      disabled={state !== ""}
      aria-label={`${text} 고르기`}
      onClick={onChoose}
    >
      <div className="r tile" ref={lean}>
        <span className="ab">{side ? "B" : "A"}</span>
        <span className="tx">{text}</span>
        <span className="glare" />
      </div>
    </button>
  );
}
