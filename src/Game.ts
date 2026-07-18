import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { DebugPanel } from './core/DebugPanel';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Renderer } from './rendering/Renderer';
import { PlayerController } from './player/PlayerController';
import { PlayerAvatar } from './player/PlayerAvatar';
import { CameraRig } from './player/CameraRig';
import { AssetLoader } from './core/AssetLoader';
import { CAMERA_RIG, PLAYER } from './config';
import { WeaponSystem, DamageRegistry } from './weapons/WeaponSystem';
import { WeaponRig } from './weapons/WeaponRig';
import { WEAPONS, WEAPON_ORDER } from './weapons/weapons.data';
import { FxPools } from './fx/ParticlePool';
import { ScreenShake, Hitstop, Recoil } from './fx/Feedback';
import { Tracers } from './fx/Tracers';
import { Decals } from './fx/Decals';
import { MuzzleFlash } from './fx/MuzzleFlash';
import { AudioEngine } from './audio/AudioEngine';
import { HUD } from './ui/HUD';
import { EnemyManager } from './enemies/EnemyManager';
import { EnemyRenderer } from './enemies/EnemyRenderer';
import { WorldData } from './world/WorldGen';
import { CarController, CAR } from './vehicles/CarController';
import { BikeController } from './vehicles/BikeController';
import { FireGrid, FIRE } from './fire/FireGrid';
import { FireRenderer } from './fx/FireRenderer';
import { ThrowableSystem, THROWABLE } from './weapons/Throwables';
import { Terrain } from './world/Terrain';
import { Vegetation } from './world/Vegetation';
import { Town } from './world/Town';
import { AmmoCrates } from './world/AmmoCrates';
import { AMMO_CRATES } from './config';
import { EnterableBuilding } from './world/EnterableBuilding';
import { PLAYER_HEALTH, MELEE, ACTIONS, VEHICLES, HANDLING } from './config';

const _vehicleQuat = new THREE.Quaternion();
const _vehicleFwd = new THREE.Vector3();

/**
 * M1 graybox: third-person character controller + over-shoulder camera in an
 * obstacle course (ramps, stairs, walls, pillars, crates) built to exercise
 * movement feel. The capsule placeholder is replaced by the real model in M2.
 */
export class Game {
  private scene = new THREE.Scene();
  private renderer: Renderer;
  private physics: PhysicsWorld;
  private input: Input;
  private debug: DebugPanel;
  private loop: GameLoop;
  private player: PlayerController;
  private avatar: PlayerAvatar;
  private cameraRig: CameraRig;
  private weapons!: WeaponSystem;
  private weaponRig!: WeaponRig;
  private handBone: THREE.Object3D | null = null;
  private avatarHidden = false;
  private registry = new DamageRegistry();
  private fx!: FxPools;
  private shake = new ScreenShake();
  private hitstop = new Hitstop();
  private recoil = new Recoil();
  private tracers!: Tracers;
  private decals!: Decals;
  private muzzleFlash!: MuzzleFlash;
  private audio = new AudioEngine();
  private hud = new HUD();
  private muzzlePos = new THREE.Vector3();
  private enemies!: EnemyManager;
  private enemyRenderer!: EnemyRenderer;
  private playerHealth = PLAYER_HEALTH.max;
  private lastDamageTime = -999;
  private gameTime = 0;
  private skipDraw = false;
  private meleeCooldown = 0;
  /** While > 0, firing/melee/throwing are blocked (a deliberate action is in progress). */
  private actionLock = 0;
  private throwTimer = 0;
  private pendingThrow: { kind: 'grenade' | 'molotov'; t: number } | null = null;
  /** While > 0, the body faces the camera direction (hip-fire follow-through). */
  private combatFaceT = 0;
  /** Remaining weapon-swap time (lower + raise); aim/fire blocked throughout. */
  private swapT = 0;
  private prevSprinting = false;
  private dead = false;
  private spawnTimer = 0;
  private world!: WorldData;
  private terrain!: Terrain;
  private vegetation!: Vegetation;
  private town!: Town;
  private sun!: THREE.DirectionalLight;
  private car!: CarController;
  private bike!: BikeController;
  private activeVehicle: CarController | BikeController | null = null;
  private driving = false;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private fire!: FireGrid;
  private fireRenderer!: FireRenderer;
  private throwables!: ThrowableSystem;
  private fireLights: THREE.PointLight[] = [];
  private fireFxTimer = 0;
  private hideout!: EnterableBuilding;
  private ammoCrates!: AmmoCrates;
  private vehicleRects: Array<{
    v: CarController | BikeController;
    x: number; z: number; hw: number; hd: number;
    cos: number; sin: number; active: boolean;
  }> = [];
  private townRects: Array<{ x: number; z: number; hw: number; hd: number; cos: number; sin: number }> = [];

