const BigTriangle = require("big-triangle")
const Regl = require("regl")

module.exports = class ReglRenderer {
  constructor(canvas, width, height) {
    const regl = Regl(canvas)
    const texture = regl.texture({ type: "uint8", format: "alpha", width, height })
    const vert = `
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
    `

    const frag = `
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
    `
    const uniforms = {
      color: [ 1, .88, .26, 1 ],
      backgroundColor: [ .9, .1, .54, 1 ],
      display: regl.prop("display")
    }
    const attributes = {
      position: BigTriangle(2)
    }
    const count = 3

    this.texture = texture
    this.regl = regl
    this.draw = regl({ vert, frag, uniforms, attributes, count })
  }

  render(data, width, height) {
    this.texture({ type: "uint8", format: "alpha", width, height, data })
    this.draw({ display: this.texture })
  }
}