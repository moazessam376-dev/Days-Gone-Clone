import * as THREE from 'three';

/**
 * Muzzle flash: a couple of additive crossed quads + a point light that live
 * for ~50ms, repositioned to the muzzle world position on each shot.
 */
export class MuzzleFlash {
  private group: THREE.Group;
  private light: THREE.PointLight;
  private hideAt = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc86e,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(0.28, 0.28);
    const a = new THREE.Mesh(geo, mat);
    const b = new THREE.Mesh(geo, mat);
    b.rotation.z = Math.PI / 4;
    const c = new THREE.Mesh(geo, mat);
    c.rotation.y = Math.PI / 2;
    this.group.add(a, b, c);
    this.group.visible = false;

    this.light = new THREE.PointLight(0xffa050, 0, 6, 1.8);
    this.group.add(this.light);
    scene.add(this.group);
  }

  flash(position: THREE.Vector3): void {
    this.group.position.copy(position);
    this.group.rotation.z = Math.random() * Math.PI;
    this.group.scale.setScalar(0.8 + Math.random() * 0.5);
    this.group.visible = true;
    this.light.intensity = 14;
    this.hideAt = performance.now() + 50;
  }

  update(): void {
    if (this.group.visible && performance.now() > this.hideAt) {
      this.group.visible = false;
      this.light.intensity = 0;
    }
  }
}
