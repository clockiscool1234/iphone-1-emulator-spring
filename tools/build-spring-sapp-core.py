#!/usr/bin/env python3
"""Translate the committed browser core into the Spring sample's plain JS core."""

import argparse
import pathlib
import subprocess
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "spring" / "s5lbox-kernel" / "scripts" / "s5lbox_core.js"
HEADER = """/*
 * Generated from work/iphone-1-emulator/web/dist/emu.wasm with Binaryen
 * wasm2js 132.0.0. Source: https://github.com/kelindi/iphone-1
 * GPL-2.0-or-later; see assets/GPL-2.0.txt. Do not edit by hand.
 */
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wasm2js", default="wasm2js",
                        help="Binaryen wasm2js executable (version 132.0.0)")
    parser.add_argument("-o", "--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source = ROOT / "web" / "dist" / "emu.wasm"
    with tempfile.TemporaryDirectory() as directory:
        translated = pathlib.Path(directory) / "core.js"
        subprocess.run([args.wasm2js, str(source), "--emscripten", "--all-features",
                        "-o", str(translated)], check=True)
        text = translated.read_text()
    old = "new ArrayBuffer(536870912)"
    if text.count(old) != 1:
        raise SystemExit("unexpected wasm2js memory declaration")
    # The no-rootfs SAPP uses 64 MB of guest RAM. A 128 MB translated heap
    # leaves room for EDRAM, input firmware, the C heap and the 4 MB stack while
    # avoiding the one-turn cost of allocating the browser build's 512 MB heap.
    text = text.replace(old, "new ArrayBuffer(134217728)")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(HEADER + text + "\nmodule.exports = instantiate;\n")
    print(args.output)


if __name__ == "__main__":
    main()
