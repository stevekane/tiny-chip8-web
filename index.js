const fs = require("fs")

/*
The goal is to implement a console-rendering of the smallest subset of the 
chip8 instruction-set that renders the IBM logo. This does not include 
keyboard handling, audio, or most of the logical opcodes. What it does
prove out is that you have a basic rendering loop and a few opcodes
correctly interpreted.

Why do this?

I am considering using chip-8 emulation as a target for the new language
to build something sort of "non-trivial" while also being fun and requring
access to external hardware and some "low-level" notions like bytes.

Chip-8 specs:

4kb of RAM
64×32 pixel display (each pixel is a bit, this is therefore 8x4 bytes)
Program counter (PC)
16-bit index register (I)
16-bit stack
8-bit delay timer decremented at 60Hz
8-bit sound timer decremented at 60Hz. Plays beep when non-zero
16 8-bit registers (V0-VF)

In javascript, we'll handle all bytes via Uint8Array. That is, each entry in 
this array is 1 byte.
*/

const MAX_STACK_FRAMES = 128
const REGISTER_COUNT = 16
const SCREEN_WIDTH = 64
const SCREEN_HEIGHT = 32

class Chip8 {
  // program should be copied into memory beginning at offset 512
  // the chip-8 VM + standard characters occupy the first 512 locations
  // as per the specification
  // the program counter should also be initialized to 512 where the 
  // loaded program begins
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
}

function fetch(c) {
  return c.memory.slice(c.PC[0],c.PC[0] + 2)
}

function highNibble(byte) {
  return (byte & 0xF0) >> 4
}

function lowNibble(byte) {
  return byte & 0x0F
}

function decode(i) {
  return [ highNibble(i[0]), lowNibble(i[0]), highNibble(i[1]), lowNibble(i[1]) ]
}

function stepPC(c) {
  c.PC[0] += 2
}

function bitNumber(n,b) {
  return (b & (1 << n)) != 0
}

function execute(op, c) {
  switch (op[0]) {
    // 00E0 clear  
    case 0: {
      if (op[2] == 14) {
        c.display.fill(0)
        stepPC(c)
      }
    } break

    // 1NNN jump. set PC to 12-bit value NNN
    case 1: {
      let nnn = bit12(op[1],op[2],op[3])
      c.PC = nnn
    } break

    // 6XNN set VX to NN
    case 6: {
      let x = op[1]
      let nn = bit8(op[2],op[3])
      c.V[x] = nn
      stepPC(c)
    } break

    // 7XNN add NN to VX
    case 7: {
      let x = op[1]
      let nn = bit8(op[2],op[3])
      c.V[x] += nn
      stepPC(c)
    } break

    // ANNN set I to NNN
    case 10: {
      let nnn = bit12(op[1],op[2],op[3])
      c.I = nnn
      stepPC(c)
    } break

    // DXYN draw N pixels tall sprite from memory[I] at X from VX and Y from VY
    case 13: {
      let [_,xAddr,yAddr,n] = op
      let x = c.V[xAddr] % SCREEN_WIDTH // vx & SCREEN_WIDTH
      let y = c.V[yAddr] % SCREEN_HEIGHT // vy & SCREEN_HEIGHT
      let sprite = c.memory.slice(c.I, c.I + n)

      drawSprite(c,x,y,n,sprite)
      stepPC(c)
    } break
  }
}

function bit8(x,y) {
  return (x << 4) + y
}

function bit12(x,y,z) {
  return (x << 8) + (y << 4) + z
}

const sprite = new Uint8Array([
  0b00111100,
  0b11000011,
  0b11000011,
  0b00111100
])

// TODO: handle the case of overlap/wrapping later
function drawSprite(c,xMin,yMin,n,s) {
  for (var j = 0; j < n; j++) {
    let y = yMin + j

    for (var i = 0; i < 8; i++) {
      let x = xMin + i
      let index = y * SCREEN_WIDTH + x
      let displayPixel = c.display[index]
      let spritePixel = bitNumber(7 - i,s[j])

      if (displayPixel > 0 && spritePixel > 0) {
        c.display[index] = 0
      } else if (spritePixel > 0) {
        c.display[index] = 1
      }
    }
  } 
  render(c)
}

function render(c) {
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
const program = fs.readFileSync("./IBM Logo.ch8")
const chip8 = new Chip8(program)

drawSprite(chip8,0,0,4,sprite)
drawSprite(chip8,56,28,4,sprite)
render(chip8)

setInterval(_ => { 
  let ins = fetch(chip8)
  let op = decode(ins)

  execute(op,chip8)
  render(chip8)
}, 1000)