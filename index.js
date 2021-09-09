const { highNibble, lowNibble, nthbit, bit8, bit12 } = require("./src/binary-utils")
const { hundreds, tens, ones } = require("./src/decimal-utils")
const font = require("./src/default-font.js")
const ReglRenderer = require('./src/regl-renderer')
const WebAudioRenderer = require("./src/webaudio-renderer")

const IBM_URL = "http://localhost:9966/ROMs/IBM Logo.ch8"
const TEST_URL = "http://localhost:9966/ROMs/test_opcode.ch8"
const TRIP8_URL = "http://localhost:9966/ROMs/trip-8.ch8"
const BREAKOUT_URL = "http://localhost:9966/ROMs/breakout.ch8"
const INSTRUCTION_BYTE_LENGTH = 2
const MAX_STACK_FRAMES = 128
const REGISTER_COUNT = 16
const SCREEN_WIDTH = 64
const SCREEN_HEIGHT = 32
const FONT_MEMORY_OFFSET = 0 // tradition says 050 .. maybe change?
const FONT_HEIGHT = 5
const PROGRAM_MEMORY_OFFSET = 512
const TIMER_FREQUENCY = 60
const CLOCK_FREQUENCY = 500
const CLOCK_PERIOD = 1 / CLOCK_FREQUENCY
const TIMER_PERIOD = 1 / TIMER_FREQUENCY
const VOLUME_GAIN = .1
const DEBUGGING = false

class Chip8 {
  constructor(program, font) {
    this.inputs = new Uint8Array(16)
    this.display = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
    this.PC = new Uint16Array([512])
    this.SP = new Uint16Array([0])
    this.I = new Uint16Array(1)
    this.D = new Uint8Array(1)
    this.S = new Uint8Array(1)
    this.V = new Uint8Array(REGISTER_COUNT)
    this.stack = new Uint16Array(MAX_STACK_FRAMES)
    this.memory = new Uint8Array(4096)
    this.memory.set(font, FONT_MEMORY_OFFSET)
    this.memory.set(program, PROGRAM_MEMORY_OFFSET)
    this.op = new Uint8Array(4)
  }

  execute(debugging=false) {
    this.fetchOp()
    this.stepPC(INSTRUCTION_BYTE_LENGTH)

    // 00E0 clear  
    if (this.getOp(0) == 0x0 && this.getOp(2) == 0xE && this.getOp(3) == 0x0) {
      this.display.fill(0)
    } 

    // 00EE return from subroutine
    else if (this.getOp(0) == 0x0 && this.getOp(2) == 0xE && this.getOp(3) == 0xE) {
      let addr = this.popStack()
      this.setPC(addr)
    }

    // 1NNN jump. set PC to 12-bit value NNN
    else if (this.getOp(0) == 0x1) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      this.setPC(nnn)
    }

