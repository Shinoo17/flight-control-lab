import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Game, type GameSnapshot } from '../game/Game';
import { AIRCRAFT_LIST } from '../game/aircraft/Aircraft';
import type { AircraftId } from '../game/aircraft/types';
import { CAMERA_MODES, CAMERA_MODE_LABEL, type CameraMode } from '../game/camera/ChaseCamera';
import type { AimLimit, InputMode } from '../game/input/ControlMixer';
import { formatRaceTime, type RaceRecord } from '../game/race/RaceRecords';
import { RACE } from '../game/config';

const CONTROLS: [string, string][] = [
  ['Mouse', 'Aim (mouse mode)'],
  ['↑ / ↓', 'Pitch up / down'],
  ['A D · ← →', 'Roll left / right'],
  ['Q / E', 'Yaw left / right'],
  ['W / S', 'Throttle up / down'],
  ['Shift (hold)', 'Afterburner'],
  ['X (hold)', 'Airbrake'],
  ['C (hold)', 'Free look (mouse mode)'],
  ['V', 'Camera: Aircraft / Horizon / Aim lock'],
  ['M', 'Input: Mouse + keyboard / Keyboard only'],
  ['G', 'Aim: Limited (cone) / Free (anywhere)'],
  ['R', 'Reset aircraft'],
  ['P', 'Pause / resume'],
  ['Esc', 'Pause (releases the mouse)'],
  ['L', 'Show / hide ring-course times'],
  ['H', 'Show / hide this help'],
];

const INPUT_LABEL: Record<InputMode, string> = { mouse: 'Mouse + keys', keyboard: 'Keyboard' };
const AIM_LIMIT_LABEL: Record<AimLimit, string> = { limited: 'Aim limited', free: 'Aim free' };

const AIRCRAFT_NAME = Object.fromEntries(AIRCRAFT_LIST.map((a) => [a.id, a.name])) as Record<AircraftId, string>;

function Records({ records, className }: { records: RaceRecord[]; className: string }) {
  return (
    <aside className={`records ${className}`}>
      <h3>Ring course · top {RACE.maxRecords}</h3>
      {records.length === 0 ? (
        <p className="records-empty">No runs yet. Fly through ring 1 to start the clock, then every ring in order.</p>
      ) : (
        <ol>
          {records.map((r, i) => (
            <li key={`${r.date}-${i}`}>
              <span className="rank">{i + 1}</span>
              <span className="time">{formatRaceTime(r.time)}</span>
              <span className="ac">{AIRCRAFT_NAME[r.aircraft] ?? r.aircraft}</span>
              <span className="date">{new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/** Drop focus after a click so keyboard flight input never re-triggers buttons. */
const blur = (e: MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [selected, setSelected] = useState<AircraftId>('f22');
  const [help, setHelp] = useState(true);
  const [showRecords, setShowRecords] = useState(false);

  useEffect(() => {
    const g = new Game(host.current!);
    game.current = g;
    const off = g.onChange(setSnap);
    return () => {
      off();
      g.dispose();
      game.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH' && !e.repeat) setHelp((h) => !h);
      if (e.code === 'KeyL' && !e.repeat) setShowRecords((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const status = snap?.status ?? 'menu';
  const inMenu = status === 'menu' || status === 'loading';
  const canResume = inMenu && snap?.aircraftId === selected && status === 'menu';

  const fly = (e: MouseEvent<HTMLButtonElement>) => {
    blur(e);
    // Pointer lock needs this click's user gesture, so ask before any await.
    game.current?.captureMouse();
    if (canResume) game.current?.resume();
    else void game.current?.fly(selected);
  };

  const setCam = (mode: CameraMode) => (e: MouseEvent<HTMLButtonElement>) => {
    blur(e);
    game.current?.setCameraMode(mode);
  };

  const setInput = (mode: InputMode) => (e: MouseEvent<HTMLButtonElement>) => {
    blur(e);
    game.current?.setInputMode(mode);
  };

  const setAimLimit = (limit: AimLimit) => (e: MouseEvent<HTMLButtonElement>) => {
    blur(e);
    game.current?.setAimLimit(limit);
  };

  return (
    <div className="app">
      <div className="viewport" ref={host} />

      {!inMenu && snap && (
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Camera mode">
            {CAMERA_MODES.map((m) => (
              <button key={m} className={snap.cameraMode === m ? 'on' : ''} onClick={setCam(m)}>
                {CAMERA_MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Input mode">
            {(['mouse', 'keyboard'] as const).map((m) => (
              <button key={m} className={snap.inputMode === m ? 'on' : ''} onClick={setInput(m)}>
                {INPUT_LABEL[m]}
              </button>
            ))}
          </div>
          {snap.inputMode === 'mouse' && (
            <div className="segmented" role="group" aria-label="Aim range">
              {(['limited', 'free'] as const).map((m) => (
                <button key={m} className={snap.aimLimit === m ? 'on' : ''} onClick={setAimLimit(m)}>
                  {AIM_LIMIT_LABEL[m]}
                </button>
              ))}
            </div>
          )}
          <button
            className="tool"
            onClick={(e) => {
              blur(e);
              game.current?.resetFlight();
            }}
          >
            Reset <kbd>R</kbd>
          </button>
          <button
            className="tool"
            onClick={(e) => {
              blur(e);
              game.current?.showMenu();
            }}
          >
            Aircraft
          </button>
        </div>
      )}

      {!inMenu && help && (
        <aside className="help">
          <h3>Controls</h3>
          <dl>
            {CONTROLS.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}

      {!inMenu && showRecords && snap && <Records records={snap.records} className="in-flight" />}

      {status === 'paused' && (
        <div className="center-banner">
          <strong>Paused</strong>
          <span>
            {snap?.inputMode === 'mouse' ? (
              <>
                Click the view or press <kbd>P</kbd> to resume
              </>
            ) : (
              <>
                Press <kbd>P</kbd> to resume
              </>
            )}
          </span>
        </div>
      )}

      {inMenu && snap && <Records records={snap.records} className="in-menu" />}

      {inMenu && (
        <div className="menu">
          <header>
            <p className="eyebrow">Flight test range · prototype</p>
            <h1>Flight Playground</h1>
            <p className="lede">
              Pick an airframe and take it up. Race the rings against the clock, fly under the bridges and down the canyon.
            </p>
          </header>

          <div className="cards" role="radiogroup" aria-label="Aircraft">
            {AIRCRAFT_LIST.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={selected === a.id}
                className={`card ${selected === a.id ? 'selected' : ''}`}
                onClick={(e) => {
                  blur(e);
                  setSelected(a.id);
                }}
              >
                <span className="card-name">{a.name}</span>
                <span className="card-tag">{a.tagline}</span>
                <span className="card-meta">Length {a.lengthMeters.toFixed(1)} m</span>
              </button>
            ))}
          </div>

          <button className="fly" disabled={status === 'loading'} onClick={fly}>
            {status === 'loading' ? 'Loading model…' : canResume ? 'Resume flight' : 'Fly'}
          </button>
          {snap?.error && <p className="error">{snap.error}</p>}

          <dl className="menu-keys">
            {CONTROLS.slice(0, 9).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
