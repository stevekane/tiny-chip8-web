const { highNibble, lowNibble, nthbit, bit8, bit12 } = require("./binary-utils")

const PROGRAM_URL = "http://localhost:9966/IBM Logo.ch8"
const INSTRUCTION_BYTE_LENGTH = 2
const INSTRUCTIONS_PER_CYCLE = 1
const MAX_STACK_FRAMES = 128
const REGISTER_COUNT = 16
const SCREEN_WIDTH = 64
const SCREEN_HEIGHT = 32

class Chip8 {
  constructor(program) {
    this.display = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
    this.PC = new Uint16Array([512])
    this.I = new Uint16Array(1)
    this.D = new Uint8Array(1)
    this.S = new Uint8Array(1)
    this.V = new Uint8Array(REGISTER_COUNT)
    this.stack = new Uint16Array(MAX_STACK_FRAMES)
    this.memory = new Uint8Array(4096)
    this.memory.set(program,512)
  }

  execute(debugging=false) {
    const l = this.memory[this.PC[0]]
    const r = this.memory[this.PC[0] + 1]
    const op = [ highNibble(l), lowNibble(l), highNibble(r), lowNibble(r)]

    // 00E0 clear  
    if (op[0] == 0b0000 && op[2] == 0b1110) {
      this.display.fill(0)
      this.stepPC(INSTRUCTION_BYTE_LENGTH)
    } 
    // 1NNN jump. set PC to 12-bit value NNN
    else if (op[0] == 0b0001) {
      let nnn = bit12(op[1],op[2],op[3])
      this.setPC(nnn)
    }
    // 6XNN set VX to NN
    else if (op[0] == 0b0110) {
      let x = op[1]
      let nn = bit8(op[2],op[3])
      this.setRegister(x,nn)
      this.stepPC(INSTRUCTION_BYTE_LENGTH)
    }
    // 7XNN add NN to VX
    else if (op[0] == 0b0111) {
      let x = op[1]
      let nn = bit8(op[2],op[3])
      this.incrementRegister(x,nn)
      this.stepPC(INSTRUCTION_BYTE_LENGTH)
    }
    // ANNN set I to NNN
    else if (op[0] == 0b1010) {
      let nnn = bit12(op[1],op[2],op[3])
      this.setI(nnn)
      this.stepPC(INSTRUCTION_BYTE_LENGTH)
    }
    // DXYN draw N pixels tall sprite from memory[I] at X from VX and Y from VY
    else if (op[0] == 0b1101) {
      let [_,xAddr,yAddr,n] = op
      let x = this.V[xAddr] % SCREEN_WIDTH
      let y = this.V[yAddr] % SCREEN_HEIGHT
      let sprite = this.memory.slice(this.I, this.I+n)
      this.drawSprite(x, y, n, sprite)
      this.stepPC(INSTRUCTION_BYTE_LENGTH)
    }
    else {
      console.log(`Unrecognized instruction: ${op}`)
    }
  }

  stepPC(amt = INSTRUCTION_BYTE_LENGTH) {
    this.PC[0] += amt
  }

  setPC(v) {
    this.PC[0] = v
  }

  setI(v) {
    this.I[0] = v
  }

  setRegister(i,v) {
    this.V[i] = v
  }

  incrementRegister(i,v) {
    this.V[i] += v
  }

  // TODO: handle the case of overlap/wrapping later
  drawSprite(xMin,yMin,n,s) {
    for (var j = 0; j < n; j++) {
      let y = yMin + j

      for (var i = 0; i < 8; i++) {
        let x = xMin + i
        let index = y * SCREEN_WIDTH + x
        let displayPixel = this.display[index]
        let spritePixel = nthbit(7 - i, s[j])

        if (displayPixel > 0 && spritePixel > 0) {
          this.display[index] = 0
        } else if (spritePixel > 0) {
          this.display[index] = 1
        }
      }
    } 
  }
}

function renderConsole(c) {
  console.log("------------------------------------------------------------------")
  for (var j = 0; j < SCREEN_HEIGHT; j++) {
    let offset = j * SCREEN_WIDTH
    let buffer = "|"
    for (var i = 0; i < SCREEN_WIDTH; i++) {
      buffer += c.display[offset + i] ? "X" : " "
    }
    buffer += "|"
    console.log(buffer)
  }
  console.log("------------------------------------------------------------------")
}

function renderCanvas(c, ctx) {
  let imageData = ctx.createImageData(ctx.width, ctx.height)

  for (var j = 0; j < SCREEN_HEIGHT; j++) {
    let offset = j * SCREEN_WIDTH
    for (var i = 0; i < SCREEN_WIDTH; i++) {
      let pixel = c.display[offset + i]
      let target = (offset + i) * 4

      imageData.data[target + 0] = pixel ? 255 : 0
      imageData.data[target + 1] = pixel ? 215 : 0
      imageData.data[target + 3] = pixel ? 255 : 0
    }
  }
  ctx.clearRect(0, 0, ctx.width, ctx.height)
  ctx.scale(10,10)
  ctx.putImageData(imageData, 0, 0)
}

async function main() {
  let options = { responseType: "arraybuffer" }
  let contents = await fetch(PROGRAM_URL, options)
  let buffer = await contents.arrayBuffer()
  let program = new Uint8Array(buffer)
  let chip8 = new Chip8(program)
  let canvas = document.createElement("canvas")
  let ctx = canvas.getContext("2d")

  canvas.width = SCREEN_WIDTH
  canvas.height = SCREEN_HEIGHT
  ctx.width = SCREEN_WIDTH
  ctx.height = SCREEN_HEIGHT
  document.body.style.backgroundColor = "grey"
  document.body.appendChild(canvas)

  function runVM() {
    let instructionsExecuted = 0
    let debugging = true
  
    while (instructionsExecuted++ < INSTRUCTIONS_PER_CYCLE) {
      chip8.execute(debugging)
    }
    // renderConsole(chip8)
    renderCanvas(chip8, ctx)
    requestAnimationFrame(runVM)
  }
  runVM()
}

main()