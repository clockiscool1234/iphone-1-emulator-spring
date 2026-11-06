var Runtime = require("scripts/runtime.js");
var Terminal = require("scripts/terminal.js");
var BitmapTerminal = require("scripts/bitmap_terminal.js");

var KERNEL_BYTES = 5888896;
var TREE_BYTES = 36864;
var REMOTE_BASE = "https://raw.githubusercontent.com/clockiscool1234/iphone-1-emulator-spring/main/web/firmware/spring/";
var REMOTE_KERNEL = ["kernel_1A543a.macho.b64.part0", "kernel_1A543a.macho.b64.part1"];
var REMOTE_TREE = ["devicetree_m68ap.bin.b64.part0"];
var terminal = new Terminal(80, 45);
var vm = null;
var ready = false;
var loading = false;
var generation = 0;
var firmware = null;
var sourceMode = storage.get("s5lboxSource") || "remote";
var terminalDirty = true;
var terminalImageIndex = 0;
var lastTerminalRender = 0;
var totalInstructions = 0;
var measuredInstructions = 0;
var measuredAt = Date.now();
var phase = "Checking firmware";

function writeText(text) {
  for (var i = 0; i < text.length; i++) terminal.writeByte(text.charCodeAt(i));
  terminalDirty = true;
}

function setPhase(text) {
  phase = text;
  if (statusLabel) statusLabel.text = text;
}

function refreshTerminal(force) {
  var now = Date.now();
  if (!force && now - lastTerminalRender < 180) return;
  var data = BitmapTerminal(terminal.textLines(), [4, 7, 8], [158, 225, 154]);
  terminalImageIndex ^= 1;
  var path = "s5lbox-terminal-" + terminalImageIndex + ".png";
  files.writeBase64(path, data);
  terminalView.image = "files/" + path;
  terminalDirty = false;
  lastTerminalRender = now;
}

function firmwareCandidate(paths) {
  var result = { kernel: null, tree: null };
  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    if (!path || !files.exists(path)) continue;
    var info = files.stat(path);
    if (!info || info.isFolder) continue;
    if (info.size === KERNEL_BYTES) result.kernel = path;
    if (info.size === TREE_BYTES) result.tree = path;
  }
  return result.kernel && result.tree ? result : null;
}

function findFirmware(extraPaths) {
  var paths = (extraPaths || []).slice();
  var saved = storage.get("s5lboxFirmware");
  if (saved) paths.push(saved.kernel, saved.tree);
  paths.push("firmware/kernel_1A543a.macho", "firmware/devicetree_m68ap.bin");
  firmware = firmwareCandidate(paths);
  if (firmware) {
    storage.set("s5lboxFirmware", firmware);
    bootButton.enabled = true;
    if (sourceMode === "local") setPhase("Local firmware ready · no root filesystem");
    else setPhase("Network firmware ready · no root filesystem");
  } else {
    sourceMode = "remote";
    storage.set("s5lboxSource", sourceMode);
    bootButton.enabled = true;
    setPhase("Network boot ready · no root filesystem");
  }
}

function uartOutput(byte) {
  terminal.writeByte(byte & 255);
  terminalDirty = true;
}

var screen = new UIGameView({
  frame: [0, 0, 320, 416], background: "#040708", fps: 30
});

var statusLabel = new UILabel({
  frame: [5, 1, 230, 17], text: phase, size: 8, bold: true,
  color: "#cbd4d7", background: "#151b1e"
});
var speedLabel = new UILabel({
  frame: [230, 1, 85, 17], text: "", size: 8, align: "right",
  color: "#7f9298", background: "#151b1e"
});
var terminalView = new UIImageView({
  frame: [0, 20, 320, 360], background: "#040708"
});
var importButton = new UIButton({
  frame: [5, 383, 150, 31], title: "Firmware Source"
});
var bootButton = new UIButton({
  frame: [165, 383, 150, 31], title: "Boot", enabled: false
});

var controller = new UIViewController({
  title: "S5LBox Kernel", background: "#040708",
  views: [screen, terminalView, statusLabel, speedLabel, importButton, bootButton]
});
var navigation = new UINavigationController(controller, { barStyle: "black" });

