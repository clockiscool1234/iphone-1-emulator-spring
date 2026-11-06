
function Terminal(columns, rows) {
  this.columns = columns || 80;
  this.rows = rows || 35;
  this.lines = [];
  for (var i = 0; i < this.rows; i++) this.lines.push([]);
  this.x = 0;
  this.y = 0;
  this.state = 0;
  this.csi = "";
}

Terminal.prototype.clear = function () {
  this.lines = [];
  for (var i = 0; i < this.rows; i++) this.lines.push([]);
  this.x = 0;
  this.y = 0;
};

Terminal.prototype.scroll = function () {
  while (this.y >= this.rows) {
    this.lines.shift();
    this.lines.push([]);
    this.y--;
  }
};

Terminal.prototype.putPrintable = function (code) {


  if (code === 91 && /^`*m$/.test(this.lines[this.y].join(""))) {
    this.lines[this.y] = [];
    this.x = 0;
  }
  if (this.x >= this.columns) {
    this.x = 0;
    this.y++;
    this.scroll();
  }
  this.lines[this.y][this.x++] = String.fromCharCode(code);
};

Terminal.prototype.applyCSI = function (finalCharacter) {
  var values = this.csi.length ? this.csi.replace(/^\?/, "").split(";").map(function (n) {
    return parseInt(n || "0", 10);
  }) : [0];
  var n = values[0] || 1;
  switch (finalCharacter) {
    case "A": this.y = Math.max(0, this.y - n); break;
    case "B": this.y = Math.min(this.rows - 1, this.y + n); break;
    case "C": this.x = Math.min(this.columns - 1, this.x + n); break;
    case "D": this.x = Math.max(0, this.x - n); break;
    case "G": this.x = Math.max(0, Math.min(this.columns - 1, n - 1)); break;
    case "H":
    case "f":
      this.y = Math.max(0, Math.min(this.rows - 1, (values[0] || 1) - 1));
      this.x = Math.max(0, Math.min(this.columns - 1, (values[1] || 1) - 1));
      break;
    case "J":
      if (values[0] === 2 || values[0] === 3) this.clear();
      break;
    case "K":
      if (values[0] === 1) this.lines[this.y].splice(0, this.x + 1);
      else if (values[0] === 2) this.lines[this.y] = [];
      else this.lines[this.y].splice(this.x);
      break;

  }
};

Terminal.prototype.writeByte = function (code) {
  code &= 255;
  if (this.state === 1) {
    if (code === 91) {
      this.state = 2;
      this.csi = "";
    } else {
      this.state = 0;
    }
    return;
  }
  if (this.state === 2) {
    if (code >= 0x40 && code <= 0x7e) {
      this.applyCSI(String.fromCharCode(code));
      this.state = 0;
    } else if (this.csi.length < 32) {
      this.csi += String.fromCharCode(code);
    } else {
      this.state = 0;
    }
    return;
  }
  if (code === 27) {
    this.state = 1;
  } else if (code === 13) {
    this.x = 0;
  } else if (code === 10) {
    this.y++;
    this.scroll();
  } else if (code === 8 || code === 127) {
    if (this.x > 0) this.x--;
  } else if (code === 9) {
    var next = Math.min(this.columns, (Math.floor(this.x / 8) + 1) * 8);
    while (this.x < next) this.putPrintable(32);
  } else if (code >= 32 && code !== 255) {
    this.putPrintable(code);
  }
};

Terminal.prototype.textLines = function () {
  return this.lines.map(function (line) { return line.join(""); });
};

module.exports = Terminal;
