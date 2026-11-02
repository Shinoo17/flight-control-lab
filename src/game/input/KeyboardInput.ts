/**
 * Raw keyboard state, keyed by `KeyboardEvent.code` so the bindings work on
 * any layout (Thai, Dvorak...) and are not affected by Shift.
 */

const BLOCK_DEFAULT = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly target: Window;

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** True while the key is held. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /**
   * True if any key is held, or was pressed this frame — so a tap shorter
   * than one frame (keydown and keyup between two frames) still registers.
   */
  anyDown(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c) || this.pressedThisFrame.has(c)) return true;
    return false;
  }

  /** True once per physical press (key repeat ignored). Cleared by `endFrame`. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.down.clear();
  }

  private readonly onDown = (e: KeyboardEvent) => {
    if (isTextField(e.target)) return;
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedThisFrame.add(e.code);
  };

  private readonly onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  /** Losing focus never delivers keyup, so drop everything to avoid stuck keys. */
  private readonly onBlur = () => {
    this.down.clear();
  };
}

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
