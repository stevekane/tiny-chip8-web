module.exports = class InputSystem {
  constructor(el) {
    this.keys = new Uint8Array(16)
    this.keydownListener = el.addEventListener("keydown", this.keydown.bind(this))
    this.keyupListener = el.addEventListener("keyup", this.keyup.bind(this))
    this.visibilityListener = el.addEventListener("visibilitychange", this.visibilitychange.bind(this))
    this.keyMappings = new Map([
      [ "Digit1", 0x1 ], [ "Digit2", 0x2 ], [ "Digit3", 0x3 ], [ "Digit4", 0xC ],
      [ "KeyQ", 0x4 ],   [ "KeyW", 0x5 ],   [ "KeyE", 0x6 ],   [ "KeyR", 0xD ],
      [ "KeyA", 0x7 ],   [ "KeyS", 0x8 ],   [ "KeyD", 0x9 ],   [ "KeyF", 0xE ],
      [ "KeyZ", 0xA ],   [ "KeyX", 0x0 ],   [ "KeyC", 0xB ],   [ "KeyV", 0xF ],
    ])
  }

  keydown({ code }) {
    if (this.keyMappings.has(code)) {
      this.keys[this.keyMappings.get(code)] = true
    }
  }

  keyup({ code }) {
    if (this.keyMappings.has(code)) {
      this.keys[this.keyMappings.get(code)] = false
    }
  }

  visibilitychange() {
    this.keys.fill(0)
  }
}