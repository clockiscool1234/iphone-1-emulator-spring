/*
 * Spring host for the wasm2js translation of iphone-1's portable C core.
 * The core remains GPL-2.0-or-later; see assets/GPL-2.0.txt.
 */
var instantiate = require("scripts/s5lbox_core.js");

var REVERSE = new Int16Array(123);
for (var ri = 0; ri < REVERSE.length; ri++) REVERSE[ri] = -1;
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
for (var ai = 0; ai < ALPHABET.length; ai++) REVERSE[ALPHABET.charCodeAt(ai)] = ai;

function decodedSize(source) {
  if (!source || (source.length & 3)) throw new Error("invalid base64 length");
  var padding = source.slice(-2) === "==" ? 2 : source.slice(-1) === "=" ? 1 : 0;
  return source.length * 3 / 4 - padding;
}

function Runtime(output) {
  this.output = output || function () {};
  this.exports = null;
  this.heap = null;
  this.words = null;
  this.serialPointer = 0;
  this.tempRet0 = 0;
}

Runtime.prototype.create = function () {
  if (this.exports) return;
  var self = this;
  function fdWrite(fd, iov, count, written) {
    if (!self.heap) return 0;
    var total = 0;
    for (var i = 0; i < count; i++, iov += 8) {
      var pointer = self.words[iov >>> 2];
      var length = self.words[(iov + 4) >>> 2];
      total += length;
      /* C diagnostics belong in logcat. UART output uses emu_serial_read. */
      var line = "";
      for (var j = 0; j < length && line.length < 1000; j++) {
        var byte = self.heap[pointer + j];
        if (byte >= 32 || byte === 10 || byte === 13 || byte === 9)
          line += String.fromCharCode(byte);
      }
      if (line) console.warn("[S5LBox] " + line);
    }
    self.words[written >>> 2] = total;
    return 0;
  }
  var imports = {
    a: {
      a: function () { return Date.now(); },
      b: fdWrite,
      c: function () { return 0; },
      d: function () { return 70; },
      e: function () { return 0; },
      f: function (count, bytes) {
        if (self.words) {
          self.words[count >>> 2] = 0;
          self.words[bytes >>> 2] = 0;
        }
        return 0;
      },
      g: function () { return 52; },
      h: function () {}
    },
    env: { setTempRet0: function (value) { self.tempRet0 = value; } }
  };
  this.exports = instantiate(imports);
  this.heap = new Uint8Array(this.exports.i.buffer);
  this.words = new Uint32Array(this.exports.i.buffer);
  this.exports.j();
  this.serialPointer = this.exports.V(8192);
  if (!this.serialPointer) throw new Error("could not allocate UART buffer");
};

Runtime.prototype.allocate = function (bytes) {
  var pointer = this.exports.V(bytes);
  if (!pointer) throw new Error("emulator memory allocation failed");
  return pointer;
};

Runtime.prototype.free = function (pointer) {
  if (pointer) this.exports.o(pointer);
};

Runtime.prototype.decodePart = function (source, sourceStart, sourceEnd, target, targetStart) {
  var out = targetStart;
  for (var i = sourceStart; i < sourceEnd; i += 4) {
    var ac = source.charCodeAt(i), bc = source.charCodeAt(i + 1);
    var cc = source.charCodeAt(i + 2), dc = source.charCodeAt(i + 3);
    var a = ac < REVERSE.length ? REVERSE[ac] : -1;
    var b = bc < REVERSE.length ? REVERSE[bc] : -1;
    var c = cc === 61 ? -2 : cc < REVERSE.length ? REVERSE[cc] : -1;
    var d = dc === 61 ? -2 : dc < REVERSE.length ? REVERSE[dc] : -1;
    if (a < 0 || b < 0 || c === -1 || d === -1)
      throw new Error("invalid base64 firmware data at character " + i);
    this.heap[target + out++] = (a << 2) | (b >> 4);
    if (c >= 0) this.heap[target + out++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) this.heap[target + out++] = ((c & 3) << 6) | d;
  }
  return out;
};

Runtime.prototype.decodedSize = decodedSize;

Runtime.prototype.boot = function (kernelPointer, kernelSize, treePointer, treeSize) {
  var result = this.exports.n(kernelPointer, kernelSize, treePointer, treeSize,
                              0, 0, 64);
  if (result !== 0) throw new Error(this.error() || "S5LBox initialization failed");
};

Runtime.prototype.error = function () {
  var pointer = this.exports.m();
  var text = "";
  while (pointer && this.heap[pointer] && text.length < 1000)
    text += String.fromCharCode(this.heap[pointer++]);
  return text;
};

Runtime.prototype.drainSerial = function () {
  var count;
  do {
    count = this.exports.z(this.serialPointer, 8192);
    for (var i = 0; i < count; i++) this.output(this.heap[this.serialPointer + i]);
  } while (count === 8192);
};

Runtime.prototype.runSlice = function (maximumInstructions, maximumMilliseconds) {
  var began = Date.now(), total = 0;
  while (total < maximumInstructions && Date.now() - began < maximumMilliseconds) {
    var amount = Math.min(1024, maximumInstructions - total);
    var ran = this.exports.r(amount);
    total += ran;
    this.drainSerial();
    if (!ran || this.exports.s() !== 0) break;
  }
  return { instructions: total, status: this.exports.s() };
};

module.exports = Runtime;
