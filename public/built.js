(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const { highNibble, lowNibble, nthbit, bit8, bit12 } = require("./src/binary-utils")
const { hundreds, tens, ones } = require("./src/decimal-utils")
const font = require("./src/default-font")
const ReglRenderer = require('./src/regl-renderer')
const WebAudioRenderer = require("./src/webaudio-renderer")
const InputSystem = require("./src/input-system")

const IBM_URL = "../ROMs/IBM Logo.ch8"
const TEST_URL = "../ROMs/test_opcode.ch8"
const TRIP8_URL = "../ROMs/trip-8.ch8"
const BREAKOUT_URL = "../ROMs/breakout.ch8"
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

async function main() {
  let ibmlogo = await fetchProgram(IBM_URL)
  let ch8test = await fetchProgram(TEST_URL)
  let trip8demo = await fetchProgram(TRIP8_URL)
  let breakout = await fetchProgram(BREAKOUT_URL)
  let chip8 = new Chip8(breakout, font)

  // Input stuff
  let inputSystem = new InputSystem(document)

  // Video stuff
  let SCALE_FACTOR = 20
  let width = SCREEN_WIDTH * SCALE_FACTOR
  let height = SCREEN_HEIGHT * SCALE_FACTOR
  let reglcanvas = document.createElement("canvas")

  reglcanvas.style.width = width + "px"
  reglcanvas.width = devicePixelRatio * width 
  reglcanvas.height = devicePixelRatio * height 
  document.body.appendChild(reglcanvas)

  let reglRenderer = new ReglRenderer(reglcanvas, width, height)

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

    chip8.inputs.set(inputSystem.keys)
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
    reglRenderer.render(chip8.display, SCREEN_WIDTH, SCREEN_HEIGHT)
    webaudioRenderer.render(audioActiveThisFrame, VOLUME_GAIN)
    requestAnimationFrame(runVM)
  }
  runVM()
}

