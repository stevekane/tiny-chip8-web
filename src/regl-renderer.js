const BigTriangle = require("big-triangle")
const Regl = require("regl")

module.exports = class ReglRenderer {
  constructor(canvas, width, height) {
    this.regl = Regl(canvas)
    this.texture = this.regl.texture({ type: "uint8", format: "alpha", width, height })
    this.draw = this.regl({
      vert: `
        precision mediump float;
        attribute vec2 position;
        varying vec2 uv;
        void main() {
          uv = position;
          uv.y *= -1.0;
          uv += vec2(1);
          uv *= 0.5;
          gl_Position = vec4(position, 0, 1);
        }
      `,
      frag: `
        precision mediump float;
        uniform vec4 color;
        uniform vec4 backgroundColor;
        uniform sampler2D display;
        varying vec2 uv;
        void main() {
          float raw = texture2D(display, uv).a;
          float luminosity = ceil(raw);
          gl_FragColor = mix(backgroundColor, color, luminosity);
        }
      `,
      uniforms: {
        color: [ 1, .88, .26, 1 ],
        backgroundColor: [ .9, .1, .54, 1 ],
        display: this.regl.prop("display")
      },
      attributes: {
        position: BigTriangle(2)
      },
      count: 3
    })
  }

  render(data, width, height) {
    this.texture({ type: "uint8", format: "alpha", width, height, data })
    this.draw({ display: this.texture })
  }
}