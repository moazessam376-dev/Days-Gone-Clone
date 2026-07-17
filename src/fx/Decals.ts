import * as THREE from 'three';

const _normal = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Pooled bullet-hole decals stuck onto static surfaces. Oldest is recycled. */
export class Decals {
  private pool: THREE.Mesh[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, capacity = 64) {
    const geo = new THREE.PlaneGeometry(0.12, 0.12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x151312,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }

  add(position: THREE.Vector3, normal: THREE.Vector3): void {
    const m = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    _normal.copy(normal).normalize();
    m.position.copy(position).addScaledVector(_normal, 0.012);
    _target.copy(position).add(_normal);
    m.lookAt(_target);
    m.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.8 + Math.random() * 0.5;
    m.scale.setScalar(s);
    m.visible = true;
  }
}