main()
},{"./src/binary-utils":4,"./src/decimal-utils":5,"./src/default-font":6,"./src/input-system":7,"./src/regl-renderer":8,"./src/webaudio-renderer":9}],2:[function(require,module,exports){
module.exports = BigTriangle

function bound ( min, max, v ) {
  return v < min
    ? min
    : v > max 
      ? max 
      : v
}

function BigTriangle ( dimensionality ) {
  const MIN_DIMENSION = 2
  const MAX_DIMENSION = 4
  const dim = bound(MIN_DIMENSION, MAX_DIMENSION, dimensionality)
  const Ctor = Float32Array != null ? Float32Array : Array
  const out = new Ctor(3 * dim)

  out[0] = -4
  out[1] = -4
  out[dim] = 0
  out[dim+1] = 4
  out[dim * 2] = 4
  out[dim * 2 + 1] = -4

  if ( dim === 4 ) {
    out[dim * 0 + 3] = 1 
    out[dim * 1 + 3] = 1 
    out[dim * 2 + 3] = 1 
  }
  return out 
}

},{}],3:[function(require,module,exports){
(function(Z,ka){"object"===typeof exports&&"undefined"!==typeof module?module.exports=ka():"function"===typeof define&&define.amd?define(ka):Z.createREGL=ka()})(this,function(){function Z(a,b){this.id=Db++;this.type=a;this.data=b}function ka(a){if(0===a.length)return[];var b=a.charAt(0),c=a.charAt(a.length-1);if(1<a.length&&b===c&&('"'===b||"'"===b))return['"'+a.substr(1,a.length-2).replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"'];if(b=/\[(false|true|null|\d+|'[^']*'|"[^"]*")\]/.exec(a))return ka(a.substr(0,
b.index)).concat(ka(b[1])).concat(ka(a.substr(b.index+b[0].length)));b=a.split(".");if(1===b.length)return['"'+a.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"'];a=[];for(c=0;c<b.length;++c)a=a.concat(ka(b[c]));return a}function cb(a){return"["+ka(a).join("][")+"]"}function db(a,b){if("function"===typeof a)return new Z(0,a);if("number"===typeof a||"boolean"===typeof a)return new Z(5,a);if(Array.isArray(a))return new Z(6,a.map(function(a,e){return db(a,b+"["+e+"]")}));if(a instanceof Z)return a}function Eb(){var a=
{"":0},b=[""];return{id:function(c){var e=a[c];if(e)return e;e=a[c]=b.length;b.push(c);return e},str:function(a){return b[a]}}}function Fb(a,b,c){function e(){var b=window.innerWidth,e=window.innerHeight;a!==document.body&&(e=f.getBoundingClientRect(),b=e.right-e.left,e=e.bottom-e.top);f.width=c*b;f.height=c*e}var f=document.createElement("canvas");L(f.style,{border:0,margin:0,padding:0,top:0,left:0,width:"100%",height:"100%"});a.appendChild(f);a===document.body&&(f.style.position="absolute",L(a.style,
{margin:0,padding:0}));var d;a!==document.body&&"function"===typeof ResizeObserver?(d=new ResizeObserver(function(){setTimeout(e)}),d.observe(a)):window.addEventListener("resize",e,!1);e();return{canvas:f,onDestroy:function(){d?d.disconnect():window.removeEventListener("resize",e);a.removeChild(f)}}}function Gb(a,b){function c(c){try{return a.getContext(c,b)}catch(f){return null}}return c("webgl")||c("experimental-webgl")||c("webgl-experimental")}function eb(a){return"string"===typeof a?a.split():
a}function fb(a){return"string"===typeof a?document.querySelector(a):a}function Hb(a){var b=a||{},c,e,f,d;a={};var q=[],n=[],v="undefined"===typeof window?1:window.devicePixelRatio,k=!1,u=function(a){},m=function(){};"string"===typeof b?c=document.querySelector(b):"object"===typeof b&&("string"===typeof b.nodeName&&"function"===typeof b.appendChild&&"function"===typeof b.getBoundingClientRect?c=b:"function"===typeof b.drawArrays||"function"===typeof b.drawElements?(d=b,f=d.canvas):("gl"in b?d=b.gl:
"canvas"in b?f=fb(b.canvas):"container"in b&&(e=fb(b.container)),"attributes"in b&&(a=b.attributes),"extensions"in b&&(q=eb(b.extensions)),"optionalExtensions"in b&&(n=eb(b.optionalExtensions)),"onDone"in b&&(u=b.onDone),"profile"in b&&(k=!!b.profile),"pixelRatio"in b&&(v=+b.pixelRatio)));c&&("canvas"===c.nodeName.toLowerCase()?f=c:e=c);if(!d){if(!f){c=Fb(e||document.body,u,v);if(!c)return null;f=c.canvas;m=c.onDestroy}void 0===a.premultipliedAlpha&&(a.premultipliedAlpha=!0);d=Gb(f,a)}return d?{gl:d,
canvas:f,container:e,extensions:q,optionalExtensions:n,pixelRatio:v,profile:k,onDone:u,onDestroy:m}:(m(),u("webgl not supported, try upgrading your browser or graphics drivers http://get.webgl.org"),null)}function Ib(a,b){function c(b){b=b.toLowerCase();var c;try{c=e[b]=a.getExtension(b)}catch(f){}return!!c}for(var e={},f=0;f<b.extensions.length;++f){var d=b.extensions[f];if(!c(d))return b.onDestroy(),b.onDone('"'+d+'" extension is not supported by the current WebGL context, try upgrading your system or a different browser'),
null}b.optionalExtensions.forEach(c);return{extensions:e,restore:function(){Object.keys(e).forEach(function(a){if(e[a]&&!c(a))throw Error("(regl): error restoring extension "+a);})}}}function R(a,b){for(var c=Array(a),e=0;e<a;++e)c[e]=b(e);return c}function gb(a){var b,c;b=(65535<a)<<4;a>>>=b;c=(255<a)<<3;a>>>=c;b|=c;c=(15<a)<<2;a>>>=c;b|=c;c=(3<a)<<1;return b|c|a>>>c>>1}function hb(){function a(a){a:{for(var b=16;268435456>=b;b*=16)if(a<=b){a=b;break a}a=0}b=c[gb(a)>>2];return 0<b.length?b.pop():
new ArrayBuffer(a)}function b(a){c[gb(a.byteLength)>>2].push(a)}var c=R(8,function(){return[]});return{alloc:a,free:b,allocType:function(b,c){var d=null;switch(b){case 5120:d=new Int8Array(a(c),0,c);break;case 5121:d=new Uint8Array(a(c),0,c);break;case 5122:d=new Int16Array(a(2*c),0,c);break;case 5123:d=new Uint16Array(a(2*c),0,c);break;case 5124:d=new Int32Array(a(4*c),0,c);break;case 5125:d=new Uint32Array(a(4*c),0,c);break;case 5126:d=new Float32Array(a(4*c),0,c);break;default:return null}return d.length!==
c?d.subarray(0,c):d},freeType:function(a){b(a.buffer)}}}function la(a){return!!a&&"object"===typeof a&&Array.isArray(a.shape)&&Array.isArray(a.stride)&&"number"===typeof a.offset&&a.shape.length===a.stride.length&&(Array.isArray(a.data)||O(a.data))}function ib(a,b,c,e,f,d){for(var q=0;q<b;++q)for(var n=a[q],v=0;v<c;++v)for(var k=n[v],u=0;u<e;++u)f[d++]=k[u]}function jb(a,b,c,e,f){for(var d=1,q=c+1;q<b.length;++q)d*=b[q];var n=b[c];if(4===b.length-c){var v=b[c+1],k=b[c+2];b=b[c+3];for(q=0;q<n;++q)ib(a[q],
v,k,b,e,f),f+=d}else for(q=0;q<n;++q)jb(a[q],b,c+1,e,f),f+=d}function Ha(a){return Ia[Object.prototype.toString.call(a)]|0}function kb(a,b){for(var c=0;c<b.length;++c)a[c]=b[c]}function lb(a,b,c,e,f,d,q){for(var n=0,v=0;v<c;++v)for(var k=0;k<e;++k)a[n++]=b[f*v+d*k+q]}function Jb(a,b,c,e){function f(b){this.id=v++;this.buffer=a.createBuffer();this.type=b;this.usage=35044;this.byteLength=0;this.dimension=1;this.dtype=5121;this.persistentData=null;c.profile&&(this.stats={size:0})}function d(b,c,l){b.byteLength=
c.byteLength;a.bufferData(b.type,c,l)}function q(a,b,c,g,h,r){a.usage=c;if(Array.isArray(b)){if(a.dtype=g||5126,0<b.length)if(Array.isArray(b[0])){h=mb(b);for(var p=g=1;p<h.length;++p)g*=h[p];a.dimension=g;b=Ua(b,h,a.dtype);d(a,b,c);r?a.persistentData=b:G.freeType(b)}else"number"===typeof b[0]?(a.dimension=h,h=G.allocType(a.dtype,b.length),kb(h,b),d(a,h,c),r?a.persistentData=h:G.freeType(h)):O(b[0])&&(a.dimension=b[0].length,a.dtype=g||Ha(b[0])||5126,b=Ua(b,[b.length,b[0].length],a.dtype),d(a,b,c),
r?a.persistentData=b:G.freeType(b))}else if(O(b))a.dtype=g||Ha(b),a.dimension=h,d(a,b,c),r&&(a.persistentData=new Uint8Array(new Uint8Array(b.buffer)));else if(la(b)){h=b.shape;var e=b.stride,p=b.offset,t=0,ma=0,f=0,k=0;1===h.length?(t=h[0],ma=1,f=e[0],k=0):2===h.length&&(t=h[0],ma=h[1],f=e[0],k=e[1]);a.dtype=g||Ha(b.data)||5126;a.dimension=ma;h=G.allocType(a.dtype,t*ma);lb(h,b.data,t,ma,f,k,p);d(a,h,c);r?a.persistentData=h:G.freeType(h)}else b instanceof ArrayBuffer&&(a.dtype=5121,a.dimension=h,
d(a,b,c),r&&(a.persistentData=new Uint8Array(new Uint8Array(b))))}function n(c){b.bufferCount--;e(c);a.deleteBuffer(c.buffer);c.buffer=null;delete k[c.id]}var v=0,k={};f.prototype.bind=function(){a.bindBuffer(this.type,this.buffer)};f.prototype.destroy=function(){n(this)};var u=[];c.profile&&(b.getTotalBufferSize=function(){var a=0;Object.keys(k).forEach(function(b){a+=k[b].stats.size});return a});return{create:function(m,e,d,g){function h(b){var e=35044,t=null,d=0,m=0,f=1;Array.isArray(b)||O(b)||
la(b)||b instanceof ArrayBuffer?t=b:"number"===typeof b?d=b|0:b&&("data"in b&&(t=b.data),"usage"in b&&(e=nb[b.usage]),"type"in b&&(m=Ja[b.type]),"dimension"in b&&(f=b.dimension|0),"length"in b&&(d=b.length|0));r.bind();t?q(r,t,e,m,f,g):(d&&a.bufferData(r.type,d,e),r.dtype=m||5121,r.usage=e,r.dimension=f,r.byteLength=d);c.profile&&(r.stats.size=r.byteLength*na[r.dtype]);return h}b.bufferCount++;var r=new f(e);k[r.id]=r;d||h(m);h._reglType="buffer";h._buffer=r;h.subdata=function(b,c){var t=(c||0)|0,
d;r.bind();if(O(b)||b instanceof ArrayBuffer)a.bufferSubData(r.type,t,b);else if(Array.isArray(b)){if(0<b.length)if("number"===typeof b[0]){var e=G.allocType(r.dtype,b.length);kb(e,b);a.bufferSubData(r.type,t,e);G.freeType(e)}else if(Array.isArray(b[0])||O(b[0]))d=mb(b),e=Ua(b,d,r.dtype),a.bufferSubData(r.type,t,e),G.freeType(e)}else if(la(b)){d=b.shape;var m=b.stride,g=e=0,f=0,y=0;1===d.length?(e=d[0],g=1,f=m[0],y=0):2===d.length&&(e=d[0],g=d[1],f=m[0],y=m[1]);d=Array.isArray(b.data)?r.dtype:Ha(b.data);
d=G.allocType(d,e*g);lb(d,b.data,e,g,f,y,b.offset);a.bufferSubData(r.type,t,d);G.freeType(d)}return h};c.profile&&(h.stats=r.stats);h.destroy=function(){n(r)};return h},createStream:function(a,b){var c=u.pop();c||(c=new f(a));c.bind();q(c,b,35040,0,1,!1);return c},destroyStream:function(a){u.push(a)},clear:function(){I(k).forEach(n);u.forEach(n)},getBuffer:function(a){return a&&a._buffer instanceof f?a._buffer:null},restore:function(){I(k).forEach(function(b){b.buffer=a.createBuffer();a.bindBuffer(b.type,
b.buffer);a.bufferData(b.type,b.persistentData||b.byteLength,b.usage)})},_initBuffer:q}}function Kb(a,b,c,e){function f(a){this.id=v++;n[this.id]=this;this.buffer=a;this.primType=4;this.type=this.vertCount=0}function d(d,e,f,g,h,r,p){d.buffer.bind();var k;e?((k=p)||O(e)&&(!la(e)||O(e.data))||(k=b.oes_element_index_uint?5125:5123),c._initBuffer(d.buffer,e,f,k,3)):(a.bufferData(34963,r,f),d.buffer.dtype=k||5121,d.buffer.usage=f,d.buffer.dimension=3,d.buffer.byteLength=r);k=p;if(!p){switch(d.buffer.dtype){case 5121:case 5120:k=
5121;break;case 5123:case 5122:k=5123;break;case 5125:case 5124:k=5125}d.buffer.dtype=k}d.type=k;e=h;0>e&&(e=d.buffer.byteLength,5123===k?e>>=1:5125===k&&(e>>=2));d.vertCount=e;e=g;0>g&&(e=4,g=d.buffer.dimension,1===g&&(e=0),2===g&&(e=1),3===g&&(e=4));d.primType=e}function q(a){e.elementsCount--;delete n[a.id];a.buffer.destroy();a.buffer=null}var n={},v=0,k={uint8:5121,uint16:5123};b.oes_element_index_uint&&(k.uint32=5125);f.prototype.bind=function(){this.buffer.bind()};var u=[];return{create:function(a,
b){function l(a){if(a)if("number"===typeof a)g(a),h.primType=4,h.vertCount=a|0,h.type=5121;else{var b=null,c=35044,e=-1,f=-1,m=0,n=0;if(Array.isArray(a)||O(a)||la(a))b=a;else if("data"in a&&(b=a.data),"usage"in a&&(c=nb[a.usage]),"primitive"in a&&(e=Ka[a.primitive]),"count"in a&&(f=a.count|0),"type"in a&&(n=k[a.type]),"length"in a)m=a.length|0;else if(m=f,5123===n||5122===n)m*=2;else if(5125===n||5124===n)m*=4;d(h,b,c,e,f,m,n)}else g(),h.primType=4,h.vertCount=0,h.type=5121;return l}var g=c.create(null,
34963,!0),h=new f(g._buffer);e.elementsCount++;l(a);l._reglType="elements";l._elements=h;l.subdata=function(a,b){g.subdata(a,b);return l};l.destroy=function(){q(h)};return l},createStream:function(a){var b=u.pop();b||(b=new f(c.create(null,34963,!0,!1)._buffer));d(b,a,35040,-1,-1,0,0);return b},destroyStream:function(a){u.push(a)},getElements:function(a){return"function"===typeof a&&a._elements instanceof f?a._elements:null},clear:function(){I(n).forEach(q)}}}function ob(a){for(var b=G.allocType(5123,
a.length),c=0;c<a.length;++c)if(isNaN(a[c]))b[c]=65535;else if(Infinity===a[c])b[c]=31744;else if(-Infinity===a[c])b[c]=64512;else{pb[0]=a[c];var e=Lb[0],f=e>>>31<<15,d=(e<<1>>>24)-127,e=e>>13&1023;b[c]=-24>d?f:-14>d?f+(e+1024>>-14-d):15<d?f+31744:f+(d+15<<10)+e}return b}function ra(a){return Array.isArray(a)||O(a)}function sa(a){return"[object "+a+"]"}function qb(a){return Array.isArray(a)&&(0===a.length||"number"===typeof a[0])}function rb(a){return Array.isArray(a)&&0!==a.length&&ra(a[0])?!0:!1}
function aa(a){return Object.prototype.toString.call(a)}function Va(a){if(!a)return!1;var b=aa(a);return 0<=Mb.indexOf(b)?!0:qb(a)||rb(a)||la(a)}function sb(a,b){36193===a.type?(a.data=ob(b),G.freeType(b)):a.data=b}function La(a,b,c,e,f,d){a="undefined"!==typeof C[a]?C[a]:U[a]*za[b];d&&(a*=6);if(f){for(e=0;1<=c;)e+=a*c*c,c/=2;return e}return a*c*e}function Nb(a,b,c,e,f,d,q){function n(){this.format=this.internalformat=6408;this.type=5121;this.flipY=this.premultiplyAlpha=this.compressed=!1;this.unpackAlignment=
1;this.colorSpace=37444;this.channels=this.height=this.width=0}function v(a,b){a.internalformat=b.internalformat;a.format=b.format;a.type=b.type;a.compressed=b.compressed;a.premultiplyAlpha=b.premultiplyAlpha;a.flipY=b.flipY;a.unpackAlignment=b.unpackAlignment;a.colorSpace=b.colorSpace;a.width=b.width;a.height=b.height;a.channels=b.channels}function k(a,b){if("object"===typeof b&&b){"premultiplyAlpha"in b&&(a.premultiplyAlpha=b.premultiplyAlpha);"flipY"in b&&(a.flipY=b.flipY);"alignment"in b&&(a.unpackAlignment=
b.alignment);"colorSpace"in b&&(a.colorSpace=Ob[b.colorSpace]);"type"in b&&(a.type=N[b.type]);var c=a.width,e=a.height,d=a.channels,f=!1;"shape"in b?(c=b.shape[0],e=b.shape[1],3===b.shape.length&&(d=b.shape[2],f=!0)):("radius"in b&&(c=e=b.radius),"width"in b&&(c=b.width),"height"in b&&(e=b.height),"channels"in b&&(d=b.channels,f=!0));a.width=c|0;a.height=e|0;a.channels=d|0;c=!1;"format"in b&&(c=b.format,e=a.internalformat=E[c],a.format=V[e],c in N&&!("type"in b)&&(a.type=N[c]),c in ga&&(a.compressed=
!0),c=!0);!f&&c?a.channels=U[a.format]:f&&!c&&a.channels!==Oa[a.format]&&(a.format=a.internalformat=Oa[a.channels])}}function u(b){a.pixelStorei(37440,b.flipY);a.pixelStorei(37441,b.premultiplyAlpha);a.pixelStorei(37443,b.colorSpace);a.pixelStorei(3317,b.unpackAlignment)}function m(){n.call(this);this.yOffset=this.xOffset=0;this.data=null;this.needsFree=!1;this.element=null;this.needsCopy=!1}function x(a,b){var c=null;Va(b)?c=b:b&&(k(a,b),"x"in b&&(a.xOffset=b.x|0),"y"in b&&(a.yOffset=b.y|0),Va(b.data)&&
(c=b.data));if(b.copy){var e=f.viewportWidth,d=f.viewportHeight;a.width=a.width||e-a.xOffset;a.height=a.height||d-a.yOffset;a.needsCopy=!0}else if(!c)a.width=a.width||1,a.height=a.height||1,a.channels=a.channels||4;else if(O(c))a.channels=a.channels||4,a.data=c,"type"in b||5121!==a.type||(a.type=Ia[Object.prototype.toString.call(c)]|0);else if(qb(c)){a.channels=a.channels||4;e=c;d=e.length;switch(a.type){case 5121:case 5123:case 5125:case 5126:d=G.allocType(a.type,d);d.set(e);a.data=d;break;case 36193:a.data=
ob(e)}a.alignment=1;a.needsFree=!0}else if(la(c)){e=c.data;Array.isArray(e)||5121!==a.type||(a.type=Ia[Object.prototype.toString.call(e)]|0);var d=c.shape,h=c.stride,y,t,g,p;3===d.length?(g=d[2],p=h[2]):p=g=1;y=d[0];t=d[1];d=h[0];h=h[1];a.alignment=1;a.width=y;a.height=t;a.channels=g;a.format=a.internalformat=Oa[g];a.needsFree=!0;y=p;c=c.offset;g=a.width;p=a.height;t=a.channels;for(var z=G.allocType(36193===a.type?5126:a.type,g*p*t),B=0,ha=0;ha<p;++ha)for(var oa=0;oa<g;++oa)for(var Wa=0;Wa<t;++Wa)z[B++]=
e[d*oa+h*ha+y*Wa+c];sb(a,z)}else if(aa(c)===Xa||aa(c)===Ya||aa(c)===ub)aa(c)===Xa||aa(c)===Ya?a.element=c:a.element=c.canvas,a.width=a.element.width,a.height=a.element.height,a.channels=4;else if(aa(c)===vb)a.element=c,a.width=c.width,a.height=c.height,a.channels=4;else if(aa(c)===wb)a.element=c,a.width=c.naturalWidth,a.height=c.naturalHeight,a.channels=4;else if(aa(c)===xb)a.element=c,a.width=c.videoWidth,a.height=c.videoHeight,a.channels=4;else if(rb(c)){e=a.width||c[0].length;d=a.height||c.length;
h=a.channels;h=ra(c[0][0])?h||c[0][0].length:h||1;y=Qa.shape(c);g=1;for(p=0;p<y.length;++p)g*=y[p];g=G.allocType(36193===a.type?5126:a.type,g);Qa.flatten(c,y,"",g);sb(a,g);a.alignment=1;a.width=e;a.height=d;a.channels=h;a.format=a.internalformat=Oa[h];a.needsFree=!0}}function l(b,c,d,h,g){var y=b.element,f=b.data,p=b.internalformat,t=b.format,k=b.type,z=b.width,B=b.height;u(b);y?a.texSubImage2D(c,g,d,h,t,k,y):b.compressed?a.compressedTexSubImage2D(c,g,d,h,p,z,B,f):b.needsCopy?(e(),a.copyTexSubImage2D(c,
g,d,h,b.xOffset,b.yOffset,z,B)):a.texSubImage2D(c,g,d,h,z,B,t,k,f)}function g(){return R.pop()||new m}function h(a){a.needsFree&&G.freeType(a.data);m.call(a);R.push(a)}function r(){n.call(this);this.genMipmaps=!1;this.mipmapHint=4352;this.mipmask=0;this.images=Array(16)}function p(a,b,c){var d=a.images[0]=g();a.mipmask=1;d.width=a.width=b;d.height=a.height=c;d.channels=a.channels=4}function P(a,b){var c=null;if(Va(b))c=a.images[0]=g(),v(c,a),x(c,b),a.mipmask=1;else if(k(a,b),Array.isArray(b.mipmap))for(var d=
b.mipmap,e=0;e<d.length;++e)c=a.images[e]=g(),v(c,a),c.width>>=e,c.height>>=e,x(c,d[e]),a.mipmask|=1<<e;else c=a.images[0]=g(),v(c,a),x(c,b),a.mipmask=1;v(a,a.images[0])}function t(b,c){for(var d=b.images,h=0;h<d.length&&d[h];++h){var g=d[h],y=c,f=h,p=g.element,t=g.data,k=g.internalformat,z=g.format,B=g.type,ha=g.width,oa=g.height;u(g);p?a.texImage2D(y,f,z,z,B,p):g.compressed?a.compressedTexImage2D(y,f,k,ha,oa,0,t):g.needsCopy?(e(),a.copyTexImage2D(y,f,z,g.xOffset,g.yOffset,ha,oa,0)):a.texImage2D(y,
f,z,ha,oa,0,z,B,t||null)}}function ma(){var a=Y.pop()||new r;n.call(a);for(var b=a.mipmask=0;16>b;++b)a.images[b]=null;return a}function ya(a){for(var b=a.images,c=0;c<b.length;++c)b[c]&&h(b[c]),b[c]=null;Y.push(a)}function w(){this.magFilter=this.minFilter=9728;this.wrapT=this.wrapS=33071;this.anisotropic=1;this.genMipmaps=!1;this.mipmapHint=4352}function H(a,b){"min"in b&&(a.minFilter=Aa[b.min],0<=Pb.indexOf(a.minFilter)&&!("faces"in b)&&(a.genMipmaps=!0));"mag"in b&&(a.magFilter=S[b.mag]);var c=
a.wrapS,d=a.wrapT;if("wrap"in b){var e=b.wrap;"string"===typeof e?c=d=ia[e]:Array.isArray(e)&&(c=ia[e[0]],d=ia[e[1]])}else"wrapS"in b&&(c=ia[b.wrapS]),"wrapT"in b&&(d=ia[b.wrapT]);a.wrapS=c;a.wrapT=d;"anisotropic"in b&&(a.anisotropic=b.anisotropic);if("mipmap"in b){c=!1;switch(typeof b.mipmap){case "string":a.mipmapHint=A[b.mipmap];c=a.genMipmaps=!0;break;case "boolean":c=a.genMipmaps=b.mipmap;break;case "object":a.genMipmaps=!1,c=!0}!c||"min"in b||(a.minFilter=9984)}}function M(c,d){a.texParameteri(d,
10241,c.minFilter);a.texParameteri(d,10240,c.magFilter);a.texParameteri(d,10242,c.wrapS);a.texParameteri(d,10243,c.wrapT);b.ext_texture_filter_anisotropic&&a.texParameteri(d,34046,c.anisotropic);c.genMipmaps&&(a.hint(33170,c.mipmapHint),a.generateMipmap(d))}function y(b){n.call(this);this.mipmask=0;this.internalformat=6408;this.id=Qb++;this.refCount=1;this.target=b;this.texture=a.createTexture();this.unit=-1;this.bindCount=0;this.texInfo=new w;q.profile&&(this.stats={size:0})}function T(b){a.activeTexture(33984);
a.bindTexture(b.target,b.texture)}function wa(){var b=W[0];b?a.bindTexture(b.target,b.texture):a.bindTexture(3553,null)}function F(b){var c=b.texture,e=b.unit,g=b.target;0<=e&&(a.activeTexture(33984+e),a.bindTexture(g,null),W[e]=null);a.deleteTexture(c);b.texture=null;b.params=null;b.pixels=null;b.refCount=0;delete ea[b.id];d.textureCount--}var A={"don't care":4352,"dont care":4352,nice:4354,fast:4353},ia={repeat:10497,clamp:33071,mirror:33648},S={nearest:9728,linear:9729},Aa=L({mipmap:9987,"nearest mipmap nearest":9984,
"linear mipmap nearest":9985,"nearest mipmap linear":9986,"linear mipmap linear":9987},S),Ob={none:0,browser:37444},N={uint8:5121,rgba4:32819,rgb565:33635,"rgb5 a1":32820},E={alpha:6406,luminance:6409,"luminance alpha":6410,rgb:6407,rgba:6408,rgba4:32854,"rgb5 a1":32855,rgb565:36194},ga={};b.ext_srgb&&(E.srgb=35904,E.srgba=35906);b.oes_texture_float&&(N.float32=N["float"]=5126);b.oes_texture_half_float&&(N.float16=N["half float"]=36193);b.webgl_depth_texture&&(L(E,{depth:6402,"depth stencil":34041}),
L(N,{uint16:5123,uint32:5125,"depth stencil":34042}));b.webgl_compressed_texture_s3tc&&L(ga,{"rgb s3tc dxt1":33776,"rgba s3tc dxt1":33777,"rgba s3tc dxt3":33778,"rgba s3tc dxt5":33779});b.webgl_compressed_texture_atc&&L(ga,{"rgb atc":35986,"rgba atc explicit alpha":35987,"rgba atc interpolated alpha":34798});b.webgl_compressed_texture_pvrtc&&L(ga,{"rgb pvrtc 4bppv1":35840,"rgb pvrtc 2bppv1":35841,"rgba pvrtc 4bppv1":35842,"rgba pvrtc 2bppv1":35843});b.webgl_compressed_texture_etc1&&(ga["rgb etc1"]=
36196);var J=Array.prototype.slice.call(a.getParameter(34467));Object.keys(ga).forEach(function(a){var b=ga[a];0<=J.indexOf(b)&&(E[a]=b)});var C=Object.keys(E);c.textureFormats=C;var ca=[];Object.keys(E).forEach(function(a){ca[E[a]]=a});var K=[];Object.keys(N).forEach(function(a){K[N[a]]=a});var Fa=[];Object.keys(S).forEach(function(a){Fa[S[a]]=a});var pa=[];Object.keys(Aa).forEach(function(a){pa[Aa[a]]=a});var qa=[];Object.keys(ia).forEach(function(a){qa[ia[a]]=a});var V=C.reduce(function(a,c){var d=
E[c];6409===d||6406===d||6409===d||6410===d||6402===d||34041===d||b.ext_srgb&&(35904===d||35906===d)?a[d]=d:32855===d||0<=c.indexOf("rgba")?a[d]=6408:a[d]=6407;return a},{}),R=[],Y=[],Qb=0,ea={},fa=c.maxTextureUnits,W=Array(fa).map(function(){return null});L(y.prototype,{bind:function(){this.bindCount+=1;var b=this.unit;if(0>b){for(var c=0;c<fa;++c){var e=W[c];if(e){if(0<e.bindCount)continue;e.unit=-1}W[c]=this;b=c;break}q.profile&&d.maxTextureUnits<b+1&&(d.maxTextureUnits=b+1);this.unit=b;a.activeTexture(33984+
b);a.bindTexture(this.target,this.texture)}return b},unbind:function(){--this.bindCount},decRef:function(){0>=--this.refCount&&F(this)}});q.profile&&(d.getTotalTextureSize=function(){var a=0;Object.keys(ea).forEach(function(b){a+=ea[b].stats.size});return a});return{create2D:function(b,c){function e(a,b){var c=f.texInfo;w.call(c);var d=ma();"number"===typeof a?"number"===typeof b?p(d,a|0,b|0):p(d,a|0,a|0):a?(H(c,a),P(d,a)):p(d,1,1);c.genMipmaps&&(d.mipmask=(d.width<<1)-1);f.mipmask=d.mipmask;v(f,
d);f.internalformat=d.internalformat;e.width=d.width;e.height=d.height;T(f);t(d,3553);M(c,3553);wa();ya(d);q.profile&&(f.stats.size=La(f.internalformat,f.type,d.width,d.height,c.genMipmaps,!1));e.format=ca[f.internalformat];e.type=K[f.type];e.mag=Fa[c.magFilter];e.min=pa[c.minFilter];e.wrapS=qa[c.wrapS];e.wrapT=qa[c.wrapT];return e}var f=new y(3553);ea[f.id]=f;d.textureCount++;e(b,c);e.subimage=function(a,b,c,d){b|=0;c|=0;d|=0;var y=g();v(y,f);y.width=0;y.height=0;x(y,a);y.width=y.width||(f.width>>
d)-b;y.height=y.height||(f.height>>d)-c;T(f);l(y,3553,b,c,d);wa();h(y);return e};e.resize=function(b,c){var d=b|0,g=c|0||d;if(d===f.width&&g===f.height)return e;e.width=f.width=d;e.height=f.height=g;T(f);for(var y=0;f.mipmask>>y;++y){var h=d>>y,z=g>>y;if(!h||!z)break;a.texImage2D(3553,y,f.format,h,z,0,f.format,f.type,null)}wa();q.profile&&(f.stats.size=La(f.internalformat,f.type,d,g,!1,!1));return e};e._reglType="texture2d";e._texture=f;q.profile&&(e.stats=f.stats);e.destroy=function(){f.decRef()};
return e},createCube:function(b,c,e,f,n,r){function m(a,b,c,d,e,f){var g,da=A.texInfo;w.call(da);for(g=0;6>g;++g)F[g]=ma();if("number"===typeof a||!a)for(a=a|0||1,g=0;6>g;++g)p(F[g],a,a);else if("object"===typeof a)if(b)P(F[0],a),P(F[1],b),P(F[2],c),P(F[3],d),P(F[4],e),P(F[5],f);else if(H(da,a),k(A,a),"faces"in a)for(a=a.faces,g=0;6>g;++g)v(F[g],A),P(F[g],a[g]);else for(g=0;6>g;++g)P(F[g],a);v(A,F[0]);A.mipmask=da.genMipmaps?(F[0].width<<1)-1:F[0].mipmask;A.internalformat=F[0].internalformat;m.width=
F[0].width;m.height=F[0].height;T(A);for(g=0;6>g;++g)t(F[g],34069+g);M(da,34067);wa();q.profile&&(A.stats.size=La(A.internalformat,A.type,m.width,m.height,da.genMipmaps,!0));m.format=ca[A.internalformat];m.type=K[A.type];m.mag=Fa[da.magFilter];m.min=pa[da.minFilter];m.wrapS=qa[da.wrapS];m.wrapT=qa[da.wrapT];for(g=0;6>g;++g)ya(F[g]);return m}var A=new y(34067);ea[A.id]=A;d.cubeCount++;var F=Array(6);m(b,c,e,f,n,r);m.subimage=function(a,b,c,d,e){c|=0;d|=0;e|=0;var f=g();v(f,A);f.width=0;f.height=0;
x(f,b);f.width=f.width||(A.width>>e)-c;f.height=f.height||(A.height>>e)-d;T(A);l(f,34069+a,c,d,e);wa();h(f);return m};m.resize=function(b){b|=0;if(b!==A.width){m.width=A.width=b;m.height=A.height=b;T(A);for(var c=0;6>c;++c)for(var d=0;A.mipmask>>d;++d)a.texImage2D(34069+c,d,A.format,b>>d,b>>d,0,A.format,A.type,null);wa();q.profile&&(A.stats.size=La(A.internalformat,A.type,m.width,m.height,!1,!0));return m}};m._reglType="textureCube";m._texture=A;q.profile&&(m.stats=A.stats);m.destroy=function(){A.decRef()};
return m},clear:function(){for(var b=0;b<fa;++b)a.activeTexture(33984+b),a.bindTexture(3553,null),W[b]=null;I(ea).forEach(F);d.cubeCount=0;d.textureCount=0},getTexture:function(a){return null},restore:function(){for(var b=0;b<fa;++b){var c=W[b];c&&(c.bindCount=0,c.unit=-1,W[b]=null)}I(ea).forEach(function(b){b.texture=a.createTexture();a.bindTexture(b.target,b.texture);for(var c=0;32>c;++c)if(0!==(b.mipmask&1<<c))if(3553===b.target)a.texImage2D(3553,c,b.internalformat,b.width>>c,b.height>>c,0,b.internalformat,
b.type,null);else for(var d=0;6>d;++d)a.texImage2D(34069+d,c,b.internalformat,b.width>>c,b.height>>c,0,b.internalformat,b.type,null);M(b.texInfo,b.target)})},refresh:function(){for(var b=0;b<fa;++b){var c=W[b];c&&(c.bindCount=0,c.unit=-1,W[b]=null);a.activeTexture(33984+b);a.bindTexture(3553,null);a.bindTexture(34067,null)}}}}function Rb(a,b,c,e,f,d){function q(a,b,c){this.target=a;this.texture=b;this.renderbuffer=c;var d=a=0;b?(a=b.width,d=b.height):c&&(a=c.width,d=c.height);this.width=a;this.height=
d}function n(a){a&&(a.texture&&a.texture._texture.decRef(),a.renderbuffer&&a.renderbuffer._renderbuffer.decRef())}function v(a,b,c){a&&(a.texture?a.texture._texture.refCount+=1:a.renderbuffer._renderbuffer.refCount+=1)}function k(b,c){c&&(c.texture?a.framebufferTexture2D(36160,b,c.target,c.texture._texture.texture,0):a.framebufferRenderbuffer(36160,b,36161,c.renderbuffer._renderbuffer.renderbuffer))}function u(a){var b=3553,c=null,d=null,e=a;"object"===typeof a&&(e=a.data,"target"in a&&(b=a.target|
0));a=e._reglType;"texture2d"===a?c=e:"textureCube"===a?c=e:"renderbuffer"===a&&(d=e,b=36161);return new q(b,c,d)}function m(a,b,c,d,g){if(c)return a=e.create2D({width:a,height:b,format:d,type:g}),a._texture.refCount=0,new q(3553,a,null);a=f.create({width:a,height:b,format:d});a._renderbuffer.refCount=0;return new q(36161,null,a)}function x(a){return a&&(a.texture||a.renderbuffer)}function l(a,b,c){a&&(a.texture?a.texture.resize(b,c):a.renderbuffer&&a.renderbuffer.resize(b,c),a.width=b,a.height=c)}
function g(){this.id=H++;M[this.id]=this;this.framebuffer=a.createFramebuffer();this.height=this.width=0;this.colorAttachments=[];this.depthStencilAttachment=this.stencilAttachment=this.depthAttachment=null}function h(a){a.colorAttachments.forEach(n);n(a.depthAttachment);n(a.stencilAttachment);n(a.depthStencilAttachment)}function r(b){a.deleteFramebuffer(b.framebuffer);b.framebuffer=null;d.framebufferCount--;delete M[b.id]}function p(b){var d;a.bindFramebuffer(36160,b.framebuffer);var e=b.colorAttachments;
for(d=0;d<e.length;++d)k(36064+d,e[d]);for(d=e.length;d<c.maxColorAttachments;++d)a.framebufferTexture2D(36160,36064+d,3553,null,0);a.framebufferTexture2D(36160,33306,3553,null,0);a.framebufferTexture2D(36160,36096,3553,null,0);a.framebufferTexture2D(36160,36128,3553,null,0);k(36096,b.depthAttachment);k(36128,b.stencilAttachment);k(33306,b.depthStencilAttachment);a.checkFramebufferStatus(36160);a.isContextLost();a.bindFramebuffer(36160,t.next?t.next.framebuffer:null);t.cur=t.next;a.getError()}function P(a,
b){function c(a,b){var d,g=0,f=0,t=!0,k=!0;d=null;var l=!0,n="rgba",r="uint8",y=1,q=null,P=null,pa=null,M=!1;if("number"===typeof a)g=a|0,f=b|0||g;else if(a){"shape"in a?(f=a.shape,g=f[0],f=f[1]):("radius"in a&&(g=f=a.radius),"width"in a&&(g=a.width),"height"in a&&(f=a.height));if("color"in a||"colors"in a)d=a.color||a.colors,Array.isArray(d);if(!d){"colorCount"in a&&(y=a.colorCount|0);"colorTexture"in a&&(l=!!a.colorTexture,n="rgba4");if("colorType"in a&&(r=a.colorType,!l))if("half float"===r||"float16"===
r)n="rgba16f";else if("float"===r||"float32"===r)n="rgba32f";"colorFormat"in a&&(n=a.colorFormat,0<=ma.indexOf(n)?l=!0:0<=ya.indexOf(n)&&(l=!1))}if("depthTexture"in a||"depthStencilTexture"in a)M=!(!a.depthTexture&&!a.depthStencilTexture);"depth"in a&&("boolean"===typeof a.depth?t=a.depth:(q=a.depth,k=!1));"stencil"in a&&("boolean"===typeof a.stencil?k=a.stencil:(P=a.stencil,t=!1));"depthStencil"in a&&("boolean"===typeof a.depthStencil?t=k=a.depthStencil:(pa=a.depthStencil,k=t=!1))}else g=f=1;var V=
null,H=null,T=null,w=null;if(Array.isArray(d))V=d.map(u);else if(d)V=[u(d)];else for(V=Array(y),d=0;d<y;++d)V[d]=m(g,f,l,n,r);g=g||V[0].width;f=f||V[0].height;q?H=u(q):t&&!k&&(H=m(g,f,M,"depth","uint32"));P?T=u(P):k&&!t&&(T=m(g,f,!1,"stencil","uint8"));pa?w=u(pa):!q&&!P&&k&&t&&(w=m(g,f,M,"depth stencil","depth stencil"));t=null;for(d=0;d<V.length;++d)v(V[d],g,f),V[d]&&V[d].texture&&(k=Za[V[d].texture._texture.format]*Ra[V[d].texture._texture.type],null===t&&(t=k));v(H,g,f);v(T,g,f);v(w,g,f);h(e);
e.width=g;e.height=f;e.colorAttachments=V;e.depthAttachment=H;e.stencilAttachment=T;e.depthStencilAttachment=w;c.color=V.map(x);c.depth=x(H);c.stencil=x(T);c.depthStencil=x(w);c.width=e.width;c.height=e.height;p(e);return c}var e=new g;d.framebufferCount++;c(a,b);return L(c,{resize:function(a,b){var d=Math.max(a|0,1),g=Math.max(b|0||d,1);if(d===e.width&&g===e.height)return c;for(var f=e.colorAttachments,h=0;h<f.length;++h)l(f[h],d,g);l(e.depthAttachment,d,g);l(e.stencilAttachment,d,g);l(e.depthStencilAttachment,
d,g);e.width=c.width=d;e.height=c.height=g;p(e);return c},_reglType:"framebuffer",_framebuffer:e,destroy:function(){r(e);h(e)},use:function(a){t.setFBO({framebuffer:c},a)}})}var t={cur:null,next:null,dirty:!1,setFBO:null},ma=["rgba"],ya=["rgba4","rgb565","rgb5 a1"];b.ext_srgb&&ya.push("srgba");b.ext_color_buffer_half_float&&ya.push("rgba16f","rgb16f");b.webgl_color_buffer_float&&ya.push("rgba32f");var w=["uint8"];b.oes_texture_half_float&&w.push("half float","float16");b.oes_texture_float&&w.push("float",
"float32");var H=0,M={};return L(t,{getFramebuffer:function(a){return"function"===typeof a&&"framebuffer"===a._reglType&&(a=a._framebuffer,a instanceof g)?a:null},create:P,createCube:function(a){function b(a){var d,g={color:null},f=0,h=null;d="rgba";var t="uint8",p=1;if("number"===typeof a)f=a|0;else if(a){"shape"in a?f=a.shape[0]:("radius"in a&&(f=a.radius|0),"width"in a?f=a.width|0:"height"in a&&(f=a.height|0));if("color"in a||"colors"in a)h=a.color||a.colors,Array.isArray(h);h||("colorCount"in
a&&(p=a.colorCount|0),"colorType"in a&&(t=a.colorType),"colorFormat"in a&&(d=a.colorFormat));"depth"in a&&(g.depth=a.depth);"stencil"in a&&(g.stencil=a.stencil);"depthStencil"in a&&(g.depthStencil=a.depthStencil)}else f=1;if(h)if(Array.isArray(h))for(a=[],d=0;d<h.length;++d)a[d]=h[d];else a=[h];else for(a=Array(p),h={radius:f,format:d,type:t},d=0;d<p;++d)a[d]=e.createCube(h);g.color=Array(a.length);for(d=0;d<a.length;++d)p=a[d],f=f||p.width,g.color[d]={target:34069,data:a[d]};for(d=0;6>d;++d){for(p=
0;p<a.length;++p)g.color[p].target=34069+d;0<d&&(g.depth=c[0].depth,g.stencil=c[0].stencil,g.depthStencil=c[0].depthStencil);if(c[d])c[d](g);else c[d]=P(g)}return L(b,{width:f,height:f,color:a})}var c=Array(6);b(a);return L(b,{faces:c,resize:function(a){var d=a|0;if(d===b.width)return b;var e=b.color;for(a=0;a<e.length;++a)e[a].resize(d);for(a=0;6>a;++a)c[a].resize(d);b.width=b.height=d;return b},_reglType:"framebufferCube",destroy:function(){c.forEach(function(a){a.destroy()})}})},clear:function(){I(M).forEach(r)},
restore:function(){t.cur=null;t.next=null;t.dirty=!0;I(M).forEach(function(b){b.framebuffer=a.createFramebuffer();p(b)})}})}function $a(){this.w=this.z=this.y=this.x=this.state=0;this.buffer=null;this.size=0;this.normalized=!1;this.type=5126;this.divisor=this.stride=this.offset=0}function Sb(a,b,c,e,f,d,q){function n(a){if(a!==r.currentVAO){var c=b.oes_vertex_array_object;a?c.bindVertexArrayOES(a.vao):c.bindVertexArrayOES(null);r.currentVAO=a}}function v(c){if(c!==r.currentVAO){if(c)c.bindAttrs();
else{for(var d=b.angle_instanced_arrays,e=0;e<l.length;++e){var g=l[e];g.buffer?(a.enableVertexAttribArray(e),g.buffer.bind(),a.vertexAttribPointer(e,g.size,g.type,g.normalized,g.stride,g.offfset),d&&g.divisor&&d.vertexAttribDivisorANGLE(e,g.divisor)):(a.disableVertexAttribArray(e),a.vertexAttrib4f(e,g.x,g.y,g.z,g.w))}q.elements?a.bindBuffer(34963,q.elements.buffer.buffer):a.bindBuffer(34963,null)}r.currentVAO=c}}function k(){I(h).forEach(function(a){a.destroy()})}function u(){this.id=++g;this.attributes=
[];this.elements=null;this.ownsElements=!1;this.offset=this.count=0;this.instances=-1;this.primitive=4;var a=b.oes_vertex_array_object;this.vao=a?a.createVertexArrayOES():null;h[this.id]=this;this.buffers=[]}function m(){b.oes_vertex_array_object&&I(h).forEach(function(a){a.refresh()})}var x=c.maxAttributes,l=Array(x);for(c=0;c<x;++c)l[c]=new $a;var g=0,h={},r={Record:$a,scope:{},state:l,currentVAO:null,targetVAO:null,restore:b.oes_vertex_array_object?m:function(){},createVAO:function(a){function b(a){var e;
Array.isArray(a)?(e=a,c.elements&&c.ownsElements&&c.elements.destroy(),c.elements=null,c.ownsElements=!1,c.offset=0,c.count=0,c.instances=-1,c.primitive=4):(a.elements?(e=a.elements,c.ownsElements?("function"===typeof e&&"elements"===e._reglType?c.elements.destroy():c.elements(e),c.ownsElements=!1):d.getElements(a.elements)?(c.elements=a.elements,c.ownsElements=!1):(c.elements=d.create(a.elements),c.ownsElements=!0)):(c.elements=null,c.ownsElements=!1),e=a.attributes,c.offset=0,c.count=-1,c.instances=
-1,c.primitive=4,c.elements&&(c.count=c.elements._elements.vertCount,c.primitive=c.elements._elements.primType),"offset"in a&&(c.offset=a.offset|0),"count"in a&&(c.count=a.count|0),"instances"in a&&(c.instances=a.instances|0),"primitive"in a&&(c.primitive=Ka[a.primitive]));a={};var g=c.attributes;g.length=e.length;for(var h=0;h<e.length;++h){var p=e[h],k=g[h]=new $a,m=p.data||p;if(Array.isArray(m)||O(m)||la(m)){var l;c.buffers[h]&&(l=c.buffers[h],O(m)&&l._buffer.byteLength>=m.byteLength?l.subdata(m):
(l.destroy(),c.buffers[h]=null));c.buffers[h]||(l=c.buffers[h]=f.create(p,34962,!1,!0));k.buffer=f.getBuffer(l);k.size=k.buffer.dimension|0;k.normalized=!1;k.type=k.buffer.dtype;k.offset=0;k.stride=0;k.divisor=0;k.state=1;a[h]=1}else f.getBuffer(p)?(k.buffer=f.getBuffer(p),k.size=k.buffer.dimension|0,k.normalized=!1,k.type=k.buffer.dtype,k.offset=0,k.stride=0,k.divisor=0,k.state=1):f.getBuffer(p.buffer)?(k.buffer=f.getBuffer(p.buffer),k.size=(+p.size||k.buffer.dimension)|0,k.normalized=!!p.normalized||
!1,k.type="type"in p?Ja[p.type]:k.buffer.dtype,k.offset=(p.offset||0)|0,k.stride=(p.stride||0)|0,k.divisor=(p.divisor||0)|0,k.state=1):"x"in p&&(k.x=+p.x||0,k.y=+p.y||0,k.z=+p.z||0,k.w=+p.w||0,k.state=2)}for(l=0;l<c.buffers.length;++l)!a[l]&&c.buffers[l]&&(c.buffers[l].destroy(),c.buffers[l]=null);c.refresh();return b}var c=new u;e.vaoCount+=1;b.destroy=function(){for(var a=0;a<c.buffers.length;++a)c.buffers[a]&&c.buffers[a].destroy();c.buffers.length=0;c.ownsElements&&(c.elements.destroy(),c.elements=
null,c.ownsElements=!1);c.destroy()};b._vao=c;b._reglType="vao";return b(a)},getVAO:function(a){return"function"===typeof a&&a._vao?a._vao:null},destroyBuffer:function(b){for(var c=0;c<l.length;++c){var d=l[c];d.buffer===b&&(a.disableVertexAttribArray(c),d.buffer=null)}},setVAO:b.oes_vertex_array_object?n:v,clear:b.oes_vertex_array_object?k:function(){}};u.prototype.bindAttrs=function(){for(var c=b.angle_instanced_arrays,e=this.attributes,g=0;g<e.length;++g){var f=e[g];f.buffer?(a.enableVertexAttribArray(g),
a.bindBuffer(34962,f.buffer.buffer),a.vertexAttribPointer(g,f.size,f.type,f.normalized,f.stride,f.offset),c&&f.divisor&&c.vertexAttribDivisorANGLE(g,f.divisor)):(a.disableVertexAttribArray(g),a.vertexAttrib4f(g,f.x,f.y,f.z,f.w))}for(c=e.length;c<x;++c)a.disableVertexAttribArray(c);(c=d.getElements(this.elements))?a.bindBuffer(34963,c.buffer.buffer):a.bindBuffer(34963,null)};u.prototype.refresh=function(){var a=b.oes_vertex_array_object;a&&(a.bindVertexArrayOES(this.vao),this.bindAttrs(),r.currentVAO=
null,a.bindVertexArrayOES(null))};u.prototype.destroy=function(){if(this.vao){var a=b.oes_vertex_array_object;this===r.currentVAO&&(r.currentVAO=null,a.bindVertexArrayOES(null));a.deleteVertexArrayOES(this.vao);this.vao=null}this.ownsElements&&(this.elements.destroy(),this.elements=null,this.ownsElements=!1);h[this.id]&&(delete h[this.id],--e.vaoCount)};return r}function Tb(a,b,c,e){function f(a,b,c,d){this.name=a;this.id=b;this.location=c;this.info=d}function d(a,b){for(var c=0;c<a.length;++c)if(a[c].id===
b.id){a[c].location=b.location;return}a.push(b)}function q(c,d,e){e=35632===c?k:u;var f=e[d];if(!f){var m=b.str(d),f=a.createShader(c);a.shaderSource(f,m);a.compileShader(f);e[d]=f}return f}function n(a,b){this.id=l++;this.fragId=a;this.vertId=b;this.program=null;this.uniforms=[];this.attributes=[];this.refCount=1;e.profile&&(this.stats={uniformsCount:0,attributesCount:0})}function v(c,h,k){var m;m=q(35632,c.fragId);var l=q(35633,c.vertId);h=c.program=a.createProgram();a.attachShader(h,m);a.attachShader(h,
l);if(k)for(m=0;m<k.length;++m)l=k[m],a.bindAttribLocation(h,l[0],l[1]);a.linkProgram(h);l=a.getProgramParameter(h,35718);e.profile&&(c.stats.uniformsCount=l);var n=c.uniforms;for(m=0;m<l;++m)if(k=a.getActiveUniform(h,m)){if(1<k.size)for(var v=0;v<k.size;++v){var u=k.name.replace("[0]","["+v+"]");d(n,new f(u,b.id(u),a.getUniformLocation(h,u),k))}v=k.name;1<k.size&&(v=v.replace("[0]",""));d(n,new f(v,b.id(v),a.getUniformLocation(h,v),k))}l=a.getProgramParameter(h,35721);e.profile&&(c.stats.attributesCount=
l);c=c.attributes;for(m=0;m<l;++m)(k=a.getActiveAttrib(h,m))&&d(c,new f(k.name,b.id(k.name),a.getAttribLocation(h,k.name),k))}var k={},u={},m={},x=[],l=0;e.profile&&(c.getMaxUniformsCount=function(){var a=0;x.forEach(function(b){b.stats.uniformsCount>a&&(a=b.stats.uniformsCount)});return a},c.getMaxAttributesCount=function(){var a=0;x.forEach(function(b){b.stats.attributesCount>a&&(a=b.stats.attributesCount)});return a});return{clear:function(){var b=a.deleteShader.bind(a);I(k).forEach(b);k={};I(u).forEach(b);
u={};x.forEach(function(b){a.deleteProgram(b.program)});x.length=0;m={};c.shaderCount=0},program:function(b,d,e,f){var l=m[d];l||(l=m[d]={});var q=l[b];if(q&&(q.refCount++,!f))return q;var w=new n(d,b);c.shaderCount++;v(w,e,f);q||(l[b]=w);x.push(w);return L(w,{destroy:function(){w.refCount--;if(0>=w.refCount){a.deleteProgram(w.program);var b=x.indexOf(w);x.splice(b,1);c.shaderCount--}0>=l[w.vertId].refCount&&(a.deleteShader(u[w.vertId]),delete u[w.vertId],delete m[w.fragId][w.vertId]);Object.keys(m[w.fragId]).length||
(a.deleteShader(k[w.fragId]),delete k[w.fragId],delete m[w.fragId])}})},restore:function(){k={};u={};for(var a=0;a<x.length;++a)v(x[a],null,x[a].attributes.map(function(a){return[a.location,a.name]}))},shader:q,frag:-1,vert:-1}}function Ub(a,b,c,e,f,d,q){function n(d){var f;f=null===b.next?5121:b.next.colorAttachments[0].texture._texture.type;var m=0,n=0,l=e.framebufferWidth,g=e.framebufferHeight,h=null;O(d)?h=d:d&&(m=d.x|0,n=d.y|0,l=(d.width||e.framebufferWidth-m)|0,g=(d.height||e.framebufferHeight-
n)|0,h=d.data||null);c();d=l*g*4;h||(5121===f?h=new Uint8Array(d):5126===f&&(h=h||new Float32Array(d)));a.pixelStorei(3333,4);a.readPixels(m,n,l,g,6408,f,h);return h}function v(a){var c;b.setFBO({framebuffer:a.framebuffer},function(){c=n(a)});return c}return function(a){return a&&"framebuffer"in a?v(a):n(a)}}function Ba(a){return Array.prototype.slice.call(a)}function Ca(a){return Ba(a).join("")}function Vb(){function a(){var a=[],b=[];return L(function(){a.push.apply(a,Ba(arguments))},{def:function(){var d=
"v"+c++;b.push(d);0<arguments.length&&(a.push(d,"="),a.push.apply(a,Ba(arguments)),a.push(";"));return d},toString:function(){return Ca([0<b.length?"var "+b.join(",")+";":"",Ca(a)])}})}function b(){function b(a,e){d(a,e,"=",c.def(a,e),";")}var c=a(),d=a(),e=c.toString,f=d.toString;return L(function(){c.apply(c,Ba(arguments))},{def:c.def,entry:c,exit:d,save:b,set:function(a,d,e){b(a,d);c(a,d,"=",e,";")},toString:function(){return e()+f()}})}var c=0,e=[],f=[],d=a(),q={};return{global:d,link:function(a){for(var b=
0;b<f.length;++b)if(f[b]===a)return e[b];b="g"+c++;e.push(b);f.push(a);return b},block:a,proc:function(a,c){function d(){var a="a"+e.length;e.push(a);return a}var e=[];c=c||0;for(var f=0;f<c;++f)d();var f=b(),x=f.toString;return q[a]=L(f,{arg:d,toString:function(){return Ca(["function(",e.join(),"){",x(),"}"])}})},scope:b,cond:function(){var a=Ca(arguments),c=b(),d=b(),e=c.toString,f=d.toString;return L(c,{then:function(){c.apply(c,Ba(arguments));return this},"else":function(){d.apply(d,Ba(arguments));
return this},toString:function(){var b=f();b&&(b="else{"+b+"}");return Ca(["if(",a,"){",e(),"}",b])}})},compile:function(){var a=['"use strict";',d,"return {"];Object.keys(q).forEach(function(b){a.push('"',b,'":',q[b].toString(),",")});a.push("}");var b=Ca(a).replace(/;/g,";\n").replace(/}/g,"}\n").replace(/{/g,"{\n");return Function.apply(null,e.concat(b)).apply(null,f)}}}function Sa(a){return Array.isArray(a)||O(a)||la(a)}function yb(a){return a.sort(function(a,c){return"viewport"===a?-1:"viewport"===
c?1:a<c?-1:1})}function J(a,b,c,e){this.thisDep=a;this.contextDep=b;this.propDep=c;this.append=e}function xa(a){return a&&!(a.thisDep||a.contextDep||a.propDep)}function w(a){return new J(!1,!1,!1,a)}function K(a,b){var c=a.type;if(0===c)return c=a.data.length,new J(!0,1<=c,2<=c,b);if(4===c)return c=a.data,new J(c.thisDep,c.contextDep,c.propDep,b);if(5===c)return new J(!1,!1,!1,b);if(6===c){for(var e=c=!1,f=!1,d=0;d<a.data.length;++d){var q=a.data[d];1===q.type?f=!0:2===q.type?e=!0:3===q.type?c=!0:
0===q.type?(c=!0,q=q.data,1<=q&&(e=!0),2<=q&&(f=!0)):4===q.type&&(c=c||q.data.thisDep,e=e||q.data.contextDep,f=f||q.data.propDep)}return new J(c,e,f,b)}return new J(3===c,2===c,1===c,b)}function Wb(a,b,c,e,f,d,q,n,v,k,u,m,x,l,g){function h(a){return a.replace(".","_")}function r(a,b,c){var d=h(a);Na.push(a);Ea[d]=ta[d]=!!c;ua[d]=b}function p(a,b,c){var d=h(a);Na.push(a);Array.isArray(c)?(ta[d]=c.slice(),Ea[d]=c.slice()):ta[d]=Ea[d]=c;va[d]=b}function P(){var a=Vb(),c=a.link,d=a.global;a.id=sa++;a.batchId=
"0";var e=c(tb),f=a.shared={props:"a0"};Object.keys(tb).forEach(function(a){f[a]=d.def(e,".",a)});var g=a.next={},da=a.current={};Object.keys(va).forEach(function(a){Array.isArray(ta[a])&&(g[a]=d.def(f.next,".",a),da[a]=d.def(f.current,".",a))});var D=a.constants={};Object.keys(Pa).forEach(function(a){D[a]=d.def(JSON.stringify(Pa[a]))});a.invoke=function(b,d){switch(d.type){case 0:var e=["this",f.context,f.props,a.batchId];return b.def(c(d.data),".call(",e.slice(0,Math.max(d.data.length+1,4)),")");
case 1:return b.def(f.props,d.data);case 2:return b.def(f.context,d.data);case 3:return b.def("this",d.data);case 4:return d.data.append(a,b),d.data.ref;case 5:return d.data.toString();case 6:return d.data.map(function(c){return a.invoke(b,c)})}};a.attribCache={};var ba={};a.scopeAttrib=function(a){a=b.id(a);if(a in ba)return ba[a];var d=k.scope[a];d||(d=k.scope[a]=new ea);return ba[a]=c(d)};return a}function t(a){var b=a["static"];a=a.dynamic;var c;if("profile"in b){var d=!!b.profile;c=w(function(a,
b){return d});c.enable=d}else if("profile"in a){var e=a.profile;c=K(e,function(a,b){return a.invoke(b,e)})}return c}function G(a,b){var c=a["static"],d=a.dynamic;if("framebuffer"in c){var e=c.framebuffer;return e?(e=n.getFramebuffer(e),w(function(a,b){var c=a.link(e),d=a.shared;b.set(d.framebuffer,".next",c);d=d.context;b.set(d,".framebufferWidth",c+".width");b.set(d,".framebufferHeight",c+".height");return c})):w(function(a,b){var c=a.shared;b.set(c.framebuffer,".next","null");c=c.context;b.set(c,
".framebufferWidth",c+".drawingBufferWidth");b.set(c,".framebufferHeight",c+".drawingBufferHeight");return"null"})}if("framebuffer"in d){var f=d.framebuffer;return K(f,function(a,b){var c=a.invoke(b,f),d=a.shared,e=d.framebuffer,c=b.def(e,".getFramebuffer(",c,")");b.set(e,".next",c);d=d.context;b.set(d,".framebufferWidth",c+"?"+c+".width:"+d+".drawingBufferWidth");b.set(d,".framebufferHeight",c+"?"+c+".height:"+d+".drawingBufferHeight");return c})}return null}function C(a,b,c){function d(a){if(a in
e){var c=e[a];a=!0;var z=c.x|0,g=c.y|0,h,da;"width"in c?h=c.width|0:a=!1;"height"in c?da=c.height|0:a=!1;return new J(!a&&b&&b.thisDep,!a&&b&&b.contextDep,!a&&b&&b.propDep,function(a,b){var d=a.shared.context,e=h;"width"in c||(e=b.def(d,".","framebufferWidth","-",z));var f=da;"height"in c||(f=b.def(d,".","framebufferHeight","-",g));return[z,g,e,f]})}if(a in f){var ha=f[a];a=K(ha,function(a,b){var c=a.invoke(b,ha),d=a.shared.context,e=b.def(c,".x|0"),f=b.def(c,".y|0"),z=b.def('"width" in ',c,"?",c,
".width|0:","(",d,".","framebufferWidth","-",e,")"),c=b.def('"height" in ',c,"?",c,".height|0:","(",d,".","framebufferHeight","-",f,")");return[e,f,z,c]});b&&(a.thisDep=a.thisDep||b.thisDep,a.contextDep=a.contextDep||b.contextDep,a.propDep=a.propDep||b.propDep);return a}return b?new J(b.thisDep,b.contextDep,b.propDep,function(a,b){var c=a.shared.context;return[0,0,b.def(c,".","framebufferWidth"),b.def(c,".","framebufferHeight")]}):null}var e=a["static"],f=a.dynamic;if(a=d("viewport")){var g=a;a=new J(a.thisDep,
a.contextDep,a.propDep,function(a,b){var c=g.append(a,b),d=a.shared.context;b.set(d,".viewportWidth",c[2]);b.set(d,".viewportHeight",c[3]);return c})}return{viewport:a,scissor_box:d("scissor.box")}}function O(a,b){var c=a["static"];if("string"===typeof c.frag&&"string"===typeof c.vert){if(0<Object.keys(b.dynamic).length)return null;var c=b["static"],d=Object.keys(c);if(0<d.length&&"number"===typeof c[d[0]]){for(var e=[],f=0;f<d.length;++f)e.push([c[d[f]]|0,d[f]]);return e}}return null}function H(a,
c,d){function e(a){if(a in f){var c=b.id(f[a]);a=w(function(){return c});a.id=c;return a}if(a in g){var d=g[a];return K(d,function(a,b){var c=a.invoke(b,d);return b.def(a.shared.strings,".id(",c,")")})}return null}var f=a["static"],g=a.dynamic,h=e("frag"),D=e("vert"),ba=null;xa(h)&&xa(D)?(ba=u.program(D.id,h.id,null,d),a=w(function(a,b){return a.link(ba)})):a=new J(h&&h.thisDep||D&&D.thisDep,h&&h.contextDep||D&&D.contextDep,h&&h.propDep||D&&D.propDep,function(a,b){var c=a.shared.shader,d;d=h?h.append(a,
b):b.def(c,".","frag");var e;e=D?D.append(a,b):b.def(c,".","vert");return b.def(c+".program("+e+","+d+")")});return{frag:h,vert:D,progVar:a,program:ba}}function M(a,b){function c(a,b){if(a in e){var d=e[a]|0;b?g.offset=d:g.instances=d;return w(function(a,c){b&&(a.OFFSET=d);return d})}if(a in f){var z=f[a];return K(z,function(a,c){var d=a.invoke(c,z);b&&(a.OFFSET=d);return d})}if(b){if(ba)return w(function(a,b){return a.OFFSET=0});if(h)return new J(D.thisDep,D.contextDep,D.propDep,function(a,b){return b.def(a.shared.vao+
".currentVAO?"+a.shared.vao+".currentVAO.offset:0")})}else if(h)return new J(D.thisDep,D.contextDep,D.propDep,function(a,b){return b.def(a.shared.vao+".currentVAO?"+a.shared.vao+".currentVAO.instances:-1")});return null}var e=a["static"],f=a.dynamic,g={},h=!1,D=function(){if("vao"in e){var a=e.vao;null!==a&&null===k.getVAO(a)&&(a=k.createVAO(a));h=!0;g.vao=a;return w(function(b){var c=k.getVAO(a);return c?b.link(c):"null"})}if("vao"in f){h=!0;var b=f.vao;return K(b,function(a,c){var d=a.invoke(c,
b);return c.def(a.shared.vao+".getVAO("+d+")")})}return null}(),ba=!1,X=function(){if("elements"in e){var a=e.elements;g.elements=a;if(Sa(a)){var b=g.elements=d.create(a,!0),a=d.getElements(b);ba=!0}else a&&(a=d.getElements(a),ba=!0);b=w(function(b,c){if(a){var d=b.link(a);return b.ELEMENTS=d}return b.ELEMENTS=null});b.value=a;return b}if("elements"in f){ba=!0;var c=f.elements;return K(c,function(a,b){var d=a.shared,e=d.isBufferArgs,d=d.elements,f=a.invoke(b,c),z=b.def("null"),e=b.def(e,"(",f,")"),
f=a.cond(e).then(z,"=",d,".createStream(",f,");")["else"](z,"=",d,".getElements(",f,");");b.entry(f);b.exit(a.cond(e).then(d,".destroyStream(",z,");"));return a.ELEMENTS=z})}return h?new J(D.thisDep,D.contextDep,D.propDep,function(a,b){return b.def(a.shared.vao+".currentVAO?"+a.shared.elements+".getElements("+a.shared.vao+".currentVAO.elements):null")}):null}(),ja=c("offset",!0),m=function(){if("primitive"in e){var a=e.primitive;g.primitive=a;return w(function(b,c){return Ka[a]})}if("primitive"in
f){var b=f.primitive;return K(b,function(a,c){var d=a.constants.primTypes,e=a.invoke(c,b);return c.def(d,"[",e,"]")})}return ba?xa(X)?X.value?w(function(a,b){return b.def(a.ELEMENTS,".primType")}):w(function(){return 4}):new J(X.thisDep,X.contextDep,X.propDep,function(a,b){var c=a.ELEMENTS;return b.def(c,"?",c,".primType:",4)}):h?new J(D.thisDep,D.contextDep,D.propDep,function(a,b){return b.def(a.shared.vao+".currentVAO?"+a.shared.vao+".currentVAO.primitive:4")}):null}(),l=function(){if("count"in
e){var a=e.count|0;g.count=a;return w(function(){return a})}if("count"in f){var b=f.count;return K(b,function(a,c){return a.invoke(c,b)})}return ba?xa(X)?X?ja?new J(ja.thisDep,ja.contextDep,ja.propDep,function(a,b){return b.def(a.ELEMENTS,".vertCount-",a.OFFSET)}):w(function(a,b){return b.def(a.ELEMENTS,".vertCount")}):w(function(){return-1}):new J(X.thisDep||ja.thisDep,X.contextDep||ja.contextDep,X.propDep||ja.propDep,function(a,b){var c=a.ELEMENTS;return a.OFFSET?b.def(c,"?",c,".vertCount-",a.OFFSET,
":-1"):b.def(c,"?",c,".vertCount:-1")}):h?new J(D.thisDep,D.contextDep,D.propDep,function(a,b){return b.def(a.shared.vao,".currentVAO?",a.shared.vao,".currentVAO.count:-1")}):null}(),p=c("instances",!1);return{elements:X,primitive:m,count:l,instances:p,offset:ja,vao:D,vaoActive:h,elementsActive:ba,"static":g}}function y(a,b){var c=a["static"],d=a.dynamic,e={};Na.forEach(function(a){function b(z,g){if(a in c){var B=z(c[a]);e[f]=w(function(){return B})}else if(a in d){var h=d[a];e[f]=K(h,function(a,
b){return g(a,b,a.invoke(b,h))})}}var f=h(a);switch(a){case "cull.enable":case "blend.enable":case "dither":case "stencil.enable":case "depth.enable":case "scissor.enable":case "polygonOffset.enable":case "sample.alpha":case "sample.enable":case "depth.mask":return b(function(a){return a},function(a,b,c){return c});case "depth.func":return b(function(a){return ab[a]},function(a,b,c){return b.def(a.constants.compareFuncs,"[",c,"]")});case "depth.range":return b(function(a){return a},function(a,b,c){a=
b.def("+",c,"[0]");b=b.def("+",c,"[1]");return[a,b]});case "blend.func":return b(function(a){return[Ga["srcRGB"in a?a.srcRGB:a.src],Ga["dstRGB"in a?a.dstRGB:a.dst],Ga["srcAlpha"in a?a.srcAlpha:a.src],Ga["dstAlpha"in a?a.dstAlpha:a.dst]]},function(a,b,c){function d(a,e){return b.def('"',a,e,'" in ',c,"?",c,".",a,e,":",c,".",a)}a=a.constants.blendFuncs;var e=d("src","RGB"),f=d("dst","RGB"),e=b.def(a,"[",e,"]"),z=b.def(a,"[",d("src","Alpha"),"]"),f=b.def(a,"[",f,"]");a=b.def(a,"[",d("dst","Alpha"),"]");
return[e,f,z,a]});case "blend.equation":return b(function(a){if("string"===typeof a)return[fa[a],fa[a]];if("object"===typeof a)return[fa[a.rgb],fa[a.alpha]]},function(a,b,c){var d=a.constants.blendEquations,e=b.def(),f=b.def();a=a.cond("typeof ",c,'==="string"');a.then(e,"=",f,"=",d,"[",c,"];");a["else"](e,"=",d,"[",c,".rgb];",f,"=",d,"[",c,".alpha];");b(a);return[e,f]});case "blend.color":return b(function(a){return R(4,function(b){return+a[b]})},function(a,b,c){return R(4,function(a){return b.def("+",
c,"[",a,"]")})});case "stencil.mask":return b(function(a){return a|0},function(a,b,c){return b.def(c,"|0")});case "stencil.func":return b(function(a){return[ab[a.cmp||"keep"],a.ref||0,"mask"in a?a.mask:-1]},function(a,b,c){a=b.def('"cmp" in ',c,"?",a.constants.compareFuncs,"[",c,".cmp]",":",7680);var d=b.def(c,".ref|0");b=b.def('"mask" in ',c,"?",c,".mask|0:-1");return[a,d,b]});case "stencil.opFront":case "stencil.opBack":return b(function(b){return["stencil.opBack"===a?1029:1028,Ta[b.fail||"keep"],
Ta[b.zfail||"keep"],Ta[b.zpass||"keep"]]},function(b,c,d){function e(a){return c.def('"',a,'" in ',d,"?",f,"[",d,".",a,"]:",7680)}var f=b.constants.stencilOps;return["stencil.opBack"===a?1029:1028,e("fail"),e("zfail"),e("zpass")]});case "polygonOffset.offset":return b(function(a){return[a.factor|0,a.units|0]},function(a,b,c){a=b.def(c,".factor|0");b=b.def(c,".units|0");return[a,b]});case "cull.face":return b(function(a){var b=0;"front"===a?b=1028:"back"===a&&(b=1029);return b},function(a,b,c){return b.def(c,
'==="front"?',1028,":",1029)});case "lineWidth":return b(function(a){return a},function(a,b,c){return c});case "frontFace":return b(function(a){return zb[a]},function(a,b,c){return b.def(c+'==="cw"?2304:2305')});case "colorMask":return b(function(a){return a.map(function(a){return!!a})},function(a,b,c){return R(4,function(a){return"!!"+c+"["+a+"]"})});case "sample.coverage":return b(function(a){return["value"in a?a.value:1,!!a.invert]},function(a,b,c){a=b.def('"value" in ',c,"?+",c,".value:1");b=
b.def("!!",c,".invert");return[a,b]})}});return e}function T(a,b){var c=a["static"],d=a.dynamic,e={};Object.keys(c).forEach(function(a){var b=c[a],d;if("number"===typeof b||"boolean"===typeof b)d=w(function(){return b});else if("function"===typeof b){var f=b._reglType;if("texture2d"===f||"textureCube"===f)d=w(function(a){return a.link(b)});else if("framebuffer"===f||"framebufferCube"===f)d=w(function(a){return a.link(b.color[0])})}else ra(b)&&(d=w(function(a){return a.global.def("[",R(b.length,function(a){return b[a]}),
"]")}));d.value=b;e[a]=d});Object.keys(d).forEach(function(a){var b=d[a];e[a]=K(b,function(a,c){return a.invoke(c,b)})});return e}function wa(a,c){var d=a["static"],e=a.dynamic,g={};Object.keys(d).forEach(function(a){var c=d[a],e=b.id(a),z=new ea;if(Sa(c))z.state=1,z.buffer=f.getBuffer(f.create(c,34962,!1,!0)),z.type=0;else{var B=f.getBuffer(c);if(B)z.state=1,z.buffer=B,z.type=0;else if("constant"in c){var h=c.constant;z.buffer="null";z.state=2;"number"===typeof h?z.x=h:Da.forEach(function(a,b){b<
h.length&&(z[a]=h[b])})}else{var B=Sa(c.buffer)?f.getBuffer(f.create(c.buffer,34962,!1,!0)):f.getBuffer(c.buffer),k=c.offset|0,m=c.stride|0,l=c.size|0,oa=!!c.normalized,p=0;"type"in c&&(p=Ja[c.type]);c=c.divisor|0;z.buffer=B;z.state=1;z.size=l;z.normalized=oa;z.type=p||B.dtype;z.offset=k;z.stride=m;z.divisor=c}}g[a]=w(function(a,b){var c=a.attribCache;if(e in c)return c[e];var d={isStream:!1};Object.keys(z).forEach(function(a){d[a]=z[a]});z.buffer&&(d.buffer=a.link(z.buffer),d.type=d.type||d.buffer+
".dtype");return c[e]=d})});Object.keys(e).forEach(function(a){var b=e[a];g[a]=K(b,function(a,c){function d(a){c(B[a],"=",e,".",a,"|0;")}var e=a.invoke(c,b),f=a.shared,z=a.constants,g=f.isBufferArgs,f=f.buffer,B={isStream:c.def(!1)},h=new ea;h.state=1;Object.keys(h).forEach(function(a){B[a]=c.def(""+h[a])});var k=B.buffer,m=B.type;c("if(",g,"(",e,")){",B.isStream,"=true;",k,"=",f,".createStream(",34962,",",e,");",m,"=",k,".dtype;","}else{",k,"=",f,".getBuffer(",e,");","if(",k,"){",m,"=",k,".dtype;",
'}else if("constant" in ',e,"){",B.state,"=",2,";","if(typeof "+e+'.constant === "number"){',B[Da[0]],"=",e,".constant;",Da.slice(1).map(function(a){return B[a]}).join("="),"=0;","}else{",Da.map(function(a,b){return B[a]+"="+e+".constant.length>"+b+"?"+e+".constant["+b+"]:0;"}).join(""),"}}else{","if(",g,"(",e,".buffer)){",k,"=",f,".createStream(",34962,",",e,".buffer);","}else{",k,"=",f,".getBuffer(",e,".buffer);","}",m,'="type" in ',e,"?",z.glTypes,"[",e,".type]:",k,".dtype;",B.normalized,"=!!",
e,".normalized;");d("size");d("offset");d("stride");d("divisor");c("}}");c.exit("if(",B.isStream,"){",f,".destroyStream(",k,");","}");return B})});return g}function F(a){var b=a["static"],c=a.dynamic,d={};Object.keys(b).forEach(function(a){var c=b[a];d[a]=w(function(a,b){return"number"===typeof c||"boolean"===typeof c?""+c:a.link(c)})});Object.keys(c).forEach(function(a){var b=c[a];d[a]=K(b,function(a,c){return a.invoke(c,b)})});return d}function A(a,b,d,e,f){function g(a){var b=p[a];b&&(ja[a]=b)}
var m=O(a,b),l=G(a,f),p=C(a,l,f),X=M(a,f),ja=y(a,f),q=H(a,f,m);g("viewport");g(h("scissor.box"));var n=0<Object.keys(ja).length,l={framebuffer:l,draw:X,shader:q,state:ja,dirty:n,scopeVAO:null,drawVAO:null,useVAO:!1,attributes:{}};l.profile=t(a,f);l.uniforms=T(d,f);l.drawVAO=l.scopeVAO=X.vao;if(!l.drawVAO&&q.program&&!m&&c.angle_instanced_arrays&&X["static"].elements){var r=!0;a=q.program.attributes.map(function(a){a=b["static"][a];r=r&&!!a;return a});if(r&&0<a.length){var u=k.getVAO(k.createVAO({attributes:a,
elements:X["static"].elements}));l.drawVAO=new J(null,null,null,function(a,b){return a.link(u)});l.useVAO=!0}}m?l.useVAO=!0:l.attributes=wa(b,f);l.context=F(e,f);return l}function ia(a,b,c){var d=a.shared.context,e=a.scope();Object.keys(c).forEach(function(f){b.save(d,"."+f);var g=c[f].append(a,b);Array.isArray(g)?e(d,".",f,"=[",g.join(),"];"):e(d,".",f,"=",g,";")});b(e)}function S(a,b,c,d){var e=a.shared,f=e.gl,g=e.framebuffer,h;Ma&&(h=b.def(e.extensions,".webgl_draw_buffers"));var k=a.constants,
e=k.drawBuffer,k=k.backBuffer;a=c?c.append(a,b):b.def(g,".next");d||b("if(",a,"!==",g,".cur){");b("if(",a,"){",f,".bindFramebuffer(",36160,",",a,".framebuffer);");Ma&&b(h,".drawBuffersWEBGL(",e,"[",a,".colorAttachments.length]);");b("}else{",f,".bindFramebuffer(",36160,",null);");Ma&&b(h,".drawBuffersWEBGL(",k,");");b("}",g,".cur=",a,";");d||b("}")}function Aa(a,b,c){var d=a.shared,e=d.gl,f=a.current,g=a.next,k=d.current,l=d.next,m=a.cond(k,".dirty");Na.forEach(function(b){b=h(b);if(!(b in c.state)){var d,
B;if(b in g){d=g[b];B=f[b];var p=R(ta[b].length,function(a){return m.def(d,"[",a,"]")});m(a.cond(p.map(function(a,b){return a+"!=="+B+"["+b+"]"}).join("||")).then(e,".",va[b],"(",p,");",p.map(function(a,b){return B+"["+b+"]="+a}).join(";"),";"))}else d=m.def(l,".",b),p=a.cond(d,"!==",k,".",b),m(p),b in ua?p(a.cond(d).then(e,".enable(",ua[b],");")["else"](e,".disable(",ua[b],");"),k,".",b,"=",d,";"):p(e,".",va[b],"(",d,");",k,".",b,"=",d,";")}});0===Object.keys(c.state).length&&m(k,".dirty=false;");
b(m)}function I(a,b,c,d){var e=a.shared,f=a.current,g=e.current,h=e.gl;yb(Object.keys(c)).forEach(function(e){var k=c[e];if(!d||d(k)){var m=k.append(a,b);if(ua[e]){var l=ua[e];xa(k)?m?b(h,".enable(",l,");"):b(h,".disable(",l,");"):b(a.cond(m).then(h,".enable(",l,");")["else"](h,".disable(",l,");"));b(g,".",e,"=",m,";")}else if(ra(m)){var p=f[e];b(h,".",va[e],"(",m,");",m.map(function(a,b){return p+"["+b+"]="+a}).join(";"),";")}else b(h,".",va[e],"(",m,");",g,".",e,"=",m,";")}})}function N(a,b){W&&
(a.instancing=b.def(a.shared.extensions,".angle_instanced_arrays"))}function E(a,b,c,d,e){function f(){return"undefined"===typeof performance?"Date.now()":"performance.now()"}function g(a){r=b.def();a(r,"=",f(),";");"string"===typeof e?a(p,".count+=",e,";"):a(p,".count++;");l&&(d?(u=b.def(),a(u,"=",n,".getNumPendingQueries();")):a(n,".beginQuery(",p,");"))}function h(a){a(p,".cpuTime+=",f(),"-",r,";");l&&(d?a(n,".pushScopeStats(",u,",",n,".getNumPendingQueries(),",p,");"):a(n,".endQuery();"))}function k(a){var c=
b.def(q,".profile");b(q,".profile=",a,";");b.exit(q,".profile=",c,";")}var m=a.shared,p=a.stats,q=m.current,n=m.timer;c=c.profile;var r,u;if(c){if(xa(c)){c.enable?(g(b),h(b.exit),k("true")):k("false");return}c=c.append(a,b);k(c)}else c=b.def(q,".profile");m=a.block();g(m);b("if(",c,"){",m,"}");a=a.block();h(a);b.exit("if(",c,"){",a,"}")}function ga(a,b,c,d,e){function f(a){switch(a){case 35664:case 35667:case 35671:return 2;case 35665:case 35668:case 35672:return 3;case 35666:case 35669:case 35673:return 4;
default:return 1}}function g(c,d,e){function f(){b("if(!",p,".buffer){",m,".enableVertexAttribArray(",l,");}");var c=e.type,g;g=e.size?b.def(e.size,"||",d):d;b("if(",p,".type!==",c,"||",p,".size!==",g,"||",n.map(function(a){return p+"."+a+"!=="+e[a]}).join("||"),"){",m,".bindBuffer(",34962,",",ha,".buffer);",m,".vertexAttribPointer(",[l,g,c,e.normalized,e.stride,e.offset],");",p,".type=",c,";",p,".size=",g,";",n.map(function(a){return p+"."+a+"="+e[a]+";"}).join(""),"}");W&&(c=e.divisor,b("if(",p,
".divisor!==",c,"){",a.instancing,".vertexAttribDivisorANGLE(",[l,c],");",p,".divisor=",c,";}"))}function k(){b("if(",p,".buffer){",m,".disableVertexAttribArray(",l,");",p,".buffer=null;","}if(",Da.map(function(a,b){return p+"."+a+"!=="+q[b]}).join("||"),"){",m,".vertexAttrib4f(",l,",",q,");",Da.map(function(a,b){return p+"."+a+"="+q[b]+";"}).join(""),"}")}var m=h.gl,l=b.def(c,".location"),p=b.def(h.attributes,"[",l,"]");c=e.state;var ha=e.buffer,q=[e.x,e.y,e.z,e.w],n=["buffer","normalized","offset",
"stride"];1===c?f():2===c?k():(b("if(",c,"===",1,"){"),f(),b("}else{"),k(),b("}"))}var h=a.shared;d.forEach(function(d){var h=d.name,k=c.attributes[h],m;if(k){if(!e(k))return;m=k.append(a,b)}else{if(!e(Ab))return;var l=a.scopeAttrib(h);m={};Object.keys(new ea).forEach(function(a){m[a]=b.def(l,".",a)})}g(a.link(d),f(d.info.type),m)})}function Q(a,c,d,e,f,g){for(var h=a.shared,k=h.gl,m={},l,p=0;p<e.length;++p){var q=e[p],n=q.name,r=q.info.type,u=q.info.size,t=d.uniforms[n];if(1<u){if(!t)continue;var v=
n.replace("[0]","");if(m[v])continue;m[v]=1}var q=a.link(q)+".location",x;if(t){if(!f(t))continue;if(xa(t)){n=t.value;if(35678===r||35680===r)r=a.link(n._texture||n.color[0]._texture),c(k,".uniform1i(",q,",",r+".bind());"),c.exit(r,".unbind();");else if(35674===r||35675===r||35676===r)u=a.global.def("new Float32Array(["+Array.prototype.slice.call(n)+"])"),n=2,35675===r?n=3:35676===r&&(n=4),c(k,".uniformMatrix",n,"fv(",q,",false,",u,");");else{switch(r){case 5126:l="1f";break;case 35664:l="2f";break;
case 35665:l="3f";break;case 35666:l="4f";break;case 35670:l="1i";break;case 5124:l="1i";break;case 35671:l="2i";break;case 35667:l="2i";break;case 35672:l="3i";break;case 35668:l="3i";break;case 35673:l="4i";break;case 35669:l="4i"}1<u?(l+="v",n=a.global.def("["+Array.prototype.slice.call(n)+"]")):n=ra(n)?Array.prototype.slice.call(n):n;c(k,".uniform",l,"(",q,",",n,");")}continue}else x=t.append(a,c)}else{if(!f(Ab))continue;x=c.def(h.uniforms,"[",b.id(n),"]")}35678===r?c("if(",x,"&&",x,'._reglType==="framebuffer"){',
x,"=",x,".color[0];","}"):35680===r&&c("if(",x,"&&",x,'._reglType==="framebufferCube"){',x,"=",x,".color[0];","}");n=1;switch(r){case 35678:case 35680:r=c.def(x,"._texture");c(k,".uniform1i(",q,",",r,".bind());");c.exit(r,".unbind();");continue;case 5124:case 35670:l="1i";break;case 35667:case 35671:l="2i";n=2;break;case 35668:case 35672:l="3i";n=3;break;case 35669:case 35673:l="4i";n=4;break;case 5126:l="1f";break;case 35664:l="2f";n=2;break;case 35665:l="3f";n=3;break;case 35666:l="4f";n=4;break;
case 35674:l="Matrix2fv";break;case 35675:l="Matrix3fv";break;case 35676:l="Matrix4fv"}-1===l.indexOf("Matrix")&&1<u&&(l+="v",n=1);if("M"===l.charAt(0)){c(k,".uniform",l,"(",q,",");var q=Math.pow(r-35674+2,2),y=a.global.def("new Float32Array(",q,")");Array.isArray(x)?c("false,(",R(q,function(a){return y+"["+a+"]="+x[a]}),",",y,")"):c("false,(Array.isArray(",x,")||",x," instanceof Float32Array)?",x,":(",R(q,function(a){return y+"["+a+"]="+x+"["+a+"]"}),",",y,")");c(");")}else{if(1<n){for(var r=[],
w=[],u=0;u<n;++u)Array.isArray(x)?w.push(x[u]):w.push(c.def(x+"["+u+"]")),g&&r.push(c.def());g&&c("if(!",a.batchId,"||",r.map(function(a,b){return a+"!=="+w[b]}).join("||"),"){",r.map(function(a,b){return a+"="+w[b]+";"}).join(""));c(k,".uniform",l,"(",q,",",w.join(","),");")}else g&&(r=c.def(),c("if(!",a.batchId,"||",r,"!==",x,"){",r,"=",x,";")),c(k,".uniform",l,"(",q,",",x,");");g&&c("}")}}}function U(a,b,c,d){function e(f){var g=m[f];return g?g.contextDep&&d.contextDynamic||g.propDep?g.append(a,
c):g.append(a,b):b.def(k,".",f)}function f(){function a(){c(t,".drawElementsInstancedANGLE(",[n,r,x,q+"<<(("+x+"-5121)>>1)",u],");")}function b(){c(t,".drawArraysInstancedANGLE(",[n,q,r,u],");")}p&&"null"!==p?v?a():(c("if(",p,"){"),a(),c("}else{"),b(),c("}")):b()}function g(){function a(){c(l+".drawElements("+[n,r,x,q+"<<(("+x+"-5121)>>1)"]+");")}function b(){c(l+".drawArrays("+[n,q,r]+");")}p&&"null"!==p?v?a():(c("if(",p,"){"),a(),c("}else{"),b(),c("}")):b()}var h=a.shared,l=h.gl,k=h.draw,m=d.draw,
p=function(){var e=m.elements,f=b;if(e){if(e.contextDep&&d.contextDynamic||e.propDep)f=c;e=e.append(a,f);m.elementsActive&&f("if("+e+")"+l+".bindBuffer(34963,"+e+".buffer.buffer);")}else e=f.def(),f(e,"=",k,".","elements",";","if(",e,"){",l,".bindBuffer(",34963,",",e,".buffer.buffer);}","else if(",h.vao,".currentVAO){",e,"=",a.shared.elements+".getElements("+h.vao,".currentVAO.elements);",na?"":"if("+e+")"+l+".bindBuffer(34963,"+e+".buffer.buffer);","}");return e}(),n=e("primitive"),q=e("offset"),
r=function(){var e=m.count,f=b;if(e){if(e.contextDep&&d.contextDynamic||e.propDep)f=c;e=e.append(a,f)}else e=f.def(k,".","count");return e}();if("number"===typeof r){if(0===r)return}else c("if(",r,"){"),c.exit("}");var u,t;W&&(u=e("instances"),t=a.instancing);var x=p+".type",v=m.elements&&xa(m.elements)&&!m.vaoActive;W&&("number"!==typeof u||0<=u)?"string"===typeof u?(c("if(",u,">0){"),f(),c("}else if(",u,"<0){"),g(),c("}")):f():g()}function ca(a,b,c,d,e){b=P();e=b.proc("body",e);W&&(b.instancing=
e.def(b.shared.extensions,".angle_instanced_arrays"));a(b,e,c,d);return b.compile().body}function Z(a,b,c,d){N(a,b);c.useVAO?c.drawVAO?b(a.shared.vao,".setVAO(",c.drawVAO.append(a,b),");"):b(a.shared.vao,".setVAO(",a.shared.vao,".targetVAO);"):(b(a.shared.vao,".setVAO(null);"),ga(a,b,c,d.attributes,function(){return!0}));Q(a,b,c,d.uniforms,function(){return!0},!1);U(a,b,b,c)}function Fa(a,b){var c=a.proc("draw",1);N(a,c);ia(a,c,b.context);S(a,c,b.framebuffer);Aa(a,c,b);I(a,c,b.state);E(a,c,b,!1,!0);
var d=b.shader.progVar.append(a,c);c(a.shared.gl,".useProgram(",d,".program);");if(b.shader.program)Z(a,c,b,b.shader.program);else{c(a.shared.vao,".setVAO(null);");var e=a.global.def("{}"),f=c.def(d,".id"),g=c.def(e,"[",f,"]");c(a.cond(g).then(g,".call(this,a0);")["else"](g,"=",e,"[",f,"]=",a.link(function(c){return ca(Z,a,b,c,1)}),"(",d,");",g,".call(this,a0);"))}0<Object.keys(b.state).length&&c(a.shared.current,".dirty=true;");a.shared.vao&&c(a.shared.vao,".setVAO(null);")}function pa(a,b,c,d){function e(){return!0}
a.batchId="a1";N(a,b);ga(a,b,c,d.attributes,e);Q(a,b,c,d.uniforms,e,!1);U(a,b,b,c)}function qa(a,b,c,d){function e(a){return a.contextDep&&g||a.propDep}function f(a){return!e(a)}N(a,b);var g=c.contextDep,h=b.def(),l=b.def();a.shared.props=l;a.batchId=h;var k=a.scope(),m=a.scope();b(k.entry,"for(",h,"=0;",h,"<","a1",";++",h,"){",l,"=","a0","[",h,"];",m,"}",k.exit);c.needsContext&&ia(a,m,c.context);c.needsFramebuffer&&S(a,m,c.framebuffer);I(a,m,c.state,e);c.profile&&e(c.profile)&&E(a,m,c,!1,!0);d?(c.useVAO?
c.drawVAO?e(c.drawVAO)?m(a.shared.vao,".setVAO(",c.drawVAO.append(a,m),");"):k(a.shared.vao,".setVAO(",c.drawVAO.append(a,k),");"):k(a.shared.vao,".setVAO(",a.shared.vao,".targetVAO);"):(k(a.shared.vao,".setVAO(null);"),ga(a,k,c,d.attributes,f),ga(a,m,c,d.attributes,e)),Q(a,k,c,d.uniforms,f,!1),Q(a,m,c,d.uniforms,e,!0),U(a,k,m,c)):(b=a.global.def("{}"),d=c.shader.progVar.append(a,m),l=m.def(d,".id"),k=m.def(b,"[",l,"]"),m(a.shared.gl,".useProgram(",d,".program);","if(!",k,"){",k,"=",b,"[",l,"]=",
a.link(function(b){return ca(pa,a,c,b,2)}),"(",d,");}",k,".call(this,a0[",h,"],",h,");"))}function V(a,b){function c(a){return a.contextDep&&e||a.propDep}var d=a.proc("batch",2);a.batchId="0";N(a,d);var e=!1,f=!0;Object.keys(b.context).forEach(function(a){e=e||b.context[a].propDep});e||(ia(a,d,b.context),f=!1);var g=b.framebuffer,h=!1;g?(g.propDep?e=h=!0:g.contextDep&&e&&(h=!0),h||S(a,d,g)):S(a,d,null);b.state.viewport&&b.state.viewport.propDep&&(e=!0);Aa(a,d,b);I(a,d,b.state,function(a){return!c(a)});
b.profile&&c(b.profile)||E(a,d,b,!1,"a1");b.contextDep=e;b.needsContext=f;b.needsFramebuffer=h;f=b.shader.progVar;if(f.contextDep&&e||f.propDep)qa(a,d,b,null);else if(f=f.append(a,d),d(a.shared.gl,".useProgram(",f,".program);"),b.shader.program)qa(a,d,b,b.shader.program);else{d(a.shared.vao,".setVAO(null);");var g=a.global.def("{}"),h=d.def(f,".id"),l=d.def(g,"[",h,"]");d(a.cond(l).then(l,".call(this,a0,a1);")["else"](l,"=",g,"[",h,"]=",a.link(function(c){return ca(qa,a,b,c,2)}),"(",f,");",l,".call(this,a0,a1);"))}0<
Object.keys(b.state).length&&d(a.shared.current,".dirty=true;");a.shared.vao&&d(a.shared.vao,".setVAO(null);")}function ka(a,c){function d(b){var g=c.shader[b];g&&e.set(f.shader,"."+b,g.append(a,e))}var e=a.proc("scope",3);a.batchId="a2";var f=a.shared,g=f.current;ia(a,e,c.context);c.framebuffer&&c.framebuffer.append(a,e);yb(Object.keys(c.state)).forEach(function(b){var d=c.state[b].append(a,e);ra(d)?d.forEach(function(c,d){e.set(a.next[b],"["+d+"]",c)}):e.set(f.next,"."+b,d)});E(a,e,c,!0,!0);["elements",
"offset","count","instances","primitive"].forEach(function(b){var d=c.draw[b];d&&e.set(f.draw,"."+b,""+d.append(a,e))});Object.keys(c.uniforms).forEach(function(d){var g=c.uniforms[d].append(a,e);Array.isArray(g)&&(g="["+g.join()+"]");e.set(f.uniforms,"["+b.id(d)+"]",g)});Object.keys(c.attributes).forEach(function(b){var d=c.attributes[b].append(a,e),f=a.scopeAttrib(b);Object.keys(new ea).forEach(function(a){e.set(f,"."+a,d[a])})});c.scopeVAO&&e.set(f.vao,".targetVAO",c.scopeVAO.append(a,e));d("vert");
d("frag");0<Object.keys(c.state).length&&(e(g,".dirty=true;"),e.exit(g,".dirty=true;"));e("a1(",a.shared.context,",a0,",a.batchId,");")}function la(a){if("object"===typeof a&&!ra(a)){for(var b=Object.keys(a),c=0;c<b.length;++c)if(Y.isDynamic(a[b[c]]))return!0;return!1}}function aa(a,b,c){function d(a,b){g.forEach(function(c){var d=e[c];Y.isDynamic(d)&&(d=a.invoke(b,d),b(m,".",c,"=",d,";"))})}var e=b["static"][c];if(e&&la(e)){var f=a.global,g=Object.keys(e),h=!1,l=!1,k=!1,m=a.global.def("{}");g.forEach(function(b){var c=
e[b];if(Y.isDynamic(c))"function"===typeof c&&(c=e[b]=Y.unbox(c)),b=K(c,null),h=h||b.thisDep,k=k||b.propDep,l=l||b.contextDep;else{f(m,".",b,"=");switch(typeof c){case "number":f(c);break;case "string":f('"',c,'"');break;case "object":Array.isArray(c)&&f("[",c.join(),"]");break;default:f(a.link(c))}f(";")}});b.dynamic[c]=new Y.DynamicVariable(4,{thisDep:h,contextDep:l,propDep:k,ref:m,append:d});delete b["static"][c]}}var ea=k.Record,fa={add:32774,subtract:32778,"reverse subtract":32779};c.ext_blend_minmax&&
(fa.min=32775,fa.max=32776);var W=c.angle_instanced_arrays,Ma=c.webgl_draw_buffers,na=c.oes_vertex_array_object,ta={dirty:!0,profile:g.profile},Ea={},Na=[],ua={},va={};r("dither",3024);r("blend.enable",3042);p("blend.color","blendColor",[0,0,0,0]);p("blend.equation","blendEquationSeparate",[32774,32774]);p("blend.func","blendFuncSeparate",[1,0,1,0]);r("depth.enable",2929,!0);p("depth.func","depthFunc",513);p("depth.range","depthRange",[0,1]);p("depth.mask","depthMask",!0);p("colorMask","colorMask",
[!0,!0,!0,!0]);r("cull.enable",2884);p("cull.face","cullFace",1029);p("frontFace","frontFace",2305);p("lineWidth","lineWidth",1);r("polygonOffset.enable",32823);p("polygonOffset.offset","polygonOffset",[0,0]);r("sample.alpha",32926);r("sample.enable",32928);p("sample.coverage","sampleCoverage",[1,!1]);r("stencil.enable",2960);p("stencil.mask","stencilMask",-1);p("stencil.func","stencilFunc",[519,0,-1]);p("stencil.opFront","stencilOpSeparate",[1028,7680,7680,7680]);p("stencil.opBack","stencilOpSeparate",
[1029,7680,7680,7680]);r("scissor.enable",3089);p("scissor.box","scissor",[0,0,a.drawingBufferWidth,a.drawingBufferHeight]);p("viewport","viewport",[0,0,a.drawingBufferWidth,a.drawingBufferHeight]);var tb={gl:a,context:x,strings:b,next:Ea,current:ta,draw:m,elements:d,buffer:f,shader:u,attributes:k.state,vao:k,uniforms:v,framebuffer:n,extensions:c,timer:l,isBufferArgs:Sa},Pa={primTypes:Ka,compareFuncs:ab,blendFuncs:Ga,blendEquations:fa,stencilOps:Ta,glTypes:Ja,orientationType:zb};Ma&&(Pa.backBuffer=
[1029],Pa.drawBuffer=R(e.maxDrawbuffers,function(a){return 0===a?[0]:R(a,function(a){return 36064+a})}));var sa=0;return{next:Ea,current:ta,procs:function(){var a=P(),b=a.proc("poll"),d=a.proc("refresh"),f=a.block();b(f);d(f);var g=a.shared,h=g.gl,l=g.next,k=g.current;f(k,".dirty=false;");S(a,b);S(a,d,null,!0);var m;W&&(m=a.link(W));c.oes_vertex_array_object&&d(a.link(c.oes_vertex_array_object),".bindVertexArrayOES(null);");for(var p=0;p<e.maxAttributes;++p){var n=d.def(g.attributes,"[",p,"]"),q=
a.cond(n,".buffer");q.then(h,".enableVertexAttribArray(",p,");",h,".bindBuffer(",34962,",",n,".buffer.buffer);",h,".vertexAttribPointer(",p,",",n,".size,",n,".type,",n,".normalized,",n,".stride,",n,".offset);")["else"](h,".disableVertexAttribArray(",p,");",h,".vertexAttrib4f(",p,",",n,".x,",n,".y,",n,".z,",n,".w);",n,".buffer=null;");d(q);W&&d(m,".vertexAttribDivisorANGLE(",p,",",n,".divisor);")}d(a.shared.vao,".currentVAO=null;",a.shared.vao,".setVAO(",a.shared.vao,".targetVAO);");Object.keys(ua).forEach(function(c){var e=
ua[c],g=f.def(l,".",c),m=a.block();m("if(",g,"){",h,".enable(",e,")}else{",h,".disable(",e,")}",k,".",c,"=",g,";");d(m);b("if(",g,"!==",k,".",c,"){",m,"}")});Object.keys(va).forEach(function(c){var e=va[c],g=ta[c],m,p,n=a.block();n(h,".",e,"(");ra(g)?(e=g.length,m=a.global.def(l,".",c),p=a.global.def(k,".",c),n(R(e,function(a){return m+"["+a+"]"}),");",R(e,function(a){return p+"["+a+"]="+m+"["+a+"];"}).join("")),b("if(",R(e,function(a){return m+"["+a+"]!=="+p+"["+a+"]"}).join("||"),"){",n,"}")):(m=
f.def(l,".",c),p=f.def(k,".",c),n(m,");",k,".",c,"=",m,";"),b("if(",m,"!==",p,"){",n,"}"));d(n)});return a.compile()}(),compile:function(a,b,c,d,e){var f=P();f.stats=f.link(e);Object.keys(b["static"]).forEach(function(a){aa(f,b,a)});Xb.forEach(function(b){aa(f,a,b)});var g=A(a,b,c,d,f);Fa(f,g);ka(f,g);V(f,g);return L(f.compile(),{destroy:function(){g.shader.program.destroy()}})}}}function Bb(a,b){for(var c=0;c<a.length;++c)if(a[c]===b)return c;return-1}var L=function(a,b){for(var c=Object.keys(b),
e=0;e<c.length;++e)a[c[e]]=b[c[e]];return a},Db=0,Y={DynamicVariable:Z,define:function(a,b){return new Z(a,cb(b+""))},isDynamic:function(a){return"function"===typeof a&&!a._reglType||a instanceof Z},unbox:db,accessor:cb},bb={next:"function"===typeof requestAnimationFrame?function(a){return requestAnimationFrame(a)}:function(a){return setTimeout(a,16)},cancel:"function"===typeof cancelAnimationFrame?function(a){return cancelAnimationFrame(a)}:clearTimeout},Cb="undefined"!==typeof performance&&performance.now?
function(){return performance.now()}:function(){return+new Date},G=hb();G.zero=hb();var Yb=function(a,b){var c=1;b.ext_texture_filter_anisotropic&&(c=a.getParameter(34047));var e=1,f=1;b.webgl_draw_buffers&&(e=a.getParameter(34852),f=a.getParameter(36063));var d=!!b.oes_texture_float;if(d){d=a.createTexture();a.bindTexture(3553,d);a.texImage2D(3553,0,6408,1,1,0,6408,5126,null);var q=a.createFramebuffer();a.bindFramebuffer(36160,q);a.framebufferTexture2D(36160,36064,3553,d,0);a.bindTexture(3553,null);
if(36053!==a.checkFramebufferStatus(36160))d=!1;else{a.viewport(0,0,1,1);a.clearColor(1,0,0,1);a.clear(16384);var n=G.allocType(5126,4);a.readPixels(0,0,1,1,6408,5126,n);a.getError()?d=!1:(a.deleteFramebuffer(q),a.deleteTexture(d),d=1===n[0]);G.freeType(n)}}n=!0;"undefined"!==typeof navigator&&(/MSIE/.test(navigator.userAgent)||/Trident\//.test(navigator.appVersion)||/Edge/.test(navigator.userAgent))||(n=a.createTexture(),q=G.allocType(5121,36),a.activeTexture(33984),a.bindTexture(34067,n),a.texImage2D(34069,
0,6408,3,3,0,6408,5121,q),G.freeType(q),a.bindTexture(34067,null),a.deleteTexture(n),n=!a.getError());return{colorBits:[a.getParameter(3410),a.getParameter(3411),a.getParameter(3412),a.getParameter(3413)],depthBits:a.getParameter(3414),stencilBits:a.getParameter(3415),subpixelBits:a.getParameter(3408),extensions:Object.keys(b).filter(function(a){return!!b[a]}),maxAnisotropic:c,maxDrawbuffers:e,maxColorAttachments:f,pointSizeDims:a.getParameter(33901),lineWidthDims:a.getParameter(33902),maxViewportDims:a.getParameter(3386),
maxCombinedTextureUnits:a.getParameter(35661),maxCubeMapSize:a.getParameter(34076),maxRenderbufferSize:a.getParameter(34024),maxTextureUnits:a.getParameter(34930),maxTextureSize:a.getParameter(3379),maxAttributes:a.getParameter(34921),maxVertexUniforms:a.getParameter(36347),maxVertexTextureUnits:a.getParameter(35660),maxVaryingVectors:a.getParameter(36348),maxFragmentUniforms:a.getParameter(36349),glsl:a.getParameter(35724),renderer:a.getParameter(7937),vendor:a.getParameter(7936),version:a.getParameter(7938),
readFloat:d,npotTextureCube:n}},O=function(a){return a instanceof Uint8Array||a instanceof Uint16Array||a instanceof Uint32Array||a instanceof Int8Array||a instanceof Int16Array||a instanceof Int32Array||a instanceof Float32Array||a instanceof Float64Array||a instanceof Uint8ClampedArray},I=function(a){return Object.keys(a).map(function(b){return a[b]})},Qa={shape:function(a){for(var b=[];a.length;a=a[0])b.push(a.length);return b},flatten:function(a,b,c,e){var f=1;if(b.length)for(var d=0;d<b.length;++d)f*=
b[d];else f=0;c=e||G.allocType(c,f);switch(b.length){case 0:break;case 1:e=b[0];for(b=0;b<e;++b)c[b]=a[b];break;case 2:e=b[0];b=b[1];for(d=f=0;d<e;++d)for(var q=a[d],n=0;n<b;++n)c[f++]=q[n];break;case 3:ib(a,b[0],b[1],b[2],c,0);break;default:jb(a,b,0,c,0)}return c}},Ia={"[object Int8Array]":5120,"[object Int16Array]":5122,"[object Int32Array]":5124,"[object Uint8Array]":5121,"[object Uint8ClampedArray]":5121,"[object Uint16Array]":5123,"[object Uint32Array]":5125,"[object Float32Array]":5126,"[object Float64Array]":5121,
"[object ArrayBuffer]":5121},Ja={int8:5120,int16:5122,int32:5124,uint8:5121,uint16:5123,uint32:5125,"float":5126,float32:5126},nb={dynamic:35048,stream:35040,"static":35044},Ua=Qa.flatten,mb=Qa.shape,na=[];na[5120]=1;na[5122]=2;na[5124]=4;na[5121]=1;na[5123]=2;na[5125]=4;na[5126]=4;var Ka={points:0,point:0,lines:1,line:1,triangles:4,triangle:4,"line loop":2,"line strip":3,"triangle strip":5,"triangle fan":6},pb=new Float32Array(1),Lb=new Uint32Array(pb.buffer),Pb=[9984,9986,9985,9987],Oa=[0,6409,
6410,6407,6408],U={};U[6409]=U[6406]=U[6402]=1;U[34041]=U[6410]=2;U[6407]=U[35904]=3;U[6408]=U[35906]=4;var Xa=sa("HTMLCanvasElement"),Ya=sa("OffscreenCanvas"),ub=sa("CanvasRenderingContext2D"),vb=sa("ImageBitmap"),wb=sa("HTMLImageElement"),xb=sa("HTMLVideoElement"),Mb=Object.keys(Ia).concat([Xa,Ya,ub,vb,wb,xb]),za=[];za[5121]=1;za[5126]=4;za[36193]=2;za[5123]=2;za[5125]=4;var C=[];C[32854]=2;C[32855]=2;C[36194]=2;C[34041]=4;C[33776]=.5;C[33777]=.5;C[33778]=1;C[33779]=1;C[35986]=.5;C[35987]=1;C[34798]=
1;C[35840]=.5;C[35841]=.25;C[35842]=.5;C[35843]=.25;C[36196]=.5;var Q=[];Q[32854]=2;Q[32855]=2;Q[36194]=2;Q[33189]=2;Q[36168]=1;Q[34041]=4;Q[35907]=4;Q[34836]=16;Q[34842]=8;Q[34843]=6;var Zb=function(a,b,c,e,f){function d(a){this.id=k++;this.refCount=1;this.renderbuffer=a;this.format=32854;this.height=this.width=0;f.profile&&(this.stats={size:0})}function q(b){var c=b.renderbuffer;a.bindRenderbuffer(36161,null);a.deleteRenderbuffer(c);b.renderbuffer=null;b.refCount=0;delete u[b.id];e.renderbufferCount--}
var n={rgba4:32854,rgb565:36194,"rgb5 a1":32855,depth:33189,stencil:36168,"depth stencil":34041};b.ext_srgb&&(n.srgba=35907);b.ext_color_buffer_half_float&&(n.rgba16f=34842,n.rgb16f=34843);b.webgl_color_buffer_float&&(n.rgba32f=34836);var v=[];Object.keys(n).forEach(function(a){v[n[a]]=a});var k=0,u={};d.prototype.decRef=function(){0>=--this.refCount&&q(this)};f.profile&&(e.getTotalRenderbufferSize=function(){var a=0;Object.keys(u).forEach(function(b){a+=u[b].stats.size});return a});return{create:function(b,
c){function l(b,c){var d=0,e=0,k=32854;"object"===typeof b&&b?("shape"in b?(e=b.shape,d=e[0]|0,e=e[1]|0):("radius"in b&&(d=e=b.radius|0),"width"in b&&(d=b.width|0),"height"in b&&(e=b.height|0)),"format"in b&&(k=n[b.format])):"number"===typeof b?(d=b|0,e="number"===typeof c?c|0:d):b||(d=e=1);if(d!==g.width||e!==g.height||k!==g.format)return l.width=g.width=d,l.height=g.height=e,g.format=k,a.bindRenderbuffer(36161,g.renderbuffer),a.renderbufferStorage(36161,k,d,e),f.profile&&(g.stats.size=Q[g.format]*
g.width*g.height),l.format=v[g.format],l}var g=new d(a.createRenderbuffer());u[g.id]=g;e.renderbufferCount++;l(b,c);l.resize=function(b,c){var d=b|0,e=c|0||d;if(d===g.width&&e===g.height)return l;l.width=g.width=d;l.height=g.height=e;a.bindRenderbuffer(36161,g.renderbuffer);a.renderbufferStorage(36161,g.format,d,e);f.profile&&(g.stats.size=Q[g.format]*g.width*g.height);return l};l._reglType="renderbuffer";l._renderbuffer=g;f.profile&&(l.stats=g.stats);l.destroy=function(){g.decRef()};return l},clear:function(){I(u).forEach(q)},
restore:function(){I(u).forEach(function(b){b.renderbuffer=a.createRenderbuffer();a.bindRenderbuffer(36161,b.renderbuffer);a.renderbufferStorage(36161,b.format,b.width,b.height)});a.bindRenderbuffer(36161,null)}}},Za=[];Za[6408]=4;Za[6407]=3;var Ra=[];Ra[5121]=1;Ra[5126]=4;Ra[36193]=2;var Da=["x","y","z","w"],Xb="blend.func blend.equation stencil.func stencil.opFront stencil.opBack sample.coverage viewport scissor.box polygonOffset.offset".split(" "),Ga={0:0,1:1,zero:0,one:1,"src color":768,"one minus src color":769,
"src alpha":770,"one minus src alpha":771,"dst color":774,"one minus dst color":775,"dst alpha":772,"one minus dst alpha":773,"constant color":32769,"one minus constant color":32770,"constant alpha":32771,"one minus constant alpha":32772,"src alpha saturate":776},ab={never:512,less:513,"<":513,equal:514,"=":514,"==":514,"===":514,lequal:515,"<=":515,greater:516,">":516,notequal:517,"!=":517,"!==":517,gequal:518,">=":518,always:519},Ta={0:0,zero:0,keep:7680,replace:7681,increment:7682,decrement:7683,
"increment wrap":34055,"decrement wrap":34056,invert:5386},zb={cw:2304,ccw:2305},Ab=new J(!1,!1,!1,function(){}),$b=function(a,b){function c(){this.endQueryIndex=this.startQueryIndex=-1;this.sum=0;this.stats=null}function e(a,b,d){var e=q.pop()||new c;e.startQueryIndex=a;e.endQueryIndex=b;e.sum=0;e.stats=d;n.push(e)}if(!b.ext_disjoint_timer_query)return null;var f=[],d=[],q=[],n=[],v=[],k=[];return{beginQuery:function(a){var c=f.pop()||b.ext_disjoint_timer_query.createQueryEXT();b.ext_disjoint_timer_query.beginQueryEXT(35007,
c);d.push(c);e(d.length-1,d.length,a)},endQuery:function(){b.ext_disjoint_timer_query.endQueryEXT(35007)},pushScopeStats:e,update:function(){var a,c;a=d.length;if(0!==a){k.length=Math.max(k.length,a+1);v.length=Math.max(v.length,a+1);v[0]=0;var e=k[0]=0;for(c=a=0;c<d.length;++c){var l=d[c];b.ext_disjoint_timer_query.getQueryObjectEXT(l,34919)?(e+=b.ext_disjoint_timer_query.getQueryObjectEXT(l,34918),f.push(l)):d[a++]=l;v[c+1]=e;k[c+1]=a}d.length=a;for(c=a=0;c<n.length;++c){var e=n[c],g=e.startQueryIndex,
l=e.endQueryIndex;e.sum+=v[l]-v[g];g=k[g];l=k[l];l===g?(e.stats.gpuTime+=e.sum/1E6,q.push(e)):(e.startQueryIndex=g,e.endQueryIndex=l,n[a++]=e)}n.length=a}},getNumPendingQueries:function(){return d.length},clear:function(){f.push.apply(f,d);for(var a=0;a<f.length;a++)b.ext_disjoint_timer_query.deleteQueryEXT(f[a]);d.length=0;f.length=0},restore:function(){d.length=0;f.length=0}}};return function(a){function b(){if(0===E.length)t&&t.update(),ca=null;else{ca=bb.next(b);u();for(var a=E.length-1;0<=a;--a){var c=
E[a];c&&c(H,null,0)}l.flush();t&&t.update()}}function c(){!ca&&0<E.length&&(ca=bb.next(b))}function e(){ca&&(bb.cancel(b),ca=null)}function f(a){a.preventDefault();e();R.forEach(function(a){a()})}function d(a){l.getError();h.restore();F.restore();y.restore();A.restore();O.restore();S.restore();K.restore();t&&t.restore();I.procs.refresh();c();U.forEach(function(a){a()})}function q(a){function b(a,c){var d={},e={};Object.keys(a).forEach(function(b){var f=a[b];if(Y.isDynamic(f))e[b]=Y.unbox(f,b);else{if(c&&
Array.isArray(f))for(var g=0;g<f.length;++g)if(Y.isDynamic(f[g])){e[b]=Y.unbox(f,b);return}d[b]=f}});return{dynamic:e,"static":d}}function c(a){for(;n.length<a;)n.push(null);return n}var d=b(a.context||{},!0),e=b(a.uniforms||{},!0),f=b(a.attributes||{},!1);a=b(function(a){function b(a){if(a in c){var d=c[a];delete c[a];Object.keys(d).forEach(function(b){c[a+"."+b]=d[b]})}}var c=L({},a);delete c.uniforms;delete c.attributes;delete c.context;delete c.vao;"stencil"in c&&c.stencil.op&&(c.stencil.opBack=
c.stencil.opFront=c.stencil.op,delete c.stencil.op);b("blend");b("depth");b("cull");b("stencil");b("polygonOffset");b("scissor");b("sample");"vao"in a&&(c.vao=a.vao);return c}(a),!1);var g={gpuTime:0,cpuTime:0,count:0},h=I.compile(a,f,e,d,g),k=h.draw,l=h.batch,m=h.scope,n=[];return L(function(a,b){var d;if("function"===typeof a)return m.call(this,null,a,0);if("function"===typeof b)if("number"===typeof a)for(d=0;d<a;++d)m.call(this,null,b,d);else if(Array.isArray(a))for(d=0;d<a.length;++d)m.call(this,
a[d],b,d);else return m.call(this,a,b,0);else if("number"===typeof a){if(0<a)return l.call(this,c(a|0),a|0)}else if(Array.isArray(a)){if(a.length)return l.call(this,a,a.length)}else return k.call(this,a)},{stats:g,destroy:function(){h.destroy()}})}function n(a,b){var c=0;I.procs.poll();var d=b.color;d&&(l.clearColor(+d[0]||0,+d[1]||0,+d[2]||0,+d[3]||0),c|=16384);"depth"in b&&(l.clearDepth(+b.depth),c|=256);"stencil"in b&&(l.clearStencil(b.stencil|0),c|=1024);l.clear(c)}function v(a){E.push(a);c();
return{cancel:function(){function b(){var a=Bb(E,b);E[a]=E[E.length-1];--E.length;0>=E.length&&e()}var c=Bb(E,a);E[c]=b}}}function k(){var a=Q.viewport,b=Q.scissor_box;a[0]=a[1]=b[0]=b[1]=0;H.viewportWidth=H.framebufferWidth=H.drawingBufferWidth=a[2]=b[2]=l.drawingBufferWidth;H.viewportHeight=H.framebufferHeight=H.drawingBufferHeight=a[3]=b[3]=l.drawingBufferHeight}function u(){H.tick+=1;H.time=x();k();I.procs.poll()}function m(){A.refresh();k();I.procs.refresh();t&&t.update()}function x(){return(Cb()-
G)/1E3}a=Hb(a);if(!a)return null;var l=a.gl,g=l.getContextAttributes();l.isContextLost();var h=Ib(l,a);if(!h)return null;var r=Eb(),p={vaoCount:0,bufferCount:0,elementsCount:0,framebufferCount:0,shaderCount:0,textureCount:0,cubeCount:0,renderbufferCount:0,maxTextureUnits:0},w=h.extensions,t=$b(l,w),G=Cb(),C=l.drawingBufferWidth,J=l.drawingBufferHeight,H={tick:0,time:0,viewportWidth:C,viewportHeight:J,framebufferWidth:C,framebufferHeight:J,drawingBufferWidth:C,drawingBufferHeight:J,pixelRatio:a.pixelRatio},
C={elements:null,primitive:4,count:-1,offset:0,instances:-1},M=Yb(l,w),y=Jb(l,p,a,function(a){return K.destroyBuffer(a)}),T=Kb(l,w,y,p),K=Sb(l,w,M,p,y,T,C),F=Tb(l,r,p,a),A=Nb(l,w,M,function(){I.procs.poll()},H,p,a),O=Zb(l,w,M,p,a),S=Rb(l,w,M,A,O,p),I=Wb(l,r,w,M,y,T,A,S,{},K,F,C,H,t,a),r=Ub(l,S,I.procs.poll,H,g,w,M),Q=I.next,N=l.canvas,E=[],R=[],U=[],Z=[a.onDestroy],ca=null;N&&(N.addEventListener("webglcontextlost",f,!1),N.addEventListener("webglcontextrestored",d,!1));var aa=S.setFBO=q({framebuffer:Y.define.call(null,
1,"framebuffer")});m();g=L(q,{clear:function(a){if("framebuffer"in a)if(a.framebuffer&&"framebufferCube"===a.framebuffer_reglType)for(var b=0;6>b;++b)aa(L({framebuffer:a.framebuffer.faces[b]},a),n);else aa(a,n);else n(null,a)},prop:Y.define.bind(null,1),context:Y.define.bind(null,2),"this":Y.define.bind(null,3),draw:q({}),buffer:function(a){return y.create(a,34962,!1,!1)},elements:function(a){return T.create(a,!1)},texture:A.create2D,cube:A.createCube,renderbuffer:O.create,framebuffer:S.create,framebufferCube:S.createCube,
vao:K.createVAO,attributes:g,frame:v,on:function(a,b){var c;switch(a){case "frame":return v(b);case "lost":c=R;break;case "restore":c=U;break;case "destroy":c=Z}c.push(b);return{cancel:function(){for(var a=0;a<c.length;++a)if(c[a]===b){c[a]=c[c.length-1];c.pop();break}}}},limits:M,hasExtension:function(a){return 0<=M.extensions.indexOf(a.toLowerCase())},read:r,destroy:function(){E.length=0;e();N&&(N.removeEventListener("webglcontextlost",f),N.removeEventListener("webglcontextrestored",d));F.clear();
S.clear();O.clear();K.clear();A.clear();T.clear();y.clear();t&&t.clear();Z.forEach(function(a){a()})},_gl:l,_refresh:m,poll:function(){u();t&&t.update()},now:x,stats:p});a.onDone(null,g);return g}});

},{}],4:[function(require,module,exports){
module.exports.highNibble = byte => (byte & 0xF0) >> 4
module.exports.lowNibble = byte => byte & 0x0F
module.exports.nthbit = (n,byte) => (byte & (1 << n)) > 0
module.exports.bit8 = (high,low) => (high << 4) + low
module.exports.bit12 = (high,mid,low) => (high << 8) + (mid << 4) + low
},{}],5:[function(require,module,exports){
module.exports.hundreds = n => (n / 100) | 0
module.exports.tens = n => ((n % 100) / 10) | 0
module.exports.ones = n => (n % 10) | 0
},{}],6:[function(require,module,exports){
module.exports = new Uint8Array([
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
])
},{}],7:[function(require,module,exports){
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
},{}],8:[function(require,module,exports){
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
},{"big-triangle":2,"regl":3}],9:[function(require,module,exports){
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
},{}]},{},[1]);