  constructor(container: HTMLElement, assets: AssetLoader) {
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld();
    this.input = new Input(this.renderer.renderer.domElement);
    this.debug = new DebugPanel();

    this.setupEnvironment();
    this.setupWorld(assets);

    // Spawn on the highway centerline just outside the town center —
    // building placement keeps clear of road lanes.
    const spawnY = this.world.height(0, 0) + 1.2;
    this.player = new PlayerController(this.physics, new THREE.Vector3(0, spawnY, 0));
    this.terrain.updatePhysics(0, 0);
    this.avatar = new PlayerAvatar(assets.get('player'));
    this.player.model.add(this.avatar.object);
    this.scene.add(this.player.root);
    this.cameraRig = new CameraRig(this.renderer.camera, this.physics);

    this.fx = new FxPools(this.scene);
    this.tracers = new Tracers(this.scene);
    this.decals = new Decals(this.scene);
    this.muzzleFlash = new MuzzleFlash(this.scene);
    this.setupWeapons();
    this.setupEnemies(assets);
    this.fire = new FireGrid(this.world);
    this.fireRenderer = new FireRenderer(this.scene);
    for (let i = 0; i < FIRE.lightCount; i++) {
      const l = new THREE.PointLight(0xff7a20, 0, 18, 1.6);
      this.scene.add(l);
      this.fireLights.push(l);
    }
    this.throwables = new ThrowableSystem(this.physics, this.scene, {
      onExplode: (pos) => {
        this.enemies.explosionAt(pos.x, pos.z, THROWABLE.grenadeRadius, THROWABLE.grenadeDamage);
        this.fire.ignite(pos.x, pos.z, 1.5);
        this.fx.spark.burst({
          count: 30, position: pos, spread: 1, speed: [6, 16], gravity: 10,
          life: [0.2, 0.6], size: [0.08, 0.2], colors: [0xffd9a0, 0xff9040, 0xfff0c0],
        });
        this.fx.dust.burst({
          count: 18, position: pos, spread: 1, speed: [2, 7], gravity: -1,
          life: [0.6, 1.4], size: [0.3, 0.8], growth: 1.2, colors: [0x5a544c, 0x3a3630],
        });
        const d = pos.distanceTo(this.player.root.position);
        this.shake.add(Math.max(0, 0.7 - d * 0.05));
        this.hitstop.trigger();
        this.audio.play('explosion', { gain: 0.9, at: pos });
        // Fling nearby corpses for drama.
        const dist = pos.distanceTo(this.player.root.position);
        if (dist < THROWABLE.grenadeRadius && !this.driving) {
          this.onPlayerDamaged(Math.round(60 * (1 - dist / THROWABLE.grenadeRadius)), pos.x, pos.z);
        }
      },
      onMolotovBreak: (pos) => {
        this.fire.ignite(pos.x, pos.z, THROWABLE.fireRadius);
        this.enemies.explosionAt(pos.x, pos.z, 2.5, 30);
        // Anyone caught in the splash is burning NOW, not on the next grid tick.
        this.enemies.igniteInRadius(pos.x, pos.z, THROWABLE.fireRadius + 0.5, FIRE.enemyBurnTime);
        this.fx.spark.burst({
          count: 20, position: pos, spread: 0.9, speed: [3, 8], gravity: 6,
          life: [0.3, 0.7], size: [0.1, 0.25], colors: [0xff8a30, 0xffb050, 0xff6010],
        });
        this.audio.play('molotov', { gain: 0.7, at: pos });
      },
    });
    this.throwables.heightFn = (x, z) => this.world.height(x, z);

    // Ammo resupply crates: town spots + one at the hideout door.
    this.ammoCrates = new AmmoCrates(
      this.scene,
      [...AMMO_CRATES.townSpots, [36, 40]],
      (x, z) => this.world.height(x, z),
    );

    // Vehicles parked on the highway a short walk from spawn.
    this.car = new CarController(
      this.physics,
      this.scene,
      new THREE.Vector3(8, this.world.height(8, 14) + 1.2, 14),
      assets.get('sedan'),
    );
    this.bike = new BikeController(
      this.physics,
      this.scene,
      new THREE.Vector3(-6, this.world.height(-6, 10) + 1.2, 10),
      assets.get('motorbike'),
    );
    for (const v of [this.car, this.bike] as Array<CarController | BikeController>) {
      this.vehicleRects.push({ v, x: 0, z: 0, hw: 1, hd: 1, cos: 1, sin: 0, active: false });
    }
    this.updateVehicleRects();

    this.setupOverlay();
    this.setupDebugPanel();

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });
    // Start frozen behind the click-to-play screen — the world must not
    // simulate (enemies chasing, fire spreading) until the player is in.
    if (!this.input.mock) this.loop.setPaused(true);

    if (this.input.mock) {
      // Test hook for automated verification (?mockinput only).
      (window as unknown as Record<string, unknown>).__game = this;
    }
  }

  /**
   * Test hook (?mockinput): advance the simulation deterministically without
   * relying on requestAnimationFrame (which pauses in hidden tabs).
   */
  /**
   * @param draw pass false to skip the WebGL draw call while stepping —
   *   ALL gameplay-relevant render work (interpolation, model yaw, camera)
   *   still runs; only pixels are skipped. The physics test suite uses this:
   *   CI software rasterization is ~100x slower than the simulation itself.
   */
  debugStep(frames: number, draw = true): void {
    const dt = 1 / 60;
    this.skipDraw = !draw;
    for (let i = 0; i < frames; i++) {
      this.fixedUpdate(dt);
      this.render(1, dt);
    }
    this.skipDraw = false;
  }

  /** Test hook: chase target + motion state of the N nearest live enemies. */
  debugEnemySnapshot(n = 8): object {
    const em = this.enemies;
    const t = this.driving && this.activeVehicle ? this.activeVehicle.position : this.player.root.position;
    const rows = em.active
      .filter((i) => em.state[i] !== 4)
      .map((i) => ({ i, d: Math.hypot(em.posX[i] - t.x, em.posZ[i] - t.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map(({ i, d }) => {
        const vx = em.velX[i];
        const vz = em.velZ[i];
        // Angle between velocity and the to-target direction (0 = seeking).
        const toT = Math.atan2(t.x - em.posX[i], t.z - em.posZ[i]);
        const vYaw = Math.atan2(vx, vz);
        const seekErr = Math.atan2(Math.sin(vYaw - toT), Math.cos(vYaw - toT));
        return {
          i, d: +d.toFixed(1), x: +em.posX[i].toFixed(1), z: +em.posZ[i].toFixed(1),
          vx: +vx.toFixed(2), vz: +vz.toFixed(2), yaw: +em.yaw[i].toFixed(2),
          seekErr: +seekErr.toFixed(2), state: em.state[i], anim: em.animId[i],
          blocked: !!(
            this.enemyBlockAt(em.posX[i] + vx * 0.15, em.posZ[i] + vz * 0.15) ??
            this.vehicleBlockAt(em.posX[i] + vx * 0.15, em.posZ[i] + vz * 0.15)
          ),
        };
      });
    return { target: { x: +t.x.toFixed(1), z: +t.z.toFixed(1) }, rows };
  }

  start(): void {
    // In mock-input test mode the loop is driven exclusively by debugStep so
    // results stay deterministic regardless of tab visibility or real input.
    if (this.input.mock) return;
    this.loop.start();
  }

  private setupOverlay(): void {
    const overlay = document.getElementById('click-to-play')!;
    if (this.input.mock) return;
    const title = document.getElementById('overlay-title')!;
    const hint = document.getElementById('overlay-hint')!;
    let hasPlayed = false;
    overlay.classList.remove('hidden');
    overlay.addEventListener('click', () => {
      this.initAudio();
      this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      overlay.classList.toggle('hidden', this.input.locked);
      if (this.input.locked) {
        hasPlayed = true;
        this.loop.setPaused(false);
        this.audio.resume();
      } else {
        this.loop.setPaused(true);
        this.audio.suspend();
        if (hasPlayed) {
          title.textContent = 'PAUSED';
          hint.textContent = 'Click to resume';
        }
      }
    });
  }

  private setupEnvironment(): void {
    // Moody dusk placeholder — refined properly in M2's lighting pass.
    this.scene.background = new THREE.Color(0x2a3040);
    this.scene.fog = new THREE.Fog(0x2a3040, 60, 480);

    const hemi = new THREE.HemisphereLight(0x8a9ac0, 0x4a4238, 1.8);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffb070, 3.2);
    sun.position.set(30, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.far = 160;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  private setupWorld(assets: AssetLoader): void {
    this.world = new WorldData();
    this.terrain = new Terrain(this.scene, this.physics, this.world);
    this.vegetation = new Vegetation(this.scene, this.physics, this.world);
    const buildings = ['bldg_a','bldg_b','bldg_c','bldg_e','bldg_g','bldg_h','bldg_k','bldg_m','bldg_q','bldg_s']
      .map((k) => assets.get(k));
    this.town = new Town(this.scene, this.physics, this.world, buildings);
    for (const b of this.town.buildingSpots) {
      this.townRects.push({
        x: b.x, z: b.z, hw: b.w / 2 + 0.35, hd: b.d / 2 + 0.35,
        cos: Math.cos(b.rot), sin: Math.sin(b.rot),
      });
    }
    this.hideout = new EnterableBuilding(this.scene, this.physics, this.world, (w) => {
      // Boards break: debris burst + bang.
      this.fx.dust.burst({
        count: 12, position: new THREE.Vector3(w.x, this.world.height(w.x, w.z) + 1.6, w.z),
        spread: 1, speed: [1, 4], gravity: 6, life: [0.4, 0.9], size: [0.08, 0.2],
        colors: [0x6b4f33, 0x4f3a26],
      });
      this.shake.add(0.25);
      this.audio.play('impact_world', { gain: 0.9, at: { x: w.x, y: 1.6, z: w.z } });
    });
  }

  /** Refresh the two vehicle steering rects (called each fixed tick). A
   * vehicle blocks zombie steering only while slow — a charging car must
   * plow through the horde, not shove an invisible wall ahead of itself. */
  private updateVehicleRects(): void {
    for (let i = 0; i < this.vehicleRects.length; i++) {
      const r = this.vehicleRects[i];
      const v = r.v;
      const t = v.body.translation();
      const lv = v.body.linvel();
      r.active = Math.hypot(lv.x, lv.z) < VEHICLES.obstacleMaxSpeed;
      if (!r.active) continue;
      const rot = v.body.rotation();
      _vehicleQuat.set(rot.x, rot.y, rot.z, rot.w);
      _vehicleFwd.set(0, 0, 1).applyQuaternion(_vehicleQuat);
      const yaw = Math.atan2(_vehicleFwd.x, _vehicleFwd.z);
      r.x = t.x;
      r.z = t.z;
      r.cos = Math.cos(yaw);
      r.sin = Math.sin(yaw);
      r.hw = v.halfExtents.hw + VEHICLES.obstacleMargin;
      r.hd = v.halfExtents.hd + VEHICLES.obstacleMargin;
    }
  }

  /** Is (x,z) inside a slow/parked vehicle's footprint? */
  private vehicleBlockAt(
    x: number,
    z: number,
    exclude?: CarController | BikeController | null,
  ): { wall: true } | null {
    for (const r of this.vehicleRects) {
      if (!r.active || r.v === exclude) continue;
      const dx = x - r.x;
      const dz = z - r.z;
      const lx = dx * r.cos + dz * r.sin;
      const lz = -dx * r.sin + dz * r.cos;
      if (Math.abs(lx) < r.hw && Math.abs(lz) < r.hd) return { wall: true };
    }
    return null;
  }

  /** Combined enemy steering obstacles: town buildings + hideout walls. */
  private enemyBlockAt(x: number, z: number): ReturnType<EnterableBuilding['blockAt']> {
    const hide = this.hideout.blockAt(x, z);
    if (hide) return hide;
    for (const r of this.townRects) {
      const dx = x - r.x;
      const dz = z - r.z;
      const lx = dx * r.cos + dz * r.sin;
      const lz = -dx * r.sin + dz * r.cos;
      if (Math.abs(lx) < r.hw && Math.abs(lz) < r.hd) return { wall: true };
    }
    return null;
  }

  private setupDebugPanel(): void {
    const p = this.debug.folder('Player');
    p.add(PLAYER, 'jogSpeed', 1, 10);
    p.add(PLAYER, 'sprintSpeed', 3, 14);
    p.add(PLAYER, 'accel', 5, 100);
    p.add(PLAYER, 'decel', 5, 100);
    p.add(PLAYER, 'turnSpeed', 2, 30);
    p.add(PLAYER.roll, 'speed', 3, 15).name('rollSpeed');
    p.add(PLAYER, 'combatFaceTime', 0, 3);
    p.add(PLAYER.roll, 'duration', 0.2, 1.2).name('rollDuration');

    const c = this.debug.folder('Camera');
    c.add(CAMERA_RIG, 'restDistance', 1, 6);
    c.add(CAMERA_RIG, 'shoulderX', -1, 1);
    c.add(CAMERA_RIG, 'aimDistance', 0.8, 3);
    c.add(CAMERA_RIG, 'aimShoulderX', -1, 1);
    c.add(CAMERA_RIG, 'aimFov', 25, 55);
    c.add(CAMERA_RIG, 'sensitivity', 0.0005, 0.006);
  }

  private setupWeapons(): void {

    this.weapons = new WeaponSystem(this.physics, this.registry, {
      onShot: (def) => {
        this.combatFaceT = PLAYER.combatFaceTime;
        this.weaponRig.kick();
        if (def.shootAnim) this.avatar.playShoot();
        this.shake.add(def.pellets > 1 ? 0.32 : def.auto ? 0.1 : 0.16);
        this.weaponRig.muzzleWorld(this.muzzlePos);
        this.muzzleFlash.flash(this.muzzlePos);
        this.audio.play(`shot_${this.weapons.current}`, { gain: 0.55 });
      },
      onHitWorld: (point, normal) => {
        this.decals.add(point, normal);
        this.fx.spark.burst({
          count: 5, position: point, direction: normal.clone(), spread: 0.7,
          speed: [2, 6], gravity: 9, life: [0.1, 0.3], size: [0.02, 0.05],
          colors: [0xffd9a0, 0xffb060, 0xfff0c0],
        });
        this.fx.dust.burst({
          count: 3, position: point, direction: normal.clone(), spread: 0.5,
          speed: [0.5, 1.5], gravity: -0.4, life: [0.4, 0.9], size: [0.08, 0.2],
          growth: 0.5, colors: [0x8a8478, 0x6b665c],
        });
        this.tracers.fire(this.muzzlePos, point);
        this.audio.play('impact_world', { gain: 0.4, at: point });
      },
      onHitFlesh: (point, dir, killed, headshot) => {
        this.fx.blood.burst({
          count: killed ? 14 : 8, position: point, direction: dir.clone().multiplyScalar(0.6),
          spread: 0.8, speed: [1.5, 4.5], gravity: 12, life: [0.25, 0.6],
          size: [0.04, 0.11], colors: [0x7a1410, 0x9c1c14, 0x580e0a],
        });
        this.tracers.fire(this.muzzlePos, point);
        this.hud.showHitmarker(killed);
        if (killed) {
          this.hitstop.trigger();
          this.shake.add(0.15);
        }
        this.audio.play('impact_flesh', { gain: headshot ? 0.8 : 0.55, at: point });
      },
      onReloadStart: (def) => {
        this.avatar.playReload(def.reloadTime);
        this.audio.play('reload', { gain: 0.5 });
      },
      onDryFire: () => this.audio.play('dry', { gain: 0.45 }),
    }, this.player.body);

    this.weaponRig = new WeaponRig(this.scene);
    this.handBone = this.avatar.handBone;
    this.weaponRig.setActive(this.weapons.current);
  }

  private setupEnemies(assets: AssetLoader): void {
    this.enemies = new EnemyManager(this.physics, this.registry, {
      onPlayerHit: (damage, fromX, fromZ) => this.onPlayerDamaged(damage, fromX, fromZ),
      onBarrierHit: (x, z) => {
        const d = Math.hypot(x - this.player.root.position.x, z - this.player.root.position.z);
        if (d < 15) this.shake.add(0.06);
        this.audio.play('impact_world', { gain: 0.5, at: { x, y: 1.6, z } });
      },
      onDeath: (_i, point, dir) => {
        this.fx.blood.burst({
          count: 16, position: point.clone(), direction: dir.clone().multiplyScalar(0.7),
          spread: 0.9, speed: [1.5, 5], gravity: 12, life: [0.3, 0.7],
          size: [0.05, 0.13], colors: [0x7a1410, 0x9c1c14, 0x580e0a],
        });
        this.audio.play('impact_flesh', { gain: 0.7, at: point });
      },
    });
    this.enemies.heightFn = (x, z) => this.world.height(x, z);
    this.enemies.obstacles = (x, z) => this.enemyBlockAt(x, z) ?? this.vehicleBlockAt(x, z);
    this.enemyRenderer = new EnemyRenderer(this.scene, assets.get('zombie'));
    this.spawnEnemyWave(24);
  }

  private spawnEnemyWave(count: number): void {
    let spawned = 0;
    let guard = 0;
    while (spawned < count && guard++ < 200) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 18 + Math.random() * 22;
      const x = this.player.root.position.x + Math.cos(angle) * radius;
      const z = this.player.root.position.z + Math.sin(angle) * radius;
      if (Math.abs(x) > 1000 || Math.abs(z) > 1000) continue;
      if (this.enemyBlockAt(x, z) || this.vehicleBlockAt(x, z)) continue; // not inside buildings/vehicles
      if (this.enemies.spawn(x, z) >= 0) spawned++;
    }
  }

  private onPlayerDamaged(damage: number, fromX: number, fromZ: number): void {
    if (this.dead || this.player.invulnerable || this.driving) return;
    this.playerHealth -= damage;
    this.lastDamageTime = this.gameTime;
    this.hud.damageFlash();
    this.shake.add(0.35);
    this.audio.play('impact_flesh', { gain: 0.9 });
    void fromX;
    void fromZ;
    if (this.playerHealth <= 0) {
      this.playerHealth = 0;
      this.dead = true;
      this.hud.showDeath(true);
    }
  }

  private respawn(): void {
    this.dead = false;
    this.playerHealth = PLAYER_HEALTH.max;
    this.hud.showDeath(false);
    this.player.body.setTranslation({ x: 0, y: this.world.height(0, 0) + 1.2, z: 0 }, true);
    this.pendingThrow = null;
    this.actionLock = 0;
    this.combatFaceT = 0;
    this.enemies.reset();
    this.enemyRenderer.reset();
    this.spawnEnemyWave(24);
  }

  /** Flame/smoke particles + flickering lights for burning cells and enemies. */
  private updateFireFx(dt: number): void {
    this.fireFxTimer -= dt;
    const cells = this.fire.cells;
    // Two pooled lights on the first clusters.
    let li = 0;
    for (const cell of cells.values()) {
      if (li >= this.fireLights.length) break;
      const l = this.fireLights[li++];
      l.position.set(cell.x, cell.y + 1.2, cell.z);
      l.intensity = 20 + Math.sin(performance.now() * 0.02 + li * 7) * 6;
    }
    for (; li < this.fireLights.length; li++) this.fireLights[li].intensity = 0;

    if (this.fireFxTimer > 0) return;
    this.fireFxTimer = 0.09;
    // Ember + smoke bursts on a random subset of burning cells (the flame
    // bodies themselves are FireRenderer's instanced billboards).
    let n = 0;
    const camPos = this.renderer.camera.position;
    for (const cell of cells.values()) {
      if (n >= 14) break;
      if (Math.random() > 0.2) continue;
      if (Math.abs(cell.x - camPos.x) > 90 || Math.abs(cell.z - camPos.z) > 90) continue;
      n++;
      const pos = new THREE.Vector3(cell.x + (Math.random() - 0.5), cell.y + 0.3, cell.z + (Math.random() - 0.5));
      this.fx.spark.burst({
        count: 2, position: pos, direction: new THREE.Vector3(0, 1, 0), spread: 0.3,
        speed: [1, 3], gravity: -2, life: [0.3, 0.7], size: [0.3, 0.7],
        colors: [0xff8a30, 0xffb050, 0xff5010],
      });
      if (Math.random() < 0.3) {
        this.fx.dust.burst({
          count: 1, position: pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
          direction: new THREE.Vector3(0, 1, 0), spread: 0.25, speed: [0.6, 1.4],
          gravity: -0.6, life: [0.8, 1.6], size: [0.3, 0.6], growth: 0.8,
          colors: [0x3a3630, 0x504a42],
        });
      }
    }
    // Burning enemies trail flames.
    const em = this.enemies;
    for (const i of em.active) {
      if (em.burnT[i] <= 0 || em.state[i] === 4) continue;
      this.fx.spark.burst({
        count: 2, position: new THREE.Vector3(em.posX[i], em.posY[i] + 1 + Math.random() * 0.6, em.posZ[i]),
        direction: new THREE.Vector3(0, 1, 0), spread: 0.4, speed: [0.8, 2],
        gravity: -2, life: [0.25, 0.5], size: [0.12, 0.3],
        colors: [0xff8a30, 0xffb050],
      });
    }
  }

  private setEngineAudio(on: boolean): void {
    const ctx = (this.audio as unknown as { ctx: AudioContext | null }).ctx;
    const master = (this.audio as unknown as { master: AudioNode | null }).master;
    if (!ctx || !master) return;
    if (on && !this.engineOsc) {
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0.05;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(master);
      this.engineOsc.start();
    } else if (!on && this.engineOsc) {
      this.engineOsc.stop();
      this.engineOsc.disconnect();
      this.engineGain?.disconnect();
      this.engineOsc = null;
      this.engineGain = null;
    }
  }

  private initAudio(): void {
    this.audio.ensureContext();
    this.registerSounds();
  }

  private registerSounds(): void {
    if (!this.audio.ready) return;
    for (const [key, def] of Object.entries(WEAPONS)) {
      this.audio.registerGunshot(`shot_${key}`, def.sound);
    }
    this.audio.registerImpact('impact_world', { freq: 3000, dur: 0.09, gain: 0.7 });
    this.audio.registerImpact('impact_flesh', { freq: 500, dur: 0.14, gain: 0.9 });
    this.audio.registerImpact('reload', { freq: 1800, dur: 0.06, gain: 0.5 });
    this.audio.registerImpact('dry', { freq: 2400, dur: 0.04, gain: 0.5 });
    this.audio.registerGunshot('explosion', { sub: 40, crack: 0.4, body: 0.5 });
    this.audio.registerImpact('molotov', { freq: 900, dur: 0.3, gain: 0.8 });
  }

  private fixedUpdate(dt: number): void {
    this.gameTime += dt;

    if (this.dead) {
      if (this.input.consumePressed('Enter')) this.respawn();
      this.input.consumeScroll();
      this.physics.step();
      return;
    }

    // Health regen after a quiet period.
    if (this.playerHealth < PLAYER_HEALTH.max && this.gameTime - this.lastDamageTime > PLAYER_HEALTH.regenDelay) {
      this.playerHealth = Math.min(PLAYER_HEALTH.max, this.playerHealth + PLAYER_HEALTH.regenRate * dt);
    }

    // One deliberate action at a time.
    this.actionLock = Math.max(0, this.actionLock - dt);
    this.throwTimer = Math.max(0, this.throwTimer - dt);
    this.combatFaceT = Math.max(0, this.combatFaceT - dt);
    this.swapT = Math.max(0, this.swapT - dt);

    // R1 handling: reload and swap requests. Priority within the tick is
    // ROLL > RELOAD > SWAP > FIRE (roll preempts inside PlayerController;
    // the wheel slots in above throw when it lands). Blocked inputs are
    // dropped, never buffered — see docs/r1-player-handling.md.
    if (!this.driving) {
      if (
        this.input.consumePressed('KeyR') &&
        !this.player.isRolling &&
        this.actionLock <= 0 &&
        this.swapT <= 0
      ) {
        const wasSprinting = this.player.sprinting;
        this.weapons.tryReload();
        // R mid-sprint commits: the gun stays up (sprint blocked) until done.
        if (this.weapons.isReloading && wasSprinting) {
          this.player.sprintBlockT = Math.max(this.player.sprintBlockT, this.weapons.def.reloadTime);
        }
      }
      let swapTo = '';
      if (this.input.consumePressed('Digit1')) swapTo = 'pistol';
      if (this.input.consumePressed('Digit2')) swapTo = 'rifle';
      if (this.input.consumePressed('Digit3')) swapTo = 'shotgun';
      const scroll = this.input.consumeScroll();
      if (!swapTo && scroll !== 0) {
        const idx = WEAPON_ORDER.indexOf(this.weapons.current as (typeof WEAPON_ORDER)[number]);
        const n = WEAPON_ORDER.length;
        swapTo = WEAPON_ORDER[(idx + (scroll > 0 ? 1 : n - 1) + n) % n];
      }
      if (swapTo && swapTo !== this.weapons.current && !this.player.isRolling && this.swapT <= 0) {
        this.weapons.switchTo(swapTo);
        this.swapT = HANDLING.swapTime;
        this.actionLock = Math.max(this.actionLock, HANDLING.swapTime);
        // Sprint drops to jog for the swap, resumes if Shift is still held.
        this.player.sprintBlockT = Math.max(this.player.sprintBlockT, HANDLING.swapTime);
      }
    } else {
      this.input.consumeScroll();
    }

    // Melee (V key).
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    if (
      this.input.consumePressed('KeyV') &&
      this.meleeCooldown <= 0 &&
      this.actionLock <= 0 &&
      !this.weapons.isReloading &&
      !this.player.isRolling
    ) {
      this.meleeCooldown = MELEE.cooldown;
      this.actionLock = ACTIONS.meleeLock;
      this.avatar.playMelee();
      const facing = this.player.aiming ? this.cameraRig.yaw + Math.PI : this.player.model.rotation.y;
      this.enemies.meleeSweep(
        this.player.root.position.x,
        this.player.root.position.z,
        facing,
        MELEE.range,
        (MELEE.arcDeg * Math.PI) / 180,
        MELEE.damage,
        {
          onHit: (_i, x, z, killed) => {
            this.hud.showHitmarker(killed);
            if (killed) this.hitstop.trigger();
            this.shake.add(0.2);
            this.audio.play('impact_flesh', { gain: 0.8, at: { x, y: 1.2, z } });
          },
        },
      );
    }

    // Throwables: G = grenade, F = molotov. Press starts a wind-up; the
    // projectile leaves the hand after ACTIONS.throwWindup with the camera
    // direction sampled at release, and throws are rate-limited.
    if (!this.driving) {
      const wantGrenade = this.input.consumePressed('KeyG');
      const wantMolotov = this.input.consumePressed('KeyF');
      if (
        (wantGrenade || wantMolotov) &&
        this.actionLock <= 0 &&
        this.throwTimer <= 0 &&
        !this.weapons.isReloading &&
        !this.player.isRolling
      ) {
        this.pendingThrow = { kind: wantGrenade ? 'grenade' : 'molotov', t: ACTIONS.throwWindup };
        this.actionLock = ACTIONS.throwLock;
        this.throwTimer = ACTIONS.throwCooldown;
        this.combatFaceT = Math.max(this.combatFaceT, ACTIONS.throwLock);
        this.avatar.playMelee(); // overhand swing doubles as the throw wind-up
      }
    }
    if (this.pendingThrow) {
      this.pendingThrow.t -= dt;
      if (this.driving) {
        this.pendingThrow = null;
      } else if (this.pendingThrow.t <= 0) {
        const dir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(dir);
        const origin = this.player.root.position.clone();
        origin.y += 0.7;
        origin.addScaledVector(dir, 0.6);
        this.throwables.throw(this.pendingThrow.kind, origin, dir);
        this.audio.play('reload', { gain: 0.4 });
        this.pendingThrow = null;
      }
    }
    this.throwables.fixedUpdate(dt);
    this.fire.update(dt);
    this.enemies.burnTick(dt, (x, z) => this.fire.isBurningAt(x, z), FIRE.enemyBurnDps, FIRE.enemyBurnTime);
    if (!this.driving && this.fire.isBurningAt(this.player.root.position.x, this.player.root.position.z)) {
      this.onPlayerDamaged(FIRE.playerBurnDps * dt, this.player.root.position.x, this.player.root.position.z);
    }

    this.updateVehicleRects();
    const chaseTarget = this.driving && this.activeVehicle ? this.activeVehicle.position : this.player.root.position;
    this.enemies.fixedUpdate(dt, chaseTarget.x, chaseTarget.z);

    // Keep the pressure up: top back to ~24 alive every few seconds.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 4;
      const alive = this.enemies.active.filter((i) => this.enemies.state[i] !== 4).length;
      if (alive < 24) this.spawnEnemyWave(24 - alive);
    }

    const focus = this.driving && this.activeVehicle ? this.activeVehicle.position : this.player.root.position;
    this.terrain.updatePhysics(focus.x, focus.z);
    this.vegetation.update(dt, focus.x, focus.z);

    // Enter/exit the nearest vehicle (E).
    if (this.input.consumePressed('KeyE')) {
      if (this.driving && this.activeVehicle) {
        this.driving = false;
        const cp = this.activeVehicle.position;
        // Try the vehicle's sides/ends (rotated to its heading) and take the
        // first spot not inside a building; fall back to +X.
        const rot = this.activeVehicle.body.rotation();
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
          new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w),
        );
        const vyaw = Math.atan2(fwd.x, fwd.z);
        const cos = Math.cos(vyaw);
        const sin = Math.sin(vyaw);
        let exitX = cp.x + 2.2;
        let exitZ = cp.z;
        for (const [lx, lz] of [[2.2, 0], [-2.2, 0], [0, -3.2], [0, 3.2]]) {
          const wx = cp.x + lx * cos + lz * sin;
          const wz = cp.z - lx * sin + lz * cos;
          if (!this.enemyBlockAt(wx, wz) && !this.vehicleBlockAt(wx, wz, this.activeVehicle)) {
            exitX = wx;
            exitZ = wz;
            break;
          }
        }
        this.player.body.setTranslation(
          { x: exitX, y: this.world.height(exitX, exitZ) + 1.2, z: exitZ },
          true,
        );
        this.player.root.visible = true;
        this.activeVehicle = null;
        this.setEngineAudio(false);
      } else if (!this.driving) {
        const candidates: Array<CarController | BikeController> = [this.car, this.bike];
        let best: CarController | BikeController | null = null;
        let bd = 3.5;
        for (const v of candidates) {
          const d = this.player.root.position.distanceTo(v.position);
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
        if (best) {
          this.driving = true;
          this.activeVehicle = best;
          this.player.root.visible = false;
          this.player.body.setTranslation({ x: 0, y: -50, z: 0 }, true);
          this.setEngineAudio(true);
        }
      }
    }

    this.car.fixedUpdate(dt, this.input, this.activeVehicle === this.car);
    this.bike.fixedUpdate(dt, this.input, this.activeVehicle === this.bike);
    if (this.driving && this.activeVehicle) {
      const v = this.activeVehicle.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (speed > CAR.runOverSpeed) {
        this.enemies.runOverSweep(
          this.activeVehicle.position.x,
          this.activeVehicle.position.z,
          this.activeVehicle === this.car ? 2.6 : 1.6,
          v.x,
          v.z,
          (px, pz) => {
            this.shake.add(0.3);
            this.hud.showHitmarker(true);
            this.audio.play('impact_flesh', { gain: 0.9, at: { x: px, y: 1, z: pz } });
          },
        );
      }
      if (this.engineOsc && this.engineGain) {
        this.engineOsc.frequency.value = 55 + speed * 6;
        this.engineGain.gain.value = 0.05 + Math.min(0.1, speed * 0.004);
      }
    }

    // Ammo pickup (on foot only).
    if (!this.driving) {
      const p = this.player.root.position;
      if (this.ammoCrates.fixedUpdate(dt, p.x, p.z)) {
        this.weapons.refillReserves();
        this.hud.toast('AMMO');
        this.audio.play('reload', { gain: 0.6 });
      }
    } else {
      this.ammoCrates.fixedUpdate(dt, 1e9, 1e9); // timers only, no pickup
    }

    this.prevSprinting = this.player.sprinting;
    if (!this.driving) {
      this.player.fixedUpdate(
        dt,
        this.input,
        this.cameraRig.yaw,
        this.combatFaceT > 0,
        this.swapT > 0, // ADS drops during a swap, resumes if RMB still held
      );
    }
    // STARTING a sprint (or rolling) interrupts a reload — a reload begun
    // mid-sprint holds sprint down instead (sprintBlockT), so no rising edge.
    if ((this.player.sprinting && !this.prevSprinting) || this.player.isRolling) {
      this.weapons.cancelReload();
    }

    // Aim-to-shoot: an unaimed trigger pull fires nothing — the body just
    // squares up to the camera (carry-alert nudge).
    if (!this.driving && !this.player.aiming && !this.player.isRolling) {
      if (this.input.consumePressedButton(0)) {
        this.combatFaceT = Math.max(this.combatFaceT, HANDLING.nudgeTime);
      }
    }

    this.weapons.fixedUpdate(
      dt,
      this.input,
      this.renderer.camera,
      this.player.aiming,
      this.input.locked &&
        this.player.aiming &&
        !this.player.isRolling &&
        !this.driving &&
        this.actionLock <= 0 &&
        this.swapT <= 0,
      (p, y) => this.recoil.kick(p, y),
    );
    this.weaponRig.setActive(this.weapons.current);
    this.physics.step();
  }

  private render(alpha: number, dt: number): void {
    this.debug.begin();
    this.loop.timeScale = this.hitstop.timeScale;
    this.physics.interpolate(alpha);
    this.player.renderUpdate(dt);
    this.avatar.update(dt, {
      speed: this.player.speed,
      aiming: this.player.aiming,
      rolling: this.player.isRolling,
      rollT: this.player.rollProgress,
      pitch: this.cameraRig.pitch,
    });
    this.weaponRig.update(dt, this.handBone);
    this.recoil.update(dt);
    this.car.updateVisuals();
    this.bike.updateVisuals();
    this.cameraRig.update(
      dt,
      this.input,
      this.driving && this.activeVehicle ? this.activeVehicle.position : this.player.root.position,
      this.player.aiming && !this.driving,
      this.recoil,
      this.driving,
    );
    this.shake.apply(dt, this.renderer.camera);
    this.renderer.camera.updateMatrixWorld();
    this.weaponRig.muzzleWorld(this.muzzlePos);

    // Camera pressed against a wall → hide the body so we never render its
    // insides (hysteresis so the boundary doesn't flicker).
    const arm = this.cameraRig.armDistance;
    if (arm < CAMERA_RIG.hideAvatarBelow) this.avatarHidden = true;
    else if (arm > CAMERA_RIG.showAvatarAbove) this.avatarHidden = false;
    const showBody = !this.avatarHidden && !this.driving;
    this.avatar.object.visible = showBody;
    this.weaponRig.setVisible(showBody);

    this.muzzleFlash.update();
    this.tracers.update(dt);
    this.fx.update(dt, this.renderer.camera);
    this.enemyRenderer.update(dt, this.enemies);
    this.hud.setHealth(this.playerHealth / PLAYER_HEALTH.max);

    this.updateFireFx(dt);
    this.fireRenderer.update(dt, this.fire, this.renderer.camera);
    this.ammoCrates.render(dt);

    // Keep the shadow frustum centered on the player.
    const pp = this.player.root.position;
    this.sun.position.set(pp.x + 30, pp.y + 25, pp.z + 10);
    this.sun.target.position.copy(pp);

    const spreadRad = this.weapons.spreadAngle(this.player.aiming);
    const fovRad = (this.renderer.camera.fov * Math.PI) / 180;
    const spreadPx = (Math.tan(spreadRad) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    this.hud.update(
      spreadPx,
      this.weapons.magAmmo,
      this.weapons.reserveAmmo,
      this.weapons.def.name,
      this.weapons.isReloading,
    );

    const camPos = this.renderer.camera.position;
    const fwd = new THREE.Vector3();
    this.renderer.camera.getWorldDirection(fwd);
    this.audio.updateListener(camPos, fwd);

    if (!this.skipDraw) this.renderer.render(this.scene);
    this.input.endFrame();
    this.debug.end();
  }
}
