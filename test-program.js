// draw sprite at reg1, reg2 with height 5
module.exports = new Uint8Array([
  0x60, 0x00,     // write address of built-in sprite to register 0
  0xF0, 0x29,     // point I at location in register 0
  0x61, 0x08,     // write x-coord in register1
  0x62, 0x08,     // write y-coord in register2
  0xD1, 0x25,     // draw sprite with x in reg1, y in reg2 and height 5
  0x12, 0x00      // loop back to PC 512 (0x200) to repeat program forever
])