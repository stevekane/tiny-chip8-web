const { highNibble, lowNibble, nthbit, bit8, bit12 } = require("./binary-utils")
const { hundreds, tens, ones } = require("./decimal-utils")

const IBM_URL = "http://localhost:9966/IBM Logo.ch8"
const TEST_URL = "http://localhost:9966/test_opcode.ch8"
const INSTRUCTION_BYTE_LENGTH = 2
const INSTRUCTIONS_PER_CYCLE = 10
const MAX_STACK_FRAMES = 128
const REGISTER_COUNT = 16
const SCREEN_WIDTH = 64
const SCREEN_HEIGHT = 32
const FONT_MEMORY_OFFSET = 0 // tradition says 050 .. maybe change?
const FONT_HEIGHT = 5
const PROGRAM_MEMORY_OFFSET = 512

class Chip8 {
  constructor(program, font) {
    this.display = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
    this.PC = new Uint16Array([512])
    this.SP = new Uint16Array([0])
    this.I = new Uint16Array(1)
    this.D = new Uint8Array(1)
    this.S = new Uint8Array(1)
    this.V = new Uint8Array(REGISTER_COUNT)
    this.stack = new Uint16Array(MAX_STACK_FRAMES)
    this.memory = new Uint8Array(4096)
    this.memory.set(program, PROGRAM_MEMORY_OFFSET)
    this.memory.set(font, FONT_MEMORY_OFFSET)
    this.op = new Uint8Array(4)
  }

  execute(debugging=false) {
    this.fetchOp()
    this.stepPC(INSTRUCTION_BYTE_LENGTH)

    // SKIP-LIST. Instructions NOT implemented yet
    // DETAILS OF CARRY / BORROW for some mathematical operations. Investigate
    // AMBIGUITIES IN INSTRUCTIONS between generations. May require configuration / settings
    // EX9E if key at VX is down advance PC
    // EXA1 if key at VX is up advance PC
    // FX0A BLOCKS waiting for key stored in VX to be pressed

    // 00E0 clear  
    if (this.getOp(0) == 0x0 && this.getOp(2) == 0xE && this.getOp(3) == 0x0) {
      this.display.fill(0)
      if (debugging) console.log("CLEAR")
    } 

    // 00EE return from subroutine
    else if (this.getOp(0) == 0x0 && this.getOp(2) == 0xE && this.getOp(3) == 0xE) {
      let addr = this.popStack()
      this.setPC(addr)
      if (debugging) console.log(`RETURN to ${addr}`)
    }

    // 1NNN jump. set PC to 12-bit value NNN
    else if (this.getOp(0) == 0x1) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      this.setPC(nnn)
      if (debugging) console.log(`JUMP to ${nnn}`)
    }