    // 2NNN call subroutine at NNN, store PC on stack and change PC
    else if (this.getOp(0) == 0x2) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      let pc = this.getPC()
      this.pushStack(pc)
      this.setPC(nnn)
    }

    // 3XNN if VX == NN step PC
    else if (this.getOp(0) == 0x3) {
      let vx = this.getRegister(this.getOp(1))
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.stepPC(vx == nn ? INSTRUCTION_BYTE_LENGTH : 0)
    }

    // 4XNN if VX != NN step PC
    else if (this.getOp(0) == 0x4) {
      let vx = this.getRegister(this.getOp(1))
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.stepPC(vx != nn ? INSTRUCTION_BYTE_LENGTH : 0)
    }

    // 5XY0 if VX == VY step PC
    else if (this.getOp(0) == 0x5 && this.getOp(3) == 0x0) {
      let vx = this.getRegister(this.getOp(1))
      let vy = this.getRegister(this.getOp(2))
      this.stepPC(vx == vy ? INSTRUCTION_BYTE_LENGTH : 0)
    }

    // 6XNN set VX to NN
    else if (this.getOp(0) == 0x6) {
      let x = this.getOp(1)
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.setRegister(x, nn)
    }
    
    // 7XNN add NN to VX
    else if (this.getOp(0) == 0x7) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let nn = bit8(this.getOp(2), this.getOp(3))
      let result = vx + nn
      this.setRegister(xRegister, result)
    }

    // 8XY0 set VX to VY
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x0) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vy)
    }

    // 8XY1 set VX to VX | VY
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x1) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx | vy)
    }

    // 8XY2 set VX to VX & VY
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x2) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx & vy)
    }

    // 8XY3 set VX to VX ^ VY.
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x3) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx ^ vy)
    }

    // 8XY4 VX += VY. set VF to 1 when carry otherwise 0
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x4) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      let result = vx + vy
      this.setRegister(0xF, result > 255)
      this.setRegister(xRegister, result)
    }

    // 8XY5 VX -= VY. set VF to 0 when borrow otherwise 1
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      let result = vx - vy
      this.setRegister(0xF, vx >= vy)
      this.setRegister(xRegister, result)
    }

    // 8X_6 VX >>= 1. set VF to LSB(VX) then shift VX right by 1
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x6) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let lsbvx = nthbit(0,vx)
      let result = vx >> 1
      this.setRegister(0xF, lsbvx)
      this.setRegister(xRegister, result)
    }

    // 8XY7 set VX to VY - VX. set VF to 0 when borrow otherwise 1
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x7) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      let result = vy - vx
      this.setRegister(0xF, vy >= vx)
      this.setRegister(xRegister, result)
    }

    // 8XYE VX <<= 1. set VF to MSB(VX) then shift VX left by 1
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0xE) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let msbvx = nthbit(7,vx)
      let result = vx << 1
      this.setRegister(0b1111, msbvx)
      this.setRegister(xRegister, result)
    }

    // 9XY0 if VX != VY step PC
    else if (this.getOp(0) == 0x9 && this.getOp(3) == 0x0) {
      let vx = this.getRegister(this.getOp(1))
      let vy = this.getRegister(this.getOp(2))
      this.stepPC(vx != vy ? INSTRUCTION_BYTE_LENGTH : 0)
    }

    // ANNN set I to NNN
    else if (this.getOp(0) == 0xA) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      this.setI(nnn)
    }

    // BNNN set PC to V0 + NNN
    else if (this.getOp(0) == 0xB) {
      let v0 = this.getRegister(0x0)
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      let result = v0 + nnn
      this.setPC(result)
    }

    // CXNN set VX to NN & RandomNumber (0...255)
    else if (this.getOp(0) == 0xC) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let nn = bit8(this.getOp(2), this.getOp(3))
      let rand = Math.random() * 256 | 0
      let result = vx & rand
      this.setRegister(xRegister, result)
    }

    // DXYN draw N pixels tall sprite from memory[I] at X from VX and Y from VY
    else if (this.getOp(0) == 0xD) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let x = this.getRegister(xRegister) % SCREEN_WIDTH
      let y = this.getRegister(yRegister) % SCREEN_HEIGHT
      let height = this.getOp(3)
      let memoryOffset = this.getI()
      this.drawSprite(x, y, height, memoryOffset)
    }

    // EX9E skip if key(VX)
    else if (this.getOp(0) == 0xE && this.getOp(2) == 0x9 && this.getOp(3) == 0xE) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let key = this.inputs[vx]
      this.stepPC(key ? INSTRUCTION_BYTE_LENGTH : 0)
    }

    // EXA1 skip if !key(VX)
    else if (this.getOp(0) == 0xE && this.getOp(2) == 0xA && this.getOp(3) == 0x1) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let key = this.inputs[vx]
      this.stepPC(key ? 0 : INSTRUCTION_BYTE_LENGTH)
    }

    // FX0A halt until key(VX)
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x0 && this.getOp(3) == 0xA) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let key = this.inputs[vx]
      this.stepPC(key ? 0 : -INSTRUCTION_BYTE_LENGTH)
    }

    // FX07 set VX to D
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x0 && this.getOp(3) == 0x7) {
      let xRegister = this.getOp(1)
      let d = this.getD()
      this.setRegister(xRegister, d)
    }

    // FX15 set D to VX
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x1 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      this.setD(vx)
    }

    // FX18 set S to VX
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x1 && this.getOp(3) == 0x8) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      this.setS(vx)
    }

    // FX1E set I to I + VX
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x1 && this.getOp(3) == 0xE) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let i = this.getI()
      let result = vx + i
      this.setI(result)
    }

    // FX29 set I to sprite_address(VX). this requires us to decide where in memory we store the fonts
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x2 && this.getOp(3) == 0x9) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let result = FONT_MEMORY_OFFSET + vx * FONT_HEIGHT
      this.setI(result)
    }

    // FX33 set memory[I] to Hundreds(VX), set memory[I+1] to Tens(VX), set memory[i+2] to Ones(VX)
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x3 && this.getOp(3) == 0x3) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let hundredsvx = hundreds(vx)
      let tensvx = tens(vx)
      let onesvx = ones(vx)
      let i = this.getI()
      this.setMemory(i+0, hundredsvx) 
      this.setMemory(i+1, tensvx) 
      this.setMemory(i+2, onesvx) 
    }

    // FX55 dump registers V0-VX to memory beginning at I
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x5 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let i = this.getI()
      this.dumpRegisters(xRegister, i)
    }

    // FX65 load registers V0-VX from memory beginning at I
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x6 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let i = this.getI()
      this.loadRegisters(xRegister, i)
    }

    // catch-all for debugging
    else {
      if (debugging) {
        console.warn(`Unrecognized instruction: ${this.op}`)
      } else {
        throw new Error(`Unrecognized instruction: ${this.op}`)
      }
    }
  }

  loadProgram(program, font) {
    this.display.fill(0x00)
    this.PC[0] = 512
    this.SP[0] = 0
    this.I[0] = 0
    this.D[0] = 0
    this.S[0] = 0
    this.V.fill(0x00)
    this.stack.fill(0x00)
    this.memory.fill(0x00)
    this.memory.set(font, FONT_MEMORY_OFFSET)
    this.memory.set(program, PROGRAM_MEMORY_OFFSET)
    this.op.fill(0x00)
  }

  fetchOp() {
    this.op[0] = highNibble(this.memory[this.PC[0]])
    this.op[1] = lowNibble(this.memory[this.PC[0]])
    this.op[2] = highNibble(this.memory[this.PC[0] + 1])
    this.op[3] = lowNibble(this.memory[this.PC[0] + 1])
  }

  getOp(nibbleIndex) {
    return this.op[nibbleIndex]
  }

  stepPC(amt = INSTRUCTION_BYTE_LENGTH) {
    this.PC[0] += amt
  }

  getPC() {
    return this.PC[0]
  }

  setPC(v) {
    this.PC[0] = v
  }

  pushStack(v) {
    this.stack[this.SP[0]] = v
    this.SP[0]++
  }

  popStack() {
    this.SP[0]--
    return this.stack[this.SP[0]]
  }

  getI() {
    return this.I[0]
  }

  setI(v) {
    this.I[0] = v
  }

  getD() {
    return this.D[0]
  }

  setD(v) {
    this.D[0] = v
  }

  getS() {
    return this.S[0]
  }

  setS(v) {
    this.S[0] = v
  }

  getRegister(i) {
    return this.V[i]
  }

  setRegister(i,v) {
    this.V[i] = v
  }

  setMemory(i,v) {
    this.memory[i] = v
  }

  dumpRegisters(x, i) {
    this.memory.set(this.V.slice(0, x+1), i)
  }

  loadRegisters(x, i) {
    this.V.set(this.memory.slice(i, i+x+1), 0)
  }

  drawSprite(xMin, yMin, height, memoryOffset) {
    let didCollide = false

    for (var j = 0; j < height; j++) {
      let y = yMin + j

      if (y > SCREEN_HEIGHT) {
        break
      }
      for (var i = 0; i < 8; i++) {
        let x = xMin + i

        if (x > SCREEN_WIDTH) {
          break
        }
        let index = y * SCREEN_WIDTH + x
        let displayPixel = this.display[index]
        let spritePixel = nthbit(7 - i, this.memory[memoryOffset + j])

        didCollide = didCollide || (displayPixel && spritePixel)
        this.display[index] = displayPixel ^ spritePixel
      }
    } 
    this.setRegister(0xF, didCollide)
  }
}

