const fs = require("fs")

const INSTRUCTIONS_PER_CYCLE = 1
const MAX_STACK_FRAMES = 128
const REGISTER_COUNT = 16
const SCREEN_WIDTH = 64
const SCREEN_HEIGHT = 32
// fetch two bytes (1 instruction) from memory
const fetchInstruction = c => c.memory.slice(c.PC[0],c.PC[0] + 2)
// get the value of the greatest 4 bits of a byte
const highNibble = byte => (byte & 0xF0) >> 4
// get the value of the least 4 bits of a byte
const lowNibble = byte => byte & 0x0F
// split two bytes into 4 nibbles (half bytes)
const decodeInstruction = i => ([ highNibble(i[0]), lowNibble(i[0]), highNibble(i[1]), lowNibble(i[1]) ])
// step the program counter by two (instructions are two bytes each)
const stepPC = c => c.PC[0] += 2
// returns value of nth bit in the byte b
const nthbit = (n,b) => (b & (1 << n)) > 0
// combine two nibbles into an 8bit number
const bit8 = (x,y) => (x << 4) + y
// combine three nibbles into a 12bit number
const bit12 = (x,y,z) => (x << 8) + (y << 4) + z

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

// TODO: handle the case of overlap/wrapping later
function drawSprite(c,xMin,yMin,n,s) {
  for (var j = 0; j < n; j++) {
    let y = yMin + j

    for (var i = 0; i < 8; i++) {
      let x = xMin + i
      let index = y * SCREEN_WIDTH + x
      let displayPixel = c.display[index]
      let spritePixel = nthbit(7 - i,s[j])

      if (displayPixel > 0 && spritePixel > 0) {
        c.display[index] = 0
      } else if (spritePixel > 0) {
        c.display[index] = 1
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
  let url = "http://localhost:9966/IBM Logo.ch8"
  let contents = await fetch(url, options)
  let buffer = await contents.arrayBuffer()
  let program = new Uint8Array(buffer)
  let chip8 = new Chip8(program)
  let canvas = document.createElement("canvas")
  let ctx = canvas.getContext("2d")
  let SCALE_FACTOR = 10

  canvas.width = SCREEN_WIDTH * 10
  canvas.height = SCREEN_HEIGHT * 10
  ctx.width = SCREEN_WIDTH
  ctx.height = SCREEN_HEIGHT
  document.body.style.backgroundColor = "grey"
  document.body.appendChild(canvas)
  function runVM() {
    let instructionsExecuted = 0
  
    while (instructionsExecuted++ < INSTRUCTIONS_PER_CYCLE) {
      let ins = fetchInstruction(chip8)
      let op = decodeInstruction(ins)

      execute(op,chip8)
    }
    // renderConsole(chip8)
    renderCanvas(chip8, ctx)
    requestAnimationFrame(runVM)
  }
  runVM()
}

main()