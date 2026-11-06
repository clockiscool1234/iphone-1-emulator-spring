
var FONT = require("scripts/font.js");
var CRC_TABLE = [];
for (var n = 0; n < 256; n++) {
  var c = n;
  for (var k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function u32(out, value) {
  out.push(value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255);
}

function chunk(out, name, data) {
  u32(out, data.length);
  var start = out.length;
  for (var i = 0; i < 4; i++) out.push(name.charCodeAt(i));
  for (var j = 0; j < data.length; j++) out.push(data[j]);
  var crc = 0xffffffff;
  for (var p = start; p < out.length; p++) crc = CRC_TABLE[(crc ^ out[p]) & 255] ^ (crc >>> 8);
  u32(out, (crc ^ 0xffffffff) >>> 0);
}

function base64(bytes) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[a >>> 2] + alphabet[((a & 3) << 4) | (b >>> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >>> 6)] : "=") +
      (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  }
  return out;
}

module.exports = function (lines, background, foreground) {
  background = background || [8, 11, 12];
  foreground = foreground || [168, 230, 161];
  var width = 640, height = lines.length * 16;
  var raw = [];
  for (var y = 0; y < height; y++) {
    raw.push(0);
    var line = lines[(y / 16) | 0] || "";
    var glyphRow = y & 15;
    for (var x = 0; x < 80; x++) {
      var code = x < line.length ? line.charCodeAt(x) : 32;
      if (code > 255) code = 63;
      raw.push(FONT[code * 16 + glyphRow]);
    }
  }


  var z = [0x78, 0x01], at = 0;
  while (at < raw.length) {
    var length = Math.min(65535, raw.length - at);
    z.push(at + length >= raw.length ? 1 : 0, length & 255, length >>> 8,
      (~length) & 255, ((~length) >>> 8) & 255);
    for (var r = 0; r < length; r++) z.push(raw[at++]);
  }
  var a = 1, b = 0;
  for (var q = 0; q < raw.length; q++) {
    a = (a + raw[q]) % 65521;
    b = (b + a) % 65521;
  }
  u32(z, ((b << 16) | a) >>> 0);

  var png = [137, 80, 78, 71, 13, 10, 26, 10];
  var ihdr = [];
  u32(ihdr, width); u32(ihdr, height);
  ihdr.push(1, 3, 0, 0, 0);
  chunk(png, "IHDR", ihdr);
  chunk(png, "PLTE", background.concat(foreground));
  chunk(png, "IDAT", z);
  chunk(png, "IEND", []);
  return base64(png);
};
