import * as THREE from 'three';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  life: number;
  maxLife: number;
  size: number;
  growth: number;
  color: THREE.Color;
}

export interface BurstOptions {
  count: number;
  position: THREE.Vector3;
  /** Base direction; particles scatter around it. */
  direction?: THREE.Vector3;
  spread?: number; // 0..1, 1 = full sphere
  speed?: [number, number];
  gravity?: number;
  life?: [number, number];
  size?: [number, number];
  growth?: number;
  colors: number[];
}

const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _scale = new THREE.Vector3();

/**
 * One pooled billboard particle system (a single InstancedMesh = one draw
 * call). CPU-simulated — capacities are small (hundreds). Billboarding is
 * done by copying the camera quaternion per instance.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private cursor = 0;

  constructor(capacity: number, material: THREE.Material) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = capacity;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        gravity: 0,
        life: 0,
        maxLife: 1,
        size: 0.1,
        growth: 0,
        color: new THREE.Color(),
      });
      this.mesh.setColorAt(i, new THREE.Color(0));
    }
  }

  burst(opts: BurstOptions): void {
    const dir = opts.direction ?? new THREE.Vector3(0, 1, 0);
    const spread = opts.spread ?? 1;
    const [s0, s1] = opts.speed ?? [1, 3];
    const [l0, l1] = opts.life ?? [0.3, 0.7];
    const [sz0, sz1] = opts.size ?? [0.05, 0.12];
    for (let n = 0; n < opts.count; n++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.particles.length;
      p.alive = true;
      p.pos.copy(opts.position);
      //

      p.vel
        .set(
          (Math.random() * 2 - 1) * spread,
          (Math.random() * 2 - 1) * spread,
          (Math.random() * 2 - 1) * spread,
        )
        .add(dir)
        .normalize()
        .multiplyScalar(THREE.MathUtils.lerp(s0, s1, Math.random()));
      p.gravity = opts.gravity ?? 0;
      p.maxLife = THREE.MathUtils.lerp(l0, l1, Math.random());
      p.life = p.maxLife;
      p.size = THREE.MathUtils.lerp(sz0, sz1, Math.random());
      p.growth = opts.growth ?? 0;
      p.color.setHex(opts.colors[(Math.random() * opts.colors.length) | 0]);
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    _quat.copy(camera.quaternion);
    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        _scale.setScalar(0);
        _mat.compose(p.pos, _quat, _scale);
        this.mesh.setMatrixAt(i, _mat);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const fade = p.life / p.maxLife;
      const size = (p.size + p.growth * (p.maxLife - p.life)) * (0.4 + 0.6 * fade);
      _scale.setScalar(size);
      _mat.compose(p.pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _mat);
      this.mesh.setColorAt(i, p.color);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** The game's shared particle pools (blood / sparks / dust-smoke). */
export class FxPools {
  readonly blood: ParticlePool;
  readonly spark: ParticlePool;
  readonly dust: ParticlePool;

  constructor(scene: THREE.Scene) {
    this.blood = new ParticlePool(
      256,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.spark = new ParticlePool(
      128,
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.dust = new ParticlePool(
      128,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
    );
    scene.add(this.blood.mesh, this.spark.mesh, this.dust.mesh);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.blood.update(dt, camera);
    this.spark.update(dt, camera);
    this.dust.update(dt, camera);
  }
}