async function fetchProgram(url) {
  let options = { responseType: "arraybuffer" }
  let contents = await fetch(url, options)
  let buffer = await contents.arrayBuffer()
  let program = new Uint8Array(buffer)
  return program
}

const keyMappings = new Map([
  [ "Digit1", 0x1 ], [ "Digit2", 0x2 ], [ "Digit3", 0x3 ], [ "Digit4", 0xC ],
  [ "KeyQ", 0x4 ],   [ "KeyW", 0x5 ],   [ "KeyE", 0x6 ],   [ "KeyR", 0xD ],
  [ "KeyA", 0x7 ],   [ "KeyS", 0x8 ],   [ "KeyD", 0x9 ],   [ "KeyF", 0xE ],
  [ "KeyZ", 0xA ],   [ "KeyX", 0x0 ],   [ "KeyC", 0xB ],   [ "KeyV", 0xF ],
])

async function main() {
  let ibmlogo = await fetchProgram(IBM_URL)
  let ch8test = await fetchProgram(TEST_URL)
  let trip8demo = await fetchProgram(TRIP8_URL)
  let breakout = await fetchProgram(BREAKOUT_URL)
  let chip8 = new Chip8(breakout, font)

  document.addEventListener("keydown", function ({ code }) {
    if (keyMappings.has(code)) {
      chip8.inputs[keyMappings.get(code)] = true
    }
  })

  document.addEventListener("keyup", function ({ code }) {
    if (keyMappings.has(code)) {
      chip8.inputs[keyMappings.get(code)] = false
    }
  })

  document.addEventListener("visibilitychange", function () {
    console.log("Visibility change. Wiping inputs")
    chip8.inputs.fill(0)
  })

  // Video stuff
  let SCALE_FACTOR = 20
  let width = SCREEN_WIDTH * SCALE_FACTOR
  let height = SCREEN_HEIGHT * SCALE_FACTOR
  let reglcanvas = document.createElement("canvas")

  reglcanvas.style.width = width + "px"
  reglcanvas.width = devicePixelRatio * width 
  reglcanvas.height = devicePixelRatio * height 
  document.body.appendChild(reglcanvas)

  let reglrenderer = new ReglRenderer(reglcanvas, width, height)

  // Audio stuff
  let audioContext = new AudioContext()
  let webaudioRenderer = new WebAudioRenderer(audioContext)
  let audioActiveThisFrame = false

  // Timer stuff
  let prev = Date.now()
  let cur = Date.now()
  let dt = 0
  let clockElapsed = 0
  let timeToNextTimerTick = 0

  function runVM() {
    prev = cur
    cur = Date.now()
    dt = (cur - prev) / 1000
    clockElapsed += dt
    audioActiveThisFrame = false

    while (clockElapsed >= CLOCK_PERIOD) {
      chip8.execute(DEBUGGING)
      audioActiveThisFrame = audioActiveThisFrame || chip8.getS() > 0
      clockElapsed -= CLOCK_PERIOD 
      timeToNextTimerTick += CLOCK_PERIOD 
      while (timeToNextTimerTick >= TIMER_PERIOD) {
        chip8.setD(Math.max(0, chip8.getD() - 1))
        chip8.setS(Math.max(0, chip8.getS() - 1))
        timeToNextTimerTick -= TIMER_PERIOD 
      }
    }
    reglrenderer.render(chip8.display, SCREEN_WIDTH, SCREEN_HEIGHT)
    webaudioRenderer.render(audioActiveThisFrame, VOLUME_GAIN)
    requestAnimationFrame(runVM)
  }
  runVM()
}

main()