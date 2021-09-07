const { highNibble, lowNibble, nthbit, bit8, bit12 } = require("./binary-utils")

const IBM_URL = "http://localhost:9966/IBM Logo.ch8"
const TEST_URL = "http://localhost:9966/test_opcode.ch8"
const INSTRUCTION_BYTE_LENGTH = 2
const INSTRUCTIONS_PER_CYCLE = 10
const MAX_STACK_FRAMES = 128
const REGISTER_COUNT = 16
const SCREEN_WIDTH = 64
const SCREEN_HEIGHT = 32

class Chip8 {
  constructor(program) {
    this.display = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
    this.PC = new Uint16Array([512])
    this.SP = new Uint16Array([0])
    this.I = new Uint16Array(1)
    this.D = new Uint8Array(1)
    this.S = new Uint8Array(1)
    this.V = new Uint8Array(REGISTER_COUNT)
    this.stack = new Uint16Array(MAX_STACK_FRAMES)
    this.memory = new Uint8Array(4096)
    this.memory.set(program,512)
    this.op = new Uint8Array(4)
  }

  execute(debugging=false) {
    this.fetchOp()
    this.stepPC(INSTRUCTION_BYTE_LENGTH)

    // SKIP-LIST. Instructions NOT implemented yet
    // EX9E if key at VX is down advance PC
    // EXA1 if key at VX is up advance PC
    // FX0A BLOCKS waiting for key stored in VX to be pressed


    // 00EE return from subroutine
    if (this.getOp(0) == 0b0000 && this.getOp(2) == 0b1110 && this.getOp(3) == 0b1110) {
      let addr = this.popStack()
      this.setPC(addr)
    }

    // 00E0 clear  
    else if (this.getOp(0) == 0b0000 && this.getOp(2) == 0b1110 && this.getOp(3) == 0b0000) {
      this.display.fill(0)
    } 

    // 1NNN jump. set PC to 12-bit value NNN
    else if (this.getOp(0) == 0b0001) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      this.setPC(nnn)
    }

    // 2NNN call subroutine at NNN, store PC on stack and change PC
    else if (this.getOp(0) == 0b0010) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      let pc = this.getPC()
      this.pushStack(pc)
      this.setPC(nnn)
      console.log(`Set PC to ${nnn} and pushed ${pc} to the stack: ${this.stack[this.SP[0] - 1]}`)
      console.log()
    }

    // 3XNN if VX == NN step PC
    else if (this.getOp(0) == 0b0011) {
      let vx = this.getRegister(this.getOp(1))
      let nn = bit8(this.getOp(2), this.getOp(3))

      if (vx == nn) {
        this.stepPC(INSTRUCTION_BYTE_LENGTH)
      }
    }

    // 4XNN if VX != NN step PC
    else if (this.getOp(0) == 0b0100) {
      let vx = this.getRegister(this.getOp(1))
      let nn = bit8(this.getOp(2), this.getOp(3))

      if (vx != nn) {
        this.stepPC(INSTRUCTION_BYTE_LENGTH)
      }
    }

    // 5XY0 if VX == VY step PC
    else if (this.getOp(0) == 0b0101 && this.getOp(3) == 0b0000) {
      let vx = this.getRegister(this.getOp(1))
      let vy = this.getRegister(this.getOp(2))

      if (vx == vy) {
        this.stepPC(INSTRUCTION_BYTE_LENGTH)
      }
    }

    // 6XNN set VX to NN
    else if (this.getOp(0) == 0b0110) {
      let x = this.getOp(1)
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.setRegister(x, nn)
    }
    
    // 7XNN add NN to VX
    else if (this.getOp(0) == 0b0111) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let nn = bit8(this.getOp(2), this.getOp(3))
      let result = vx + nn
      this.setRegister(xRegister,result)
    }

    // 8XY0 set VX to VY
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0000) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vy)
    }

    // 8XY1 set VX to VX | VY
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0001) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx | vy)
    }

    // 8XY2 set VX to VX & VY
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0010) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx & vy)
    }

    // 8XY3 set VX to VX ^ VY.
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0011) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx ^ vy)
    }

    // 8XY4 VX += VY. set VF to 1 when carry otherwise 0
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0100) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      let result = vx + vy
      // TODO: determine if there is a carry and set VF accordingly
      this.setRegister(xRegister, result)
    }

    // 8XY5 VX -= VY. set VF to 0 when borrow otherwise 1
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0101) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      let result = vx - vy
      // TODO: determine if there is a borrow and set VF accordingly
      this.setRegister(xRegister, result)
    }

    // 8X_6 VX >>= 1. set VF to LSB(VX) then shift VX right by 1
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0110) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let lsbvx = nthbit(0,vx)
      let result = vx >> 1
      this.setRegister(0b1111, lsbvx)
      this.setRegister(xRegister, result)
    }

    // 8XY7 set VX to VY - VX. set VF to 0 when borrow otherwise 1
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b0111) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      let result = vy - vx
      // TODO: determine if there is a borrow and set VF accordingly
      this.setRegister(xRegister, result)
    }

    // 8XYE VX <<= 1. set VF to MSB(VX) then shift VX left by 1
    else if (this.getOp(0) == 0b1000 && this.getOp(3) == 0b1110) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let msbvx = nthbit(7,vx)
      let result = vx << 1
      this.setRegister(0b1111, msbvx)
      this.setRegister(xRegister, result)
    }

    // 9XY0 if VX != VY step PC
    else if (this.getOp(0) == 0b1001 && this.getOp(3) == 0b0000) {
      let vx = this.getRegister(this.getOp(1))
      let vy = this.getRegister(this.getOp(2))

      if (vx != vy) {
        this.stepPC(INSTRUCTION_BYTE_LENGTH)
      }
    }

    // ANNN set I to NNN
    else if (this.getOp(0) == 0b1010) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      this.setI(nnn)
    }

    // BNNN set PC to V0 + NNN
    else if (this.getOp(0) == 0b1011) {
      let v0 = this.getRegister(0b0000)
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      let result = v0 + nnn
      this.setPC(result)
    }

    // DXYN draw N pixels tall sprite from memory[I] at X from VX and Y from VY
    else if (this.getOp(0) == 0b1101) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let x = this.getRegister(xRegister) % SCREEN_WIDTH
      let y = this.getRegister(yRegister) % SCREEN_HEIGHT
      let height = this.getOp(3)
      let memoryOffset = this.getI()
      this.drawSprite(x, y, height, memoryOffset)
    }
    else {
      if (debugging) {
        console.log(`Unrecognized instruction: ${this.op}`)
      } else {
        throw new Error(`Unrecognized instruction: ${this.op}`)
      }
    }
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

  getRegister(i) {
    return this.V[i]
  }

  setRegister(i,v) {
    this.V[i] = v
  }

  // TODO: handle the case of overlap/wrapping later
  drawSprite(xMin, yMin, height, memoryOffset) {
    for (var j = 0; j < height; j++) {
      let y = yMin + j

      for (var i = 0; i < 8; i++) {
        let x = xMin + i
        let index = y * SCREEN_WIDTH + x
        let displayPixel = this.display[index]
        let spritePixel = nthbit(7 - i, this.memory[memoryOffset + j])

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
  let contents = await fetch(TEST_URL, options)
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