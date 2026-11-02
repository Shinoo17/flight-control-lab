import { MOUSE } from '../config';

/**
 * Raw mouse state under the Pointer Lock API: accumulated movement deltas
 * (consumed once per frame) and lock status. The lock is requested on
 * `target`; movement events arrive on the document while it is held.
 */
export class MouseInput {
  /** Fired whenever the lock is gained or lost (Esc, alt-tab, exitPointerLock). */
  onLockChange: ((locked: boolean) => void) | null = null;
  private dx = 0;
  private dy = 0;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('pointerlockchange', this.onLockChanged);
    // Right click is reserved for weapons: never open the browser menu.
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /**
   * Must run inside a user gesture (click / keydown). Raw, unaccelerated
   * movement is asked for first; browsers without it fall back to the default.
   */
  requestLock(): void {
    if (this.locked) return;
    const el = this.target as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch((e: DOMException) => {
          // Unsupported option: retry plain. Anything else (e.g. Chrome's
          // ~1 s cooldown after Esc) is left to the next click.
          if (e?.name === 'NotSupportedError') void Promise.resolve(el.requestPointerLock()).catch(() => {});
        });
      }
    } catch {
      // Older browsers throw synchronously for unknown options.
      try {
        void el.requestPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Movement since the last call, in CSS pixels. */
  consume(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  /** Drop any pending movement (pause, menus, mode switches). */
  discard(): void {
    this.dx = 0;
    this.dy = 0;
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('pointerlockchange', this.onLockChanged);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
    this.exitLock();
    this.onLockChange = null;
  }

  private readonly onMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // Some platforms report a huge jump right after locking; ignore those.
    if (Math.abs(e.movementX) > MOUSE.maxEventDelta || Math.abs(e.movementY) > MOUSE.maxEventDelta) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private readonly onLockChanged = () => {
    this.discard();
    this.onLockChange?.(this.locked);
  };

  private readonly onContextMenu = (e: Event) => e.preventDefault();
}
