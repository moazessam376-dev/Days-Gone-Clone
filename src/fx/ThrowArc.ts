import * as THREE from 'three';
import { THROWABLE } from '../weapons/Throwables';

const SAMPLES = 40;
const STEP = 0.06; // seconds per sample
const GRAVITY = -9.81; // matches the Rapier world the real projectile flies in

const _p = new THREE.Vector3();

/**
 * Dotted ballistic trajectory preview for throwables (Days Gone style).
 * One pooled Points + landing marker, allocated once; per-frame update only
 * rewrites the position buffer. Uses the EXACT launch params ThrowableSystem
 * uses, so the preview never lies.
 */
export class ThrowArc {
  private points: THREE.Points;
  private positions: Float32Array;
  private marker: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(SAMPLES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xe8ecf2,
        size: 0.07,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.7 }),
    );
    this.marker.visible = false;
    scene.add(this.marker);
  }

  setVisible(v: boolean): void {
    this.points.visible = v;
    this.marker.visible = v;
  }

  /** Rebuild the arc from the launch point along the camera direction. */
  update(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    heightFn: (x: number, z: number) => number,
  ): void {
    const vx = dir.x * THROWABLE.throwSpeed;
    const vy = dir.y * THROWABLE.throwSpeed + THROWABLE.throwUp;
    const vz = dir.z * THROWABLE.throwSpeed;
    let landed = false;
    for (let i = 0; i < SAMPLES; i++) {
      if (!landed) {
        const t = i * STEP;
        _p.set(
          origin.x + vx * t,
          origin.y + vy * t + 0.5 * GRAVITY * t * t,
          origin.z + vz * t,
        );
        if (i > 0 && _p.y <= heightFn(_p.x, _p.z)) {
          _p.y = heightFn(_p.x, _p.z);
          this.marker.position.copy(_p);
          landed = true;
        }
      }
      // Past the landing point every dot collapses onto the marker.
      this.positions[i * 3] = _p.x;
      this.positions[i * 3 + 1] = _p.y;
      this.positions[i * 3 + 2] = _p.z;
    }
    if (!landed) this.marker.position.copy(_p);
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
