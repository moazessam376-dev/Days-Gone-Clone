import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { DebugPanel } from './core/DebugPanel';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Renderer } from './rendering/Renderer';

/**
 * M0 graybox: a lit ground plane, a stack of dynamic physics crates, and a
 * pointer-locked fly camera. Proves the full pipeline — Rapier WASM init,
 * fixed-step physics with render interpolation, input, and deployment.
 * The fly camera is replaced by the third-person controller in M1.
 */
export class Game {
  private scene = new THREE.Scene();
  private renderer: Renderer;
  private physics: PhysicsWorld;
  private input: Input;
  private debug: DebugPanel;
  private loop: GameLoop;

  private yaw = 0;
  private pitch = -0.2;
  private flySpeed = 12;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.physics = new PhysicsWorld();
    this.input = new Input(this.renderer.renderer.domElement);
    this.debug = new DebugPanel();

    this.setupEnvironment();
    this.setupGraybox();

    this.renderer.camera.position.set(0, 6, 14);

    const overlay = document.getElementById('click-to-play')!;
    overlay.classList.remove('hidden');
    overlay.addEventListener('click', () => this.input.requestLock());
    document.addEventListener('pointerlockchange', () => {
      overlay.classList.toggle('hidden', this.input.locked);
    });

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });
  }

  start(): void {
    this.loop.start();
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

  private setupGraybox(): void {
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setTranslation(0, -0.1, 0));

    // A pyramid of dynamic crates to show physics working.
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i < 5 - row; i++) {
        const mesh = new THREE.Mesh(crateGeo, crateMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const x = i * 1.05 - (5 - row) * 0.525;
        const y = row * 1.05 + 0.5;
        const body = this.physics.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, -5),
        );
        this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
        this.physics.syncObject(body, mesh);
      }
    }
  }

  private fixedUpdate(_dt: number): void {
    this.physics.step();
  }

  private render(alpha: number, dt: number): void {
    this.debug.begin();

    if (this.input.locked) {
      const { dx, dy } = this.input.consumeMouseDelta();
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.5, 1.5);

      const cam = this.renderer.camera;
      cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

      const move = new THREE.Vector3(
        (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0),
        0,
        (this.input.isDown('KeyS') ? 1 : 0) - (this.input.isDown('KeyW') ? 1 : 0),
      );
      if (move.lengthSq() > 0) {
        move.normalize().applyQuaternion(cam.quaternion);
        const speed = this.input.isDown('ShiftLeft') ? this.flySpeed * 3 : this.flySpeed;
        cam.position.addScaledVector(move, speed * dt);
      }
    }

    this.physics.interpolate(alpha);
    this.renderer.render(this.scene);
    this.input.endFrame();
    this.debug.end();
  }
}