screen.update = function () {
  if (ready && vm) {
    try {
      var result = vm.runSlice(30000, 18);
      totalInstructions += result.instructions;
      measuredInstructions += result.instructions;
      var now = Date.now();
      if (now - measuredAt >= 1000) {
        var ips = measuredInstructions * 1000 / (now - measuredAt);
        speedLabel.text = ips >= 1000000 ? (ips / 1000000).toFixed(2) + " MIPS" :
                          Math.round(ips / 1000) + " KIPS";
        measuredInstructions = 0;
        measuredAt = now;
      }
      if (result.status !== 0) {
        ready = false;
        bootButton.title = "Boot";
        setPhase("CPU stopped · status " + result.status);
      } else {
        setPhase("XNU running · " + Math.round(totalInstructions / 1000) + "K instructions");
      }
    } catch (error) {
      fail("CPU execution", error);
    }
  }
  if (terminalDirty) {
    try { refreshTerminal(false); }
    catch (error) { fail("terminal rendering", error); }
  }
};

function fail(stage, error) {
  ready = false;
  loading = false;
  generation++;
  bootButton.title = "Boot";
  bootButton.enabled = sourceMode === "remote" || !!firmware;
  setPhase("Error · " + stage);
  writeText("\r\n[host] " + stage + ": " + String(error) + "\r\n");
  console.error("[S5LBox] " + stage + ": " + String(error) +
    (error && error.stack ? "\n" + error.stack : ""));
}

function stopVM() {
  generation++;
  ready = false;
  loading = false;
  bootButton.title = "Boot";
  bootButton.enabled = sourceMode === "remote" || !!firmware;
  setPhase("Stopped · firmware retained");
}

function decodeFirmware(path, label, token, done) {
  setPhase("Reading " + label);
  setTimeout(function () {
    if (token !== generation) return;
    try {
      var encoded = files.readBase64(path);
      var size = vm.decodedSize(encoded);
      var pointer = vm.allocate(size);
      var sourceAt = 0, targetAt = 0;
      function turn() {
        if (token !== generation) { vm.free(pointer); return; }
        try {
          var end = Math.min(encoded.length, sourceAt + 128 * 1024);
          end -= (end - sourceAt) & 3;
          if (end <= sourceAt) end = encoded.length;
          targetAt = vm.decodePart(encoded, sourceAt, end, pointer, targetAt);
          sourceAt = end;
          setPhase("Loading " + label + " · " + Math.round(sourceAt * 100 / encoded.length) + "%");
          if (sourceAt < encoded.length) setTimeout(turn, 16);
          else {
            encoded = null;
            done(pointer, size);
          }
        } catch (error) {
          encoded = null;
          vm.free(pointer);
          fail(label + " decode", error);
        }
      }
      setTimeout(turn, 16);
    } catch (error) {
      fail(label + " read", error);
    }
  }, 16);
}

function decodeRemote(parts, expectedBytes, label, token, done) {
  var pointer;
  try { pointer = vm.allocate(expectedBytes); }
  catch (error) { fail(label + " allocation", error); return; }
  var partIndex = 0, targetAt = 0;
  function nextPart() {
    if (token !== generation) { vm.free(pointer); return; }
    if (partIndex >= parts.length) {
      if (targetAt !== expectedBytes) {
        vm.free(pointer);
        fail(label + " download", new Error("decoded " + targetAt + " bytes, expected " + expectedBytes));
      } else done(pointer, expectedBytes);
      return;
    }
    var name = parts[partIndex];
    setPhase("Downloading " + label + " · part " + (partIndex + 1) + "/" + parts.length);
    fetch(REMOTE_BASE + name).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status + " for " + name);
      return response.text();
    }).then(function (encoded) {
      var sourceAt = 0;
      function decodeTurn() {
        if (token !== generation) { vm.free(pointer); return; }
        try {
          var end = Math.min(encoded.length, sourceAt + 128 * 1024);
          end -= (end - sourceAt) & 3;
          if (end <= sourceAt) end = encoded.length;
          targetAt = vm.decodePart(encoded, sourceAt, end, pointer, targetAt);
          sourceAt = end;
          var whole = (partIndex + sourceAt / encoded.length) / parts.length;
          setPhase("Loading " + label + " · " + Math.round(whole * 100) + "%");
          if (sourceAt < encoded.length) setTimeout(decodeTurn, 16);
          else {
            encoded = null;
            partIndex++;
            setTimeout(nextPart, 16);
          }
        } catch (error) {
          encoded = null;
          vm.free(pointer);
          fail(label + " decode", error);
        }
      }
      setTimeout(decodeTurn, 16);
    }, function (error) {
      vm.free(pointer);
      fail(label + " download", error);
    });
  }
  nextPart();
}

