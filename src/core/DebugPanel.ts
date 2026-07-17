import Stats from 'three/examples/jsm/libs/stats.module.js';
import GUI from 'lil-gui';
import { DEBUG } from '../config';

/**
 * stats.js FPS meter + lil-gui tuning panel.
 * Systems add their own folders via `folder(name)` and bind config objects,
 * so every feel constant is live-tweakable during development.
 */
export class DebugPanel {
  readonly stats: Stats;
  readonly gui: GUI;

  constructor() {
    this.stats = new Stats();
    this.stats.dom.style.left = 'auto';
    this.stats.dom.style.right = '0';
    if (DEBUG.showStats) document.body.appendChild(this.stats.dom);

    this.gui = new GUI({ title: 'Tuning' });
    this.gui.close();
  }

  folder(name: string): GUI {
    return this.gui.addFolder(name);
  }

  begin(): void {
    this.stats.begin();
  }

  end(): void {
    this.stats.end();
  }
}
