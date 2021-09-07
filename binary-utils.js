module.exports.highNibble = byte => (byte & 0xF0) >> 4
module.exports.lowNibble = byte => byte & 0x0F
module.exports.nthbit = (n,byte) => (byte & (1 << n)) > 0
module.exports.bit8 = (high,low) => (high << 4) + low
module.exports.bit12 = (high,mid,low) => (high << 8) + (mid << 4) + low