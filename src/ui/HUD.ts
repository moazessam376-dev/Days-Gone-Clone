/**
 * DOM-overlay HUD: reticle with spread-driven bloom ring, hitmarker, ammo
 * counter, weapon name, and health bar. Pure DOM/CSS — no canvas cost.
 */
export class HUD {
  private reticleTicks: HTMLElement[] = [];
  private hitmarker!: HTMLElement;
  private ammoEl!: HTMLElement;
  private weaponEl!: HTMLElement;
  private healthFill!: HTMLElement;
  private vignette!: HTMLElement;
  private death!: HTMLElement;
  private hitmarkerUntil = 0;
  private vignetteUntil = 0;
  private toastEl!: HTMLElement;
  private toastUntil = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      #hud { position: absolute; inset: 0; pointer-events: none; z-index: 5;
             font-family: system-ui, sans-serif; }
      #reticle { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
      #reticle .dot { position: absolute; left: -2px; top: -2px; width: 4px; height: 4px;
                      background: #e8ecf2; border-radius: 50%; opacity: .9; }
      #reticle .tick { position: absolute; background: #e8ecf2; opacity: .85;
                       box-shadow: 0 0 2px rgba(0,0,0,.8); }
      #reticle .t, #reticle .b { left: -1px; width: 2px; height: 7px; }
      #reticle .l, #reticle .r { top: -1px; height: 2px; width: 7px; }
      #hitmarker { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
      #hitmarker span { position: absolute; width: 2px; height: 8px; background: #fff; }
      #hitmarker.kill span { background: #ff5040; }
      #hitmarker span:nth-child(1) { transform: translate(-6px,-10px) rotate(45deg); }
      #hitmarker span:nth-child(2) { transform: translate(4px,-10px) rotate(-45deg); }
      #hitmarker span:nth-child(3) { transform: translate(-6px,2px) rotate(-45deg); }
      #hitmarker span:nth-child(4) { transform: translate(4px,2px) rotate(45deg); }
      #ammo { position: absolute; right: 28px; bottom: 24px; text-align: right;
              color: #e8ecf2; text-shadow: 0 1px 3px rgba(0,0,0,.9); }
      #ammo .mag { font-size: 30px; font-weight: 700; }
      #ammo .reserve { font-size: 16px; opacity: .75; }
      #weapon-name { font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
                     opacity: .75; margin-bottom: 2px; }
      #health { position: absolute; left: 28px; bottom: 28px; width: 200px; height: 10px;
                background: rgba(10,12,16,.6); border: 1px solid rgba(230,235,245,.25);
                border-radius: 3px; overflow: hidden; }
      #health .fill { height: 100%; width: 100%; background: #b03a30;
                      transition: width .15s ease-out; }
      #vignette { position: absolute; inset: 0; opacity: 0; transition: opacity .3s;
                  background: radial-gradient(ellipse at center, transparent 55%,
                  rgba(160,20,10,.55) 100%); }
      #death { position: absolute; inset: 0; display: flex; flex-direction: column;
               align-items: center; justify-content: center; gap: 10px;
               background: rgba(8,6,6,.82); opacity: 0; pointer-events: none;
               transition: opacity .6s; }
      #death.show { opacity: 1; }
      #death h1 { color: #a83226; font-size: 44px; letter-spacing: 8px; margin: 0;
                  font-weight: 800; }
      #death p { color: #cfd6e4; opacity: .8; margin: 0; }
      #toast { position: absolute; left: 50%; top: 42%; transform: translateX(-50%);
               color: #7dff9a; font-size: 15px; letter-spacing: 4px; font-weight: 700;
               text-shadow: 0 1px 4px rgba(0,0,0,.9); opacity: 0; transition: opacity .2s; }
    `;
    document.head.appendChild(style);

    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <div id="reticle">
        <div class="dot"></div>
        <div class="tick t"></div><div class="tick b"></div>
        <div class="tick l"></div><div class="tick r"></div>
      </div>
      <div id="hitmarker"><span></span><span></span><span></span><span></span></div>
      <div id="ammo"><div id="weapon-name"></div>
        <span class="mag"></span> <span class="reserve"></span></div>
      <div id="health"><div class="fill"></div></div>
      <div id="vignette"></div>
      <div id="death"><h1>YOU DIED</h1><p>Press Enter to respawn</p></div>
      <div id="toast"></div>
    `;
    document.body.appendChild(hud);

    this.hitmarker = hud.querySelector('#hitmarker')!;
    this.ammoEl = hud.querySelector('#ammo .mag')!;
    this.weaponEl = hud.querySelector('#weapon-name')!;
    this.healthFill = hud.querySelector('#health .fill')!;
    this.vignette = hud.querySelector('#vignette')!;
    this.death = hud.querySelector('#death')!;
    this.toastEl = hud.querySelector('#toast')!;
    const ret = hud.querySelector('#reticle')!;
    this.reticleTicks = ['t', 'b', 'l', 'r'].map((c) => ret.querySelector(`.${c}`)!);
  }

  /** spreadPx: reticle gap in pixels, derived from weapon spread angle. */
  update(spreadPx: number, mag: number, reserve: number, weaponName: string, reloading: boolean): void {
    const gap = 6 + spreadPx;
    const [t, b, l, r] = this.reticleTicks;
    t.style.transform = `translateY(${-gap - 7}px)`;
    b.style.transform = `translateY(${gap}px)`;
    l.style.transform = `translateX(${-gap - 7}px)`;
    r.style.transform = `translateX(${gap}px)`;

    this.ammoEl.textContent = reloading ? '--' : String(mag);
    (this.ammoEl.nextElementSibling as HTMLElement).textContent = `/ ${reserve}`;
    this.weaponEl.textContent = reloading ? `${weaponName} · reloading` : weaponName;

    this.hitmarker.style.opacity = performance.now() < this.hitmarkerUntil ? '1' : '0';
    this.toastEl.style.opacity = performance.now() < this.toastUntil ? '1' : '0';
  }

  /** Brief centered pickup label ("AMMO"). */
  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastUntil = performance.now() + 1200;
  }

  setHealth(fraction: number): void {
    this.healthFill.style.width = `${Math.max(0, fraction) * 100}%`;
    // Persistent low-health vignette below 35%.
    const low = fraction < 0.35 ? (0.35 - fraction) / 0.35 : 0;
    const flash = performance.now() < this.vignetteUntil ? 1 : 0;
    this.vignette.style.opacity = String(Math.min(1, low * 0.8 + flash));
  }

  damageFlash(): void {
    this.vignetteUntil = performance.now() + 350;
  }

  showDeath(show: boolean): void {
    this.death.classList.toggle('show', show);
  }

  showHitmarker(kill: boolean): void {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarkerUntil = performance.now() + (kill ? 220 : 120);
  }
}
