import { WHEEL } from '../config';

/** Sector count; Game's selection math derives its angle step from this. */
export const WHEEL_SECTOR_COUNT = 7;

export interface WheelSector {
  key: string;
  label: string;
  /** Ammo line: "12 / 60" for guns, "× 2" for throwables, "R2" for melee. */
  sub: string;
  enabled: boolean;
}

/**
 * Days Gone-style radial weapon wheel. Pure DOM/CSS overlay (no canvas);
 * opacity transitions run on wall-clock time so the fade is unaffected by
 * the gameplay slow-mo that accompanies it. WHEEL_SECTOR_COUNT fixed sectors
 * clockwise from 12 o'clock; selection is driven externally from pointer-lock
 * mouse deltas (Game owns the vector math, this class only renders).
 */
export class WeaponWheel {
  private container: HTMLElement;
  private sectorEls: HTMLElement[] = [];
  private subEls: HTMLElement[] = [];
  private centerEl: HTMLElement;
  private sectors: WheelSector[] = [];
  private selection = -1;

  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      #wheel { position: absolute; inset: 0; z-index: 6; pointer-events: none;
               opacity: 0; transition: opacity .12s; font-family: system-ui, sans-serif;
               background: radial-gradient(ellipse at center,
                 rgba(0,0,0,${WHEEL.vignetteOpacity * 0.35}) 30%,
                 rgba(0,0,0,${WHEEL.vignetteOpacity}) 100%); }
      #wheel.open { opacity: 1; }
      #wheel .sector { position: absolute; left: 50%; top: 50%; width: 110px;
               padding: 8px 6px; margin-left: -55px; text-align: center;
               color: #e8ecf2; background: rgba(14,17,22,.72);
               border: 1px solid rgba(230,235,245,.28); border-radius: 8px;
               transition: transform .08s, border-color .08s, background .08s; }
      #wheel .sector .name { font-size: 13px; letter-spacing: 2px; font-weight: 700;
               text-transform: uppercase; }
      #wheel .sector .sub { font-size: 11px; opacity: .75; margin-top: 2px; }
      #wheel .sector.sel { border-color: #ffb070; background: rgba(40,30,20,.85);
               transform: scale(1.12); }
      #wheel .sector.off { opacity: .35; }
      #wheel #wheel-center { position: absolute; left: 50%; top: 50%;
               transform: translate(-50%, -50%); color: #ffb070; font-size: 15px;
               letter-spacing: 3px; font-weight: 700; text-transform: uppercase;
               text-shadow: 0 1px 4px rgba(0,0,0,.9); }
    `;
    document.head.appendChild(style);

    this.container = document.createElement('div');
    this.container.id = 'wheel';
    document.body.appendChild(this.container);

    // Slots on a radius-150 circle, clockwise from 12 o'clock.
    for (let i = 0; i < WHEEL_SECTOR_COUNT; i++) {
      const a = (i * 2 * Math.PI) / WHEEL_SECTOR_COUNT;
      const el = document.createElement('div');
      el.className = 'sector';
      el.style.transform = '';
      el.style.marginTop = '-24px';
      el.style.left = `calc(50% + ${Math.round(Math.sin(a) * 150)}px)`;
      el.style.top = `calc(50% - ${Math.round(Math.cos(a) * 150)}px)`;
      el.innerHTML = `<div class="name"></div><div class="sub"></div>`;
      this.container.appendChild(el);
      this.sectorEls.push(el);
      this.subEls.push(el.querySelector('.sub')!);
    }
    this.centerEl = document.createElement('div');
    this.centerEl.id = 'wheel-center';
    this.container.appendChild(this.centerEl);
  }

  get isOpen(): boolean {
    return this.container.classList.contains('open');
  }

  open(sectors: WheelSector[]): void {
    this.sectors = sectors;
    for (let i = 0; i < WHEEL_SECTOR_COUNT; i++) {
      const s = sectors[i];
      const el = this.sectorEls[i];
      el.querySelector('.name')!.textContent = s.label;
      this.subEls[i].textContent = s.sub;
      el.classList.toggle('off', !s.enabled);
      el.classList.remove('sel');
    }
    this.selection = -1;
    this.centerEl.textContent = '';
    this.container.classList.add('open');
  }

  close(): void {
    this.container.classList.remove('open');
  }

  /** Live sub-text refresh (a reload can complete while the wheel is open). */
  refresh(sectors: WheelSector[]): void {
    this.sectors = sectors;
    for (let i = 0; i < WHEEL_SECTOR_COUNT; i++) {
      this.subEls[i].textContent = sectors[i].sub;
      this.sectorEls[i].classList.toggle('off', !sectors[i].enabled);
    }
  }

  setSelection(i: number): void {
    if (i === this.selection) return;
    this.selection = i;
    for (let s = 0; s < WHEEL_SECTOR_COUNT; s++) this.sectorEls[s].classList.toggle('sel', s === i);
    this.centerEl.textContent = i >= 0 && this.sectors[i]?.enabled ? this.sectors[i].label : '';
  }
}
