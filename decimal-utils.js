module.exports.hundreds = n => (n / 100) | 0
module.exports.tens = n => ((n % 100) / 10) | 0
module.exports.ones = n => (n % 10) | 0