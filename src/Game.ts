import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { DebugPanel } from './core/DebugPanel';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Layer, ALL_LAYERS, interactionGroups } from './physics/layers';
import { Renderer } from './rendering/Renderer';
import { PlayerController } from './player/PlayerController';
import { PlayerAvatar } from './player/PlayerAvatar';
import { CameraRig } from './player/CameraRig';
import { AssetLoader } from './core/AssetLoader';
import { CAMERA_RIG, PLAYER } from './config';
import { WeaponSystem, DamageRegistry } from './weapons/WeaponSystem';
import { WEAPONS } from './weapons/weapons.data';
import { WeaponRig } from './weapons/WeaponRig';
import { TargetDummy } from './entities/TargetDummy';
import { FxPools } from './fx/ParticlePool';
import { ScreenShake, Hitstop, Recoil } from './fx/Feedback';
import { Tracers } from './fx/Tracers';
import { Decals } from './fx/Decals';
import { MuzzleFlash } from './fx/MuzzleFlash';
import { AudioEngine } from './audio/AudioEngine';
import { HUD } from './ui/HUD';
import { EnemyManager } from './enemies/EnemyManager';
import { EnemyRenderer } from './enemies/EnemyRenderer';
import { PLAYER_HEALTH, MELEE } from './config';

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
  private weaponRig: WeaponRig | null = null;
  private registry = new DamageRegistry();
  private dummies: TargetDummy[] = [];
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
  private meleeCooldown = 0;
  private dead = false;
  private spawnTimer = 0;

  constructor(container: HTMLElement, assets: AssetLoader) {
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld();
    this.input = new Input(this.renderer.renderer.domElement);
    this.debug = new DebugPanel();

    this.setupEnvironment();
    this.setupGraybox();

    this.player = new PlayerController(this.physics, new THREE.Vector3(0, 1.2, 8));
    this.avatar = new PlayerAvatar(assets.get('player'));
    this.player.model.add(this.avatar.object);
    this.scene.add(this.player.root);
    this.cameraRig = new CameraRig(this.renderer.camera, this.physics);

    this.fx = new FxPools(this.scene);
    this.tracers = new Tracers(this.scene);
    this.decals = new Decals(this.scene);
    this.muzzleFlash = new MuzzleFlash(this.scene);
    this.setupWeapons();
    this.setupDummies();
    this.setupEnemies(assets);

    this.setupOverlay();
    this.setupDebugPanel();

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });

    if (this.input.mock) {
      // Test hook for automated verification (?mockinput only).
      (window as unknown as Record<string, unknown>).__game = this;
    }
  }

  /**
   * Test hook (?mockinput): advance the simulation deterministically without
   * relying on requestAnimationFrame (which pauses in hidden tabs).
   */
  debugStep(frames: number): void {
    const dt = 1 / 60;
    for (let i = 0; i < frames; i++) {
      this.fixedUpdate(dt);
      this.render(1, dt);
    }
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
    overlay.classList.remove('hidden');
    overlay.addEventListener('click', () => {
      this.initAudio();
      this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      overlay.classList.toggle('hidden', this.input.locked);
    });
  }

  private setupEnvironment(): void {
    // Moody dusk placeholder — refined properly in M2's lighting pass.
    this.scene.background = new THREE.Color(0x2a3040);
    this.scene.fog = new THREE.Fog(0x2a3040, 40, 300);

    const hemi = new THREE.HemisphereLight(0x8a9ac0, 0x4a4238, 1.8);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffb070, 3.2);
    sun.position.set(30, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120;
    this.scene.add(sun);
  }

  /** Static box: mesh + matching collider from one transform. */
  private addStaticBox(
    size: [number, number, number],
    pos: [number, number, number],
    rot?: THREE.Euler,
    color = 0x5a6270,
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    mesh.position.set(...pos);
    if (rot) mesh.rotation.copy(rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const q = new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler());
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
        .setTranslation(...pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(interactionGroups(Layer.STATIC, ALL_LAYERS)),
    );
  }

  private setupGraybox(): void {
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(100, 0.1, 100)
        .setTranslation(0, -0.1, 0)
        .setCollisionGroups(interactionGroups(Layer.STATIC, ALL_LAYERS)),
    );

    // Obstacle course for controller feel testing.
    this.addStaticBox([6, 0.4, 8], [-8, 1.6, -6], new THREE.Euler(-0.42, 0, 0)); // ramp
    for (let i = 0; i < 8; i++) {
      this.addStaticBox([3, 0.2 * (i + 1), 0.4], [0, 0.1 * (i + 1), -10.5 - i * 0.4]); // stairs
    }
    this.addStaticBox([0.4, 3, 10], [6, 1.5, -6]); // wall to camera-test against
    this.addStaticBox([0.4, 3, 6], [9, 1.5, -3], new THREE.Euler(0, 0.8, 0)); // angled wall
    for (let i = 0; i < 4; i++) {
      this.addStaticBox([0.8, 4, 0.8], [-4 + i * 2.5, 2, 2]); // pillar row
    }
    this.addStaticBox([4, 1, 4], [10, 0.5, 6]); // low platform (autostep check: too high)
    this.addStaticBox([4, 0.35, 4], [14, 0.175, 6]); // step-up platform (autostep ok)

    // Dynamic crates to shove around.
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4 - row; i++) {
        const mesh = new THREE.Mesh(crateGeo, crateMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        const body = this.physics.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(
            i * 1.05 - (4 - row) * 0.525 + 3,
            row * 1.05 + 0.5,
            -3,
          ),
        );
        this.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(0.4),
          body,
        );
        this.physics.syncObject(body, mesh);
      }
    }
  }

  private setupDebugPanel(): void {
    const p = this.debug.folder('Player');
    p.add(PLAYER, 'jogSpeed', 1, 10);
    p.add(PLAYER, 'sprintSpeed', 3, 14);
    p.add(PLAYER, 'accel', 5, 100);
    p.add(PLAYER, 'decel', 5, 100);
    p.add(PLAYER, 'turnSpeed', 2, 30);
    p.add(PLAYER.roll, 'speed', 3, 15).name('rollSpeed');
    p.add(PLAYER.roll, 'duration', 0.2, 1.2).name('rollDuration');

    const c = this.debug.folder('Camera');
    c.add(CAMERA_RIG, 'restDistance', 1, 6);
    c.add(CAMERA_RIG, 'shoulderX', -1, 1);
    c.add(CAMERA_RIG, 'aimDistance', 0.8, 3);
    c.add(CAMERA_RIG, 'aimShoulderX', -1, 1);
    c.add(CAMERA_RIG, 'aimFov', 25, 55);
    c.add(CAMERA_RIG, 'sensitivity', 0.0005, 0.006);
  }

  private handBone: THREE.Object3D | null = null;

  private setupWeapons(): void {
    this.handBone = this.avatar.handBone;
    this.weaponRig = new WeaponRig(this.scene);

    this.weapons = new WeaponSystem(this.physics, this.registry, {
      onShot: (def) => {
        this.weaponRig?.kick();
        if (def.shootAnim) this.avatar.playShoot();
        this.shake.add(def.pellets > 1 ? 0.32 : def.auto ? 0.1 : 0.16);
        if (this.weaponRig) {
          this.weaponRig.muzzleWorld(this.muzzlePos);
          this.muzzleFlash.flash(this.muzzlePos);
        }
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

    this.weaponRig?.setActive(this.weapons.current);
  }

  private setupDummies(): void {
    // Open right-rear quadrant — clear sightlines from spawn.
    const spots = [
      new THREE.Vector3(14, 0, 16),
      new THREE.Vector3(19, 0, 20),
      new THREE.Vector3(24, 0, 25),
      new THREE.Vector3(30, 0, 30),
    ];
    for (const p of spots) {
      const d = new TargetDummy(this.physics, this.registry, p);
      this.scene.add(d.root);
      this.dummies.push(d);
    }
  }

  private setupEnemies(assets: AssetLoader): void {
    this.enemies = new EnemyManager(this.physics, this.registry, {
      onPlayerHit: (damage, fromX, fromZ) => this.onPlayerDamaged(damage, fromX, fromZ),
      onDeath: (_i, point, dir) => {
        this.fx.blood.burst({
          count: 16, position: point.clone(), direction: dir.clone().multiplyScalar(0.7),
          spread: 0.9, speed: [1.5, 5], gravity: 12, life: [0.3, 0.7],
          size: [0.05, 0.13], colors: [0x7a1410, 0x9c1c14, 0x580e0a],
        });
        this.audio.play('impact_flesh', { gain: 0.7, at: point });
      },
    });
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
      if (Math.abs(x) > 95 || Math.abs(z) > 95) continue;
      if (this.enemies.spawn(x, z) >= 0) spawned++;
    }
  }

  private onPlayerDamaged(damage: number, fromX: number, fromZ: number): void {
    if (this.dead || this.player.invulnerable) return;
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
    this.player.body.setTranslation({ x: 0, y: 1.2, z: 8 }, true);
    this.enemies.reset();
    this.enemyRenderer.reset();
    this.spawnEnemyWave(24);
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
  }

  private fixedUpdate(dt: number): void {
    this.gameTime += dt;

    if (this.dead) {
      if (this.input.consumePressed('Enter')) this.respawn();
      this.physics.step();
      return;
    }

    // Health regen after a quiet period.
    if (this.playerHealth < PLAYER_HEALTH.max && this.gameTime - this.lastDamageTime > PLAYER_HEALTH.regenDelay) {
      this.playerHealth = Math.min(PLAYER_HEALTH.max, this.playerHealth + PLAYER_HEALTH.regenRate * dt);
    }

    // Melee (V key).
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    if (this.input.consumePressed('KeyV') && this.meleeCooldown <= 0 && !this.player.isRolling) {
      this.meleeCooldown = MELEE.cooldown;
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

    this.enemies.fixedUpdate(dt, this.player.root.position.x, this.player.root.position.z);

    // Keep the pressure up: top back to ~24 alive every few seconds.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 4;
      const alive = this.enemies.active.filter((i) => this.enemies.state[i] !== 4).length;
      if (alive < 24) this.spawnEnemyWave(24 - alive);
    }

    this.player.fixedUpdate(dt, this.input, this.cameraRig.yaw);
    this.weapons.fixedUpdate(
      dt,
      this.input,
      this.renderer.camera,
      this.player.aiming,
      this.input.locked && !this.player.isRolling,
      (p, y) => this.recoil.kick(p, y),
    );
    this.weaponRig?.setActive(this.weapons.current);
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
      pitch: this.cameraRig.pitch,
    });
    this.recoil.update(dt);
    this.weaponRig?.update(dt, this.handBone);
    this.cameraRig.update(dt, this.input, this.player.root.position, this.player.aiming, this.recoil);
    this.shake.apply(dt, this.renderer.camera);
    this.renderer.camera.updateMatrixWorld();
    if (this.weaponRig) this.weaponRig.muzzleWorld(this.muzzlePos);

    this.muzzleFlash.update();
    this.tracers.update(dt);
    this.fx.update(dt, this.renderer.camera);
    for (const d of this.dummies) d.update(dt);
    this.enemyRenderer.update(dt, this.enemies);
    this.hud.setHealth(this.playerHealth / PLAYER_HEALTH.max);

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

    this.renderer.render(this.scene);
    this.input.endFrame();
    this.debug.end();
  }
}