    // 2NNN call subroutine at NNN, store PC on stack and change PC
    else if (this.getOp(0) == 0x2) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      let pc = this.getPC()
      this.pushStack(pc)
      this.setPC(nnn)
      if (debugging) console.log(`CALL at ${nnn}. STORE ${pc}`)
    }

    // 3XNN if VX == NN step PC
    else if (this.getOp(0) == 0x3) {
      let vx = this.getRegister(this.getOp(1))
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.stepPC(vx == nn ? INSTRUCTION_BYTE_LENGTH : 0)
      if (debugging) console.log(`SKIP IF ${vx} == ${nn}`)
    }

    // 4XNN if VX != NN step PC
    else if (this.getOp(0) == 0x4) {
      let vx = this.getRegister(this.getOp(1))
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.stepPC(vx != nn ? INSTRUCTION_BYTE_LENGTH : 0)
      if (debugging) console.log(`SKIP IF ${vx} != ${nn}`)
    }

    // 5XY0 if VX == VY step PC
    else if (this.getOp(0) == 0x5 && this.getOp(3) == 0x0) {
      let vx = this.getRegister(this.getOp(1))
      let vy = this.getRegister(this.getOp(2))
      this.stepPC(vx == vy ? INSTRUCTION_BYTE_LENGTH : 0)
      if (debugging) console.log(`SKIP IF ${vx} == ${vy}`)
    }

    // 6XNN set VX to NN
    else if (this.getOp(0) == 0x6) {
      let x = this.getOp(1)
      let nn = bit8(this.getOp(2), this.getOp(3))
      this.setRegister(x, nn)
      if (debugging) console.log(`SET V(${x}) to ${nn}`)
    }
    
    // 7XNN add NN to VX
    else if (this.getOp(0) == 0x7) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let nn = bit8(this.getOp(2), this.getOp(3))
      let result = vx + nn
      this.setRegister(xRegister, result)
      if (debugging) console.log(`ADD ${nn} to V(${xRegister})`)
    }

    // 8XY0 set VX to VY
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x0) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vy)
      if (debugging) console.log(`SET V(${xRegister}) to V(${yRegister})`)
    }

    // 8XY1 set VX to VX | VY
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x1) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx | vy)
      if (debugging) console.log(`SET V(${xRegister}) to V(${xRegister}) | V(${yRegister})`)
    }

    // 8XY2 set VX to VX & VY
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x2) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx & vy)
      if (debugging) console.log(`SET V(${xRegister}) to V(${xRegister}) & V(${yRegister})`)
    }

    // 8XY3 set VX to VX ^ VY.
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x3) {
      let xRegister = this.getOp(1)
      let yRegister = this.getOp(2)
      let vx = this.getRegister(xRegister)
      let vy = this.getRegister(yRegister)
      this.setRegister(xRegister, vx ^ vy)
      if (debugging) console.log(`SET V(${xRegister}) to V(${xRegister}) ^ V(${yRegister})`)
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
      if (debugging) console.log(`ADD V(${yRegister}) to V(${xRegister}). SET VF when carry`)
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
      if (debugging) console.log(`SUB V(${yRegister}) from V(${xRegister}). SET VF when not borrow`)
    }

    // 8X_6 VX >>= 1. set VF to LSB(VX) then shift VX right by 1
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0x6) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let lsbvx = nthbit(0,vx)
      let result = vx >> 1
      this.setRegister(0xF, lsbvx)
      this.setRegister(xRegister, result)
      if (debugging) console.log(`STORE LSB(V(${xRegister})) in 0xF. SHIFT V(${xRegister}) right by 1`)
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
      if (debugging) console.log(`SET V(${xRegister}) to V(${yRegister}) - V(${xRegister}). SET VF when not borrow`)
    }

    // 8XYE VX <<= 1. set VF to MSB(VX) then shift VX left by 1
    else if (this.getOp(0) == 0x8 && this.getOp(3) == 0xE) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let msbvx = nthbit(7,vx)
      let result = vx << 1
      this.setRegister(0b1111, msbvx)
      this.setRegister(xRegister, result)
      if (debugging) console.log(`STORE MSB(V(${xRegister})) in 0xF. SHIFT V(${xRegister}) left by 1`)
    }

    // 9XY0 if VX != VY step PC
    else if (this.getOp(0) == 0x9 && this.getOp(3) == 0x0) {
      let vx = this.getRegister(this.getOp(1))
      let vy = this.getRegister(this.getOp(2))
      this.stepPC(vx != vy ? INSTRUCTION_BYTE_LENGTH : 0)
      if (debugging) console.log(`SKIP IF ${vx} != ${vy}`)
    }

    // ANNN set I to NNN
    else if (this.getOp(0) == 0xA) {
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      this.setI(nnn)
      if (debugging) console.log(`SET I to ${nnn}`)
    }

    // BNNN set PC to V0 + NNN
    else if (this.getOp(0) == 0xB) {
      let v0 = this.getRegister(0x0)
      let nnn = bit12(this.getOp(1), this.getOp(2), this.getOp(3))
      let result = v0 + nnn
      this.setPC(result)
      if (debugging) console.log(`SET PC to ${v0} + ${nnn}`)
    }

    // CXNN set VX to NN & RandomNumber (0...255)
    else if (this.getOp(0) == 0xC) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let nn = bit8(this.getOp(2), this.getOp(3))
      let rand = Math.random() * 256 | 0
      let result = vx & rand
      this.setRegister(xRegister, result)
      if (debugging) console.log(`SET V(${xRegister}) to ${nn} & ${rand}`)
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
      if (debugging) console.log(`DRAW at ${[x,y]} height ${height} at offset ${memoryOffset}`)
    }

    // FX07 set VX to D
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x0 && this.getOp(3) == 0x7) {
      let xRegister = this.getOp(1)
      let d = this.getD()
      console.log("set vx to D")
      this.setRegister(xRegister, d)
    }

    // FX15 set D to VX
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x1 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      console.log("set D to vx")
      this.setD(vx)
    }

    // FX18 set S to VX
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x1 && this.getOp(3) == 0x8) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      console.log("set S to vx")
      this.setS(vx)
    }

    // FX1E set I to I + VX
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x1 && this.getOp(3) == 0xE) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let i = this.getI()
      let result = vx + i
      this.setI(result)
      if (debugging) console.log(`ADD V(${xRegister}) to ${i}`)
    }

    // FX29 set I to sprite_address(VX). this requires us to decide where in memory we store the fonts
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x2 && this.getOp(3) == 0x9) {
      let xRegister = this.getOp(1)
      let vx = this.getRegister(xRegister)
      let result = FONT_MEMORY_OFFSET + vx * FONT_HEIGHT
      console.log("sprite address")
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
      if (debugging) console.log(`SET MEM[i] to ${hundredsvx}. SET MEM[i+1] to ${tensvx}. SET MEM[i+2] to ${onesvx}`)
    }

    // FX55 dump registers V0-VX to memory beginning at I
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x5 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let i = this.getI()
      this.dumpRegisters(xRegister, i)
      if (debugging) console.log(`DUMP REGISTERS V0-V${xRegister}`)
    }

    // FX65 load registers V0-VX from memory beginning at I
    else if (this.getOp(0) == 0xF && this.getOp(2) == 0x6 && this.getOp(3) == 0x5) {
      let xRegister = this.getOp(1)
      let i = this.getI()
      this.loadRegisters(xRegister, i)
      if (debugging) console.log(`LOAD REGISTERS V0-V${xRegister}`)
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

  // grab registers [0-x] and copy them into memory beginning at i
  dumpRegisters(x, i) {
    this.memory.set(this.V.slice(0, x+1), i)
  }

  // grab memory addresses [i-i+x] and copy them into registers beginning at 0
  loadRegisters(x, i) {
    this.V.set(this.memory.slice(i, i+x+1), 0)
  }

  // TODO: handle the case of overlap/wrapping later
  drawSprite(xMin, yMin, height, memoryOffset) {
    let didCollide = false
    for (var j = 0; j < height; j++) {
      let y = yMin + j

      for (var i = 0; i < 8; i++) {
        let x = xMin + i
        let index = y * SCREEN_WIDTH + x
        let displayPixel = this.display[index]
        let spritePixel = nthbit(7 - i, this.memory[memoryOffset + j])

        if (displayPixel > 0 && spritePixel > 0) {
          didCollide = true
          this.display[index] = 0
        } else if (spritePixel > 0) {
          this.display[index] = 1
        }
      }
    } 
    this.setRegister(0xF, didCollide)
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
  let font = [
    0xF0, 0x90, 0x90, 0x90, 0xF0, // 0
    0x20, 0x60, 0x20, 0x20, 0x70, // 1
    0xF0, 0x10, 0xF0, 0x80, 0xF0, // 2
    0xF0, 0x10, 0xF0, 0x10, 0xF0, // 3
    0x90, 0x90, 0xF0, 0x10, 0x10, // 4
    0xF0, 0x80, 0xF0, 0x10, 0xF0, // 5
    0xF0, 0x80, 0xF0, 0x90, 0xF0, // 6
    0xF0, 0x10, 0x20, 0x40, 0x40, // 7
    0xF0, 0x90, 0xF0, 0x90, 0xF0, // 8
    0xF0, 0x90, 0xF0, 0x10, 0xF0, // 9
    0xF0, 0x90, 0xF0, 0x90, 0x90, // A
    0xE0, 0x90, 0xE0, 0x90, 0xE0, // B
    0xF0, 0x80, 0x80, 0x80, 0xF0, // C
    0xE0, 0x90, 0x90, 0x90, 0xE0, // D
    0xF0, 0x80, 0xF0, 0x80, 0xF0, // E
    0xF0, 0x80, 0xF0, 0x80, 0x80  // F
  ]
  let options = { responseType: "arraybuffer" }
  let contents = await fetch(TEST_URL, options)
  let buffer = await contents.arrayBuffer()
  let program = new Uint8Array(buffer)
  let chip8 = new Chip8(program, font)
  let canvas = document.createElement("canvas")
  let ctx = canvas.getContext("2d")

  canvas.width = SCREEN_WIDTH
  canvas.height = SCREEN_HEIGHT
  ctx.width = SCREEN_WIDTH
  ctx.height = SCREEN_HEIGHT
  document.body.style.backgroundColor = "grey"
  document.body.appendChild(canvas)

  console.warn("REMINDER: MOVE FONTS TO FILE?")
  function runVM() {
    let instructionsExecuted = 0
    let debugging = false
  
    while (instructionsExecuted++ < INSTRUCTIONS_PER_CYCLE) {
      chip8.execute(debugging)
    }
    renderCanvas(chip8, ctx)
    requestAnimationFrame(runVM)
  }
  runVM()
}

main()