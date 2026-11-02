import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  buildDraftModel,
  currentSide,
  initialSimState,
  sideForSlot,
  simReducer,
  slotsFor,
  suggestAiBan,
  suggestAiPick,
  type AiStyle,
  type DraftPick,
  type DraftSide,
  type SimLogEntry,
} from "../lib/draft-sim";
import { monsterName } from "../lib/monsters";
import type { PlayerInfo, RtaMatch } from "../lib/types";
import { MonsterIcon } from "./MonsterIcon";
import { MonsterPickerModal } from "./MonsterPicker";

const AI_STYLES: { key: AiStyle; label: string }[] = [
  { key: "habit", label: "照習慣（加權抽樣）" },
  { key: "top", label: "最常出（固定最佳）" },
];

const pct = (n: number | null): string =>
  n === null ? "–" : `${(n * 100).toFixed(0)}%`;

function playerLabel(player: PlayerInfo): string {
  return player.username || `#${player.id}`;
}

interface TeamProps {
  side: DraftSide;
  title: string;
  subtitle: string;
  slots: readonly number[];
  picks: DraftPick[];
  ban: number | null;
  canBan: boolean;
  onBan: (id: number) => void;
}

function Team({ side, title, subtitle, slots, picks, ban, canBan, onBan }: TeamProps) {
  return (
    <section className={`card sim-team ${side}`} aria-label={title}>
      <div className="sim-team-head">
        <div>
          <h3>{title}</h3>
          <span>{subtitle}</span>
        </div>
        <b className="sim-team-count">{picks.length}/5</b>
      </div>

      <div className="sim-slots">
        {slots.map((slot) => {
          const pick = picks.find((p) => p.slot === slot);
          if (!pick) {
            return (
              <div className="sim-slot empty" key={slot}>
                <span className="sim-slot-no">{slot}</span>
                <span className="sim-slot-wait">—</span>
              </div>
            );
          }

          const banned = ban === pick.id;
          const clickable = canBan && side === "ai";
          return (
            <button
              type="button"
              key={slot}
              className={`sim-slot${banned ? " banned" : ""}${clickable ? " clickable" : ""}`}
              onClick={clickable ? () => onBan(pick.id) : undefined}
              disabled={!clickable}
              title={
                clickable
                  ? `ban 掉 ${monsterName(pick.id)}`
                  : `${monsterName(pick.id)}（第 ${slot} 手）`
              }
            >
              <span className="sim-slot-no">{slot}</span>
              <MonsterIcon id={pick.id} size={36} banned={banned} />
              <span className="sim-slot-name">{monsterName(pick.id)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DraftOrder({
  picks,
  aiFirst,
  current,
}: {
  picks: DraftPick[];
  aiFirst: boolean;
  current: number | null;
}) {
  return (
    <div className="sim-order" aria-label="選秀順序">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => {
        const side = sideForSlot(slot, aiFirst);
        const done = picks.some((p) => p.slot === slot);
        return (
          <span
            key={slot}
            className={`${side}${done ? " done" : ""}${current === slot ? " on" : ""}`}
            title={`第 ${slot} 手・${side === "ai" ? "AI" : "你"}`}
          >
            {slot}
          </span>
        );
      })}
    </div>
  );
}

function LogList({ log }: { log: SimLogEntry[] }) {
  if (!log.length) {
    return <p className="sim-empty">開始選角後，AI 的判斷依據會出現在這裡。</p>;
  }

  return (
    <div className="sim-log-list">
      {[...log].reverse().map((entry, i) => (
        <div className="sim-log-item" key={`${entry.action}-${entry.side}-${entry.id}-${i}`}>
          <div className="sim-log-line">
            <span className={`sim-badge ${entry.side}`}>
              {entry.side === "ai" ? "AI" : "你"}
            </span>
            <span>
              {entry.action === "pick"
                ? `第 ${entry.slot} 手選了 `
                : "ban 了 "}
              <b>{monsterName(entry.id)}</b>
            </span>
          </div>
          {entry.note && <div className="sim-log-note">{entry.note}</div>}
        </div>
      ))}
    </div>
  );
}

interface Props {
  matches: RtaMatch[];
  player: PlayerInfo;
  seasonLabel: string;
}

export function DraftSimulator({ matches, player, seasonLabel }: Props) {
  const model = useMemo(() => buildDraftModel(matches), [matches]);
  const [aiFirst, setAiFirst] = useState(false);
  const [style, setStyle] = useState<AiStyle>("habit");
  const [draft, dispatch] = useReducer(simReducer, undefined, initialSimState);
  const [pickerOpen, setPickerOpen] = useState(false);
  const generation = useRef(0);

  // 換邊或換資料時重置；第一次掛載不重置（避免把使用者一開始的點擊洗掉）。
  // generation 讓舊的 AI timer 失效。
  const resetKey = `${aiFirst}:${matches.length}:${matches[0]?.battleId ?? 0}:${matches[matches.length - 1]?.battleId ?? 0}`;
  const lastResetKey = useRef(resetKey);

  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    generation.current++;
    dispatch({ type: "reset" });
    setPickerOpen(false);
  }, [resetKey]);

  const turn = currentSide(draft.picks, aiFirst);
  const phase: "pick" | "ban" | "done" =
    draft.picks.length < 10 ? "pick" : draft.userBan === null ? "ban" : "done";
  const canUserPick = phase === "pick" && turn === "user";
  const canUserBan = phase === "ban" && draft.userBan === null;

  const aiPicks = draft.picks.filter((p) => p.side === "ai");
  const userPicks = draft.picks.filter((p) => p.side === "user");
  const lastLog = draft.log[draft.log.length - 1] ?? null;

  // AI 自動選角：每次輪到 AI 就排一個短延遲，連續手會自動接著選
  useEffect(() => {
    if (model.matches === 0) return;
    if (phase !== "pick" || turn !== "ai") return;

    const gen = generation.current;
    const slot = draft.picks.length + 1;
    const timer = window.setTimeout(() => {
      if (generation.current !== gen) return;
      const suggestion = suggestAiPick(model, aiFirst, draft.picks, style);
      if (!suggestion) return;
      const note =
        suggestion.rate === null
          ? suggestion.basis
          : `${suggestion.basis}・${pct(suggestion.rate)} 出這隻`;
      dispatch({
        type: "pick",
        side: "ai",
        id: suggestion.id,
        slot,
        aiFirst,
        note,
      });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [aiFirst, draft.picks, model, phase, style, turn]);

  const used = useMemo(() => new Set(draft.picks.map((p) => p.id)), [draft.picks]);

  // 不是玩家的回合時，關閉選角視窗
  useEffect(() => {
    if (!canUserPick) setPickerOpen(false);
  }, [canUserPick]);

  function resetSim() {
    generation.current++;
    dispatch({ type: "reset" });
    setPickerOpen(false);
  }

  function handlePickerPick(id: number) {
    if (!canUserPick || used.has(id)) return;
    dispatch({
      type: "pick",
      side: "user",
      id,
      slot: draft.picks.length + 1,
      aiFirst,
    });
    setPickerOpen(false);
  }

  function handleBan(id: number) {
    if (!canUserBan) return;
    if (!draft.picks.some((p) => p.side === "ai" && p.id === id)) return;
    const ban = suggestAiBan(model, userPicks, style);
    if (!ban) return;
    dispatch({
      type: "bans",
      userBan: id,
      aiBan: ban.id,
      note: ban.basis,
    });
  }

  if (model.matches === 0) {
    return (
      <div className="empty-inline">
        <p>沒有可用的對局</p>
        <span>先載入這位玩家的賽季資料，或把「顯示」的賽季範圍拉大。</span>
      </div>
    );
  }

  return (
    <div className="sim">
      <div className="card sim-top">
        <div>
          <h2>模擬 BP</h2>
          <p>
            你當對手，AI 當 <b>{playerLabel(player)}</b>。AI 會依目前顯示賽季{" "}
            <b>{seasonLabel}</b> 的 <b>{model.matches}</b> 場對戰紀錄自動選角／ban。
          </p>
          <p className="sim-note">
            使用目前顯示賽季的全部對局建模，不受上方勝負／魔靈篩選影響。想看更多樣本，把「顯示」拉長（例如 37–39）；想看近期習慣，只留 S39。
          </p>
          {model.matches < 20 && (
            <p className="sim-warn">樣本較少，AI 會比較常退回整體習慣。</p>
          )}
          {model.aiPool.size < 10 && (
            <p className="sim-warn">這位玩家的歷史角色較少，AI 會混入整體池。</p>
          )}
        </div>

        <div className="sim-controls">
          <label>
            <span>AI 位置</span>
            <select
              value={aiFirst ? "first" : "second"}
              onChange={(e) => setAiFirst(e.target.value === "first")}
            >
              <option value="second">AI 後手（你先搶）</option>
              <option value="first">AI 先手（你後手）</option>
            </select>
          </label>
          <label>
            <span>AI 風格</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as AiStyle)}
            >
              {AI_STYLES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn ghost sm" onClick={resetSim}>
            重新開始
          </button>
        </div>
      </div>

      <div className="sim-arena">
        <Team
          side="ai"
          title={`AI・${playerLabel(player)}`}
          subtitle={aiFirst ? "先手" : "後手"}
          slots={slotsFor("ai", aiFirst)}
          picks={aiPicks}
          ban={draft.userBan}
          canBan={canUserBan}
          onBan={handleBan}
        />

        <div className="card sim-turn">
          <span className="sim-round">
            {phase === "pick"
              ? `第 ${draft.picks.length + 1} 手`
              : phase === "ban"
                ? "Ban 階段"
                : "BP 完成"}
          </span>
          <strong className={turn === "ai" ? "ai-thinking" : ""}>
            {phase === "pick"
              ? turn === "ai"
                ? "AI 思考中…"
                : "輪到你選"
              : phase === "ban"
                ? "換你 ban"
                : "雙方陣容出爐"}
          </strong>
          {phase === "pick" && turn === "user" && (
            <button
              type="button"
              className="btn primary sm sim-jump"
              onClick={() => setPickerOpen(true)}
            >
              選擇魔靈
            </button>
          )}
          <DraftOrder
            picks={draft.picks}
            aiFirst={aiFirst}
            current={phase === "pick" ? draft.picks.length + 1 : null}
          />
        </div>

        <Team
          side="user"
          title="你"
          subtitle={aiFirst ? "後手" : "先手"}
          slots={slotsFor("user", aiFirst)}
          picks={userPicks}
          ban={draft.aiBan}
          canBan={false}
          onBan={handleBan}
        />
      </div>

      <div className="sim-bottom">
        <div className="card sim-pool">
          <div className="card-head">
            <h3>
              {phase === "ban"
                ? "Ban 階段"
                : phase === "done"
                  ? "BP 完成"
                  : "選角"}
            </h3>
            <span className="card-note">
              {phase === "pick"
                ? canUserPick
                  ? `第 ${draft.picks.length + 1} 隻・共 5 隻`
                  : "AI 正在選…"
                : ""}
            </span>
          </div>

          {lastLog && (
            <div className="sim-latest">
              <span className={`sim-badge ${lastLog.side}`}>
                {lastLog.side === "ai" ? "AI" : "你"}
              </span>
              <span>
                {lastLog.action === "pick"
                  ? `第 ${lastLog.slot} 手選了 `
                  : "ban 了 "}
                <b>{monsterName(lastLog.id)}</b>
              </span>
              {lastLog.note && <em>{lastLog.note}</em>}
            </div>
          )}

          {phase === "ban" ? (
            <div className="sim-ban-hint">
              <strong>請 ban 掉 AI 的一隻</strong>
              <span>點下面其中一隻；AI 也會同時 ban 你的一隻。</span>
              <div className="sim-ban-grid">
                {aiPicks.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className="sim-ban-mon"
                    onClick={() => handleBan(p.id)}
                  >
                    <MonsterIcon id={p.id} size={38} />
                    <span>{monsterName(p.id)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : phase === "done" ? (
            <div className="sim-result">
              <strong>BP 完成</strong>
              <span>
                AI ban 了 <b>{draft.aiBan ? monsterName(draft.aiBan) : "–"}</b>
                　・　你 ban 了{" "}
                <b>{draft.userBan ? monsterName(draft.userBan) : "–"}</b>
              </span>
              <button type="button" className="btn primary sm" onClick={resetSim}>
                再來一場
              </button>
            </div>
          ) : canUserPick ? (
            <div className="sim-pick-cta">
              <div>
                <strong>選擇第 {draft.picks.length + 1} 隻魔靈</strong>
                <span>
                  用搜尋、元素、胎生星級與「只顯示已覺醒」快速縮小範圍。
                </span>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => setPickerOpen(true)}
              >
                開啟選擇器
              </button>
            </div>
          ) : (
            <div className="sim-waiting">
              <span className="sim-waiting-dot" aria-hidden />
              AI 正在選第 {draft.picks.length + 1} 隻…
            </div>
          )}
        </div>

        <div className="card sim-log">
          <div className="card-head">
            <h3>選秀紀錄 / AI 依據</h3>
            <span className="card-note">樣本數會標在 AI 的判斷旁</span>
          </div>
          <LogList log={draft.log} />
        </div>
      </div>

      {pickerOpen && canUserPick && (
        <MonsterPickerModal
          title={`選擇第 ${draft.picks.length + 1} 隻魔靈`}
          used={used}
          aiCounts={model.overall}
          oppCounts={model.oppOverall}
          pickedCount={userPicks.length}
          onPick={handlePickerPick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
