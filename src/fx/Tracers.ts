import * as THREE from 'three';

interface Tracer {
  alive: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  remaining: number;
}

const TRACER_SPEED = 220; // m/s — visual only, hits are instant
const TRACER_LEN = 1.6;

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Fake visual tracers: stretched additive quads that fly from muzzle to the
 * (already-resolved) hit point. One InstancedMesh, pooled.
 */
export class Tracers {
  private mesh: THREE.InstancedMesh;
  private tracers: Tracer[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, capacity = 32) {
    const geo = new THREE.PlaneGeometry(0.025, 1);
    geo.rotateX(Math.PI / 2); // length along Z
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    for (let i = 0; i < capacity; i++) {
      this.tracers.push({ alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), remaining: 0 });
    }
  }

  fire(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers[this.cursor];
    this.cursor = (this.cursor + 1) % this.tracers.length;
    t.alive = true;
    t.pos.copy(from);
    t.dir.subVectors(to, from);
    t.remaining = t.dir.length();
    t.dir.normalize();
  }

  update(dt: number): void {
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (!t.alive) {
        _scale.setScalar(0);
        _mat4.compose(t.pos, _quat.identity(), _scale);
        this.mesh.setMatrixAt(i, _mat4);
        continue;
      }
      const step = TRACER_SPEED * dt;
      t.pos.addScaledVector(t.dir, step);
      t.remaining -= step;
      if (t.remaining <= 0) t.alive = false;

      const len = Math.min(TRACER_LEN, Math.max(t.remaining, 0.01));
      _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.dir);
      _scale.set(1, 1, len);
      _mat4.compose(t.pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _mat4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    void _up;
  }
}
