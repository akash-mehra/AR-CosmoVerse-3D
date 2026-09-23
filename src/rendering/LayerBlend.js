import * as THREE from 'three';

/**
 * Draws a scene into a buffer of its own and lays it over whatever the canvas
 * already holds, at a given opacity: how one scale layer cross-fades into the
 * next without either having to know how to fade itself.
 */
export class LayerBlend {
  constructor(renderer) {
    this.renderer = renderer;
    // Half float keeps dark gradients from banding where the GPU can render to it.
    const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type, samples: 4 });
    this.material = new THREE.MeshBasicMaterial({ map: this.target.texture, transparent: true, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene().add(quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.camera.position.z = 0.5;
    this._size = new THREE.Vector2();
  }

  /** `draw` renders the layer into whatever target is bound; `opacity` is how much of it shows. */
  over(draw, opacity) {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    renderer.getDrawingBufferSize(this._size);
    if (this.target.width !== this._size.x || this.target.height !== this._size.y) this.target.setSize(this._size.x, this._size.y);
    renderer.setRenderTarget(this.target);
    draw();
    renderer.setRenderTarget(previous);

    this.material.opacity = opacity;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
