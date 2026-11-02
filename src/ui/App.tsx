import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Game, type GameSnapshot } from '../game/Game';
import { AIRCRAFT_LIST } from '../game/aircraft/Aircraft';
import type { AircraftId } from '../game/aircraft/types';
import type { CameraMode } from '../game/camera/ChaseCamera';

const CONTROLS: [string, string][] = [
  ['↑ / ↓', 'Pitch up / down'],
  ['A D · ← →', 'Roll left / right'],
  ['Q / E', 'Yaw left / right'],
  ['W / S', 'Throttle up / down'],
  ['Shift (hold)', 'Afterburner'],
  ['X (hold)', 'Airbrake'],
  ['C', 'Camera: Aircraft / Horizon lock'],
  ['R', 'Reset aircraft'],
  ['P / Esc', 'Pause'],
  ['H', 'Show / hide this help'],
];

/** Drop focus after a click so keyboard flight input never re-triggers buttons. */
const blur = (e: MouseEvent<HTMLButtonElement>) => e.currentTarget.blur();

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [selected, setSelected] = useState<AircraftId>('f22');
  const [help, setHelp] = useState(true);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const status = snap?.status ?? 'menu';
  const inMenu = status === 'menu' || status === 'loading';
  const canResume = inMenu && snap?.aircraftId === selected && status === 'menu';

  const fly = (e: MouseEvent<HTMLButtonElement>) => {
    blur(e);
    if (canResume) game.current?.resume();
    else void game.current?.fly(selected);
  };

  const setCam = (mode: CameraMode) => (e: MouseEvent<HTMLButtonElement>) => {
    blur(e);
    game.current?.setCameraMode(mode);
  };

  return (
    <div className="app">
      <div className="viewport" ref={host} />

      {!inMenu && snap && (
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Camera mode">
            <button className={snap.cameraMode === 'aircraft' ? 'on' : ''} onClick={setCam('aircraft')}>
              Aircraft lock
            </button>
            <button className={snap.cameraMode === 'horizon' ? 'on' : ''} onClick={setCam('horizon')}>
              Horizon lock
            </button>
          </div>
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

      {status === 'paused' && (
        <div className="center-banner">
          <strong>Paused</strong>
          <span>
            Press <kbd>P</kbd> to resume
          </span>
        </div>
      )}

      {inMenu && (
        <div className="menu">
          <header>
            <p className="eyebrow">Flight test range · prototype</p>
            <h1>Flight Playground</h1>
            <p className="lede">
              Pick an airframe and take it up. Fly through the rings, under the bridges and down the canyon.
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
            {CONTROLS.slice(0, 8).map(([k, v]) => (
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
