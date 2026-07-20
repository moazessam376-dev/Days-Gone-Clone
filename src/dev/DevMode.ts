import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { HANDLING } from '../config';
import { WEAPONS, THROWABLE_POSES } from '../weapons/weapons.data';
import type { WeaponRig } from '../weapons/WeaponRig';
import type { PlayerAvatar } from '../player/PlayerAvatar';
import type { Input } from '../core/Input';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const STORAGE_KEY = 'devTuning';

/** Everything the Pose Lab needs from Game, passed once (Game fields stay
 * private; no globals beyond what mockinput already exposes). */
export interface DevDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  input: Input;
  avatar: PlayerAvatar;
  rig: WeaponRig;
  playerPos: () => THREE.Vector3;
  equip: (key: string) => void;
  freezeEnemies: (on: boolean) => void;
}

/**
 * Pose & Grip Lab (docs/dev-mode.md): in-game tuning editor behind ?dev=1.
 * Orbit camera + animation scrub + transform gizmos on the held weapon and
 * back mount; exports final data values for weapons.data.ts / config.ts.
 */
export class DevMode {
  /** Game gates on these every frame. */
  simPaused = false;
  timeScaleValue = 1;

  private gui: GUI;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private deps: DevDeps;
  private animState = { clip: '(live)', time: 0, play: false, speed: 1 };
  private poseState = { target: 'held weapon', mode: 'translate' };
  private timeSlider: ReturnType<GUI['add']> | null = null;

  constructor(deps: DevDeps) {
    this.deps = deps;
    deps.input.devUnlocked = true;
    deps.input.locked = true;
    deps.freezeEnemies(true);

    this.orbit = new OrbitControls(deps.camera, deps.dom);
    this.orbit.enableDamping = true;
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null as unknown as THREE.MOUSE,
    };
    // Camera placement happens on the first update() — at construction the
    // player root hasn't been synced from physics yet (still at the origin).

