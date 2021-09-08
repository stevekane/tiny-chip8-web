module.exports.hundreds = n => (n / 100)
module.exports.tens = n => ((n % 100) / 10)
module.exports.ones = n => (n % 10)