function startBoot() {
  if (loading || ready) { stopVM(); return; }
  findFirmware();
  if (sourceMode === "local" && !firmware) return;
  var token = ++generation;
  loading = true;
  bootButton.title = "Stop";
  bootButton.enabled = true;
  terminal.clear();
  writeText("S5LBox / iPhone1,1\r\n" +
    "Direct XNU handoff, 128 MB RAM\r\n" +
    "No root filesystem is attached.\r\n\r\n");
  refreshTerminal(true);
  totalInstructions = measuredInstructions = 0;
  speedLabel.text = "";
  measuredAt = Date.now();
  setPhase("Preparing translated core");
  setTimeout(function () {
    if (token !== generation) return;
    try {
      if (!vm) {
        vm = new Runtime(uartOutput);
        vm.create();
      }
      var loadKernel = sourceMode === "local" ?
        function (done) { decodeFirmware(firmware.kernel, "kernel", token, done); } :
        function (done) { decodeRemote(REMOTE_KERNEL, KERNEL_BYTES, "kernel", token, done); };
      var loadTree = sourceMode === "local" ?
        function (done) { decodeFirmware(firmware.tree, "device tree", token, done); } :
        function (done) { decodeRemote(REMOTE_TREE, TREE_BYTES, "device tree", token, done); };
      loadKernel(function (kernelPointer, kernelSize) {
        loadTree(function (treePointer, treeSize) {
          if (token !== generation) {
            vm.free(kernelPointer); vm.free(treePointer); return;
          }
          setPhase("Constructing XNU boot state");
          setTimeout(function () {
            try {
              vm.boot(kernelPointer, kernelSize, treePointer, treeSize);
              vm.free(kernelPointer);
              vm.free(treePointer);
              loading = false;
              ready = true;
              measuredAt = Date.now();
              setPhase("XNU running");
            } catch (error) {
              vm.free(kernelPointer);
              vm.free(treePointer);
              fail("boot setup", error);
            }
          }, 16);
        });
      });
    } catch (error) {
      fail("core preparation", error);
    }
  }, 16);
}

function importLocalFirmware() {
  if (loading || ready) stopVM();
  UIAlertView.show({
    title: "Bring Your Own Firmware",
    message: "No Apple software is included. Select kernel_1A543a.macho and devicetree_m68ap.bin extracted from your legally obtained iPhone OS 1.0 restore package.",
    buttons: ["Cancel", "Choose Files"]
  }, function (choice) {
    if (choice !== 1) return;
    files.import({ types: ["*/*"], multiple: true, to: "firmware/" }, function (paths, error) {
      if (error) { fail("firmware import", error); return; }
      sourceMode = "local";
      storage.set("s5lboxSource", sourceMode);
      findFirmware(paths);
      if (!firmware) {
        UIAlertView.show({ title: "Firmware Not Recognized",
          message: "Select both the 5,888,896-byte 1A543a kernel and the 36,864-byte M68AP device tree.",
          buttons: ["OK"] });
      }
    });
  });
}

importButton.onTap = function () {
  UIActionSheet.show({ title: "Firmware Source",
    buttons: ["Download on Boot", "Import Extracted Files"], cancel: "Cancel",
    style: "blackOpaque" }, function (index, title) {
      if (title === "Download on Boot") {
        sourceMode = "remote";
        storage.set("s5lboxSource", sourceMode);
        bootButton.enabled = true;
        setPhase("Network boot ready · no root filesystem");
      } else if (title === "Import Extracted Files") importLocalFirmware();
    });
};
bootButton.onTap = startBoot;

UIApplication.run(navigation);
writeText("S5LBox kernel console\r\n\r\n" +
  "Tap Boot to download chunked firmware, or use Firmware to import local files.\r\n" +
  "Firmware and a root filesystem are not bundled in this SAPP.\r\n");
findFirmware();
refreshTerminal(true);