    this.gizmo = new TransformControls(deps.camera, deps.dom);
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    deps.scene.add(this.gizmo.getHelper ? this.gizmo.getHelper() : (this.gizmo as unknown as THREE.Object3D));
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.gizmo.setMode('translate');
      if (e.code === 'KeyR') this.gizmo.setMode('rotate');
    });

    this.gui = new GUI({ title: 'Pose Lab' });
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.left = '8px';
    this.gui.domElement.style.top = '8px';
    this.buildPanel();
    this.restoreTweaks();
    this.attachGizmo();
  }

  private buildPanel(): void {
    const sim = this.gui.addFolder('Sim');
    sim.add(this, 'simPaused').name('pause sim');
    sim.add(this, 'timeScaleValue', 0.05, 1, 0.05).name('time scale');

    const anim = this.gui.addFolder('Animation');
    anim
      .add(this.animState, 'clip', ['(live)', ...this.deps.avatar.clipList])
      .onChange(() => this.onClipChange());
    this.timeSlider = anim.add(this.animState, 'time', 0, 1, 0.01).onChange(() => this.pushOverride());
    anim.add(this.animState, 'play');
    anim.add(this.animState, 'speed', 0.05, 2, 0.05);

    const pose = this.gui.addFolder('Pose');
    pose
      .add(this.poseState, 'target', ['held weapon', 'back mount'])
      .onChange(() => this.attachGizmo());
    pose
      .add(this.poseState, 'mode', ['translate', 'rotate'])
      .onChange((m: string) => this.gizmo.setMode(m as 'translate' | 'rotate'))
      .listen();
    pose.add({ reset: () => this.resetTweak() }, 'reset').name('reset tweak (active)');
    pose.add({ exportTuning: () => this.exportTuning() }, 'exportTuning').name('EXPORT TUNING');

    const state = this.gui.addFolder('State');
    for (const key of ['pistol', 'rifle', 'shotgun', 'grenade', 'molotov']) {
      state.add({ [key]: () => { this.deps.equip(key); this.attachGizmo(); } }, key);
    }
    state
      .add({ aim: false }, 'aim')
      .name('aim (RMB)')
      .onChange((on: boolean) => {
        document.dispatchEvent(new MouseEvent(on ? 'mousedown' : 'mouseup', { button: 2, bubbles: true }));
      });
    state.add(
      {
        fire: () => {
          document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
          setTimeout(
            () => document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })),
            60,
          );
        },
      },
      'fire',
    );
  }

  private placed = false;

  /** Called from Game.render every frame while dev mode is on. */
  update(dt: number): void {
    const p = this.deps.playerPos();
    if (!this.placed && p.lengthSq() > 0.01) {
      this.orbit.target.copy(p).add(_v.set(0, 0.3, 0));
      this.deps.camera.position.copy(p).add(_v.set(1.6, 0.9, 2.6));
      this.placed = true;
    }
    if (this.animState.play && this.animState.clip !== '(live)') {
      const dur = this.deps.avatar.clipDuration(this.animState.clip);
      this.animState.time = (this.animState.time + dt * this.animState.speed) % dur;
      this.pushOverride();
      this.timeSlider?.updateDisplay();
    }
    this.orbit.update();
  }

  get freeCam(): boolean {
    return true;
  }

  // ---- animation scrub ----

  private onClipChange(): void {
    const { clip } = this.animState;
    if (clip === '(live)') {
      this.deps.avatar.devOverride = null;
      return;
    }
    const dur = this.deps.avatar.clipDuration(clip);
    this.animState.time = Math.min(this.animState.time, dur);
    if (this.timeSlider) {
      this.timeSlider.max(dur);
      this.timeSlider.updateDisplay();
    }
    this.pushOverride();
  }

  private pushOverride(): void {
    if (this.animState.clip === '(live)') return;
    this.deps.avatar.devOverride = { clip: this.animState.clip, time: this.animState.time };
  }

  // ---- gizmo ----

  private attachGizmo(): void {
    const backTarget = this.poseState.target === 'back mount';
    // Freeze the back-mount follower while it's being edited; the export
    // reads the dragged transform relative to the chest bone.
    this.deps.rig.devBackFreeze = backTarget;
    const target = backTarget ? this.deps.rig.backMountObject() : this.deps.rig.holderObject;
    if (target) this.gizmo.attach(target);
    else this.gizmo.detach();
  }

  private onGizmoChange(): void {
    const rig = this.deps.rig;
    if (this.poseState.target === 'back mount') return; // read live at export
    // Solve the tweak in the BASE gun frame so it stays put while the
    // animation keeps moving the base pose (see WeaponRig.applyDevTweak).
    const holder = rig.holderObject;
    const key = rig.activeKey;
    let t = rig.devTweaks.get(key);
    if (!t) {
      t = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
      rig.devTweaks.set(key, t);
    }
    _q.copy(rig.lastBaseQ).invert();
    t.quat.copy(_q).multiply(holder.quaternion);
    t.pos.copy(holder.position).sub(rig.lastBasePos).applyQuaternion(_q);
    this.persistTweaks();
  }

  private resetTweak(): void {
    this.deps.rig.devTweaks.delete(this.deps.rig.activeKey);
    this.persistTweaks();
  }

  // ---- persistence + export ----

  private persistTweaks(): void {
    const out: Record<string, { pos: number[]; quat: number[] }> = {};
    for (const [k, t] of this.deps.rig.devTweaks) {
      out[k] = { pos: t.pos.toArray(), quat: t.quat.toArray() };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  }

  private restoreTweaks(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, { pos: number[]; quat: number[] }>;
      for (const [k, t] of Object.entries(data)) {
        this.deps.rig.devTweaks.set(k, {
          pos: new THREE.Vector3().fromArray(t.pos),
          quat: new THREE.Quaternion().fromArray(t.quat),
        });
      }
    } catch {
      /* stale/corrupt tuning — start clean */
    }
  }

  /** Fold tweaks into FINAL data values (same math as the rig, inverted)
   * and copy the JSON for pasting into chat / the data files. */
  private exportTuning(): void {
    const rig = this.deps.rig;
    const out: {
      weapons: Record<string, { grip?: number[]; pos?: number[]; rot: number[] }>;
      HANDLING?: { backOffset: number[]; backRot: number[] };
    } = { weapons: {} };

    for (const [key, t] of rig.devTweaks) {
      const def = WEAPONS[key];
      const tp = THROWABLE_POSES[key];
      const round = (v: number[]) => v.map((x) => +x.toFixed(4));
      if (def) {
        // pos = palm − q·grip, tweak adds q·tp ⇒ grip' = grip − tp
        const grip = [
          def.pose.grip[0] - t.pos.x,
          def.pose.grip[1] - t.pos.y,
          def.pose.grip[2] - t.pos.z,
        ];
        _q.setFromEuler(_e.set(def.pose.rot[0], def.pose.rot[1], def.pose.rot[2], 'YXZ')).multiply(t.quat);
        _e.setFromQuaternion(_q, 'YXZ');
        out.weapons[key] = { grip: round(grip), rot: round([_e.x, _e.y, _e.z]) };
      } else if (tp) {
        const pos = [tp.pos[0] + t.pos.x, tp.pos[1] + t.pos.y, tp.pos[2] + t.pos.z];
        _q.setFromEuler(_e.set(tp.rot[0], tp.rot[1], tp.rot[2], 'YXZ')).multiply(t.quat);
        _e.setFromQuaternion(_q, 'YXZ');
        out.weapons[key] = { pos: round(pos), rot: round([_e.x, _e.y, _e.z]) };
      }
    }

    // Back mount: read the live slot-0 mount relative to the chest bone.
    const back = rig.backMountObject();
    const chest = this.chestBone;
    if (back && chest && back.visible) {
      chest.updateWorldMatrix(true, false);
      back.getWorldPosition(_v);
      chest.worldToLocal(_v);
      chest.getWorldQuaternion(_q).invert();
      const localQ = _q.multiply(back.getWorldQuaternion(new THREE.Quaternion()));
      _e.setFromQuaternion(localQ, 'YXZ');
      out.HANDLING = {
        backOffset: _v.toArray().map((x) => +x.toFixed(4)),
        backRot: [+_e.x.toFixed(4), +_e.y.toFixed(4), +_e.z.toFixed(4)],
      };
    }

    const json = JSON.stringify(out, null, 2);
    console.log('=== POSE LAB TUNING ===\n' + json);
    navigator.clipboard?.writeText(json).catch(() => undefined);
    // Also HANDLING holdRot values currently live (context for the paste).
    console.log('current holdRot:', HANDLING.holdRot, 'holdRotPistol:', HANDLING.holdRotPistol);
  }

  private get chestBone(): THREE.Object3D | null {
    return this.deps.avatar.chestBone;
  }
}
