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
    overlay.addEventListener('click', () => this.input.requestLock());
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

  private fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt, this.input, this.cameraRig.yaw);
    this.physics.step();
  }

  private render(alpha: number, dt: number): void {
    this.debug.begin();
    this.physics.interpolate(alpha);
    this.player.renderUpdate(dt);
    this.avatar.update(dt, {
      speed: this.player.speed,
      aiming: this.player.aiming,
      rolling: this.player.isRolling,
      pitch: this.cameraRig.pitch,
    });
    this.cameraRig.update(dt, this.input, this.player.root.position, this.player.aiming);
    this.renderer.render(this.scene);
    this.input.endFrame();
    this.debug.end();
  }
}
