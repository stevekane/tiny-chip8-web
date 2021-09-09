module.exports = class WebAudioRenderer {
  constructor(ctx) {
    this.ctx = ctx
    this.gain = null
    this.activeSound = null
  }

  render(isActive, volume = 1) {
    if (isActive && !this.activeSound) {
      this.gain = this.ctx.createGain()
      this.gain.connect(this.ctx.destination)
      this.activeSound = this.ctx.createOscillator()
      this.activeSound.type = "sine"
      this.activeSound.connect(this.gain)
      this.activeSound.start()
    } else if (!isActive && this.activeSound) {
      this.gain.disconnect()
      this.gain = null
      this.activeSound.disconnect()
      this.activeSound.stop()
      this.activeSound = null
    }

    if (this.gain) {
      this.gain.gain.value = volume
    }
  }
}