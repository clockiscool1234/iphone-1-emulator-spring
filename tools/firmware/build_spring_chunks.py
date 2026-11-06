#!/usr/bin/env python3
"""Make text-only firmware chunks that fit Spring fetch's 5 MB limit."""

import base64
import hashlib
import json
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[2]
FIRMWARE = ROOT / "web" / "firmware"
OUTPUT = FIRMWARE / "spring"
CHARS_PER_PART = 4_000_000  # Multiple of four and safely below 5 MiB.


def encode(name):
    source = FIRMWARE / name
    data = source.read_bytes()
    encoded = base64.b64encode(data).decode("ascii")
    parts = []
    for index, start in enumerate(range(0, len(encoded), CHARS_PER_PART)):
        part_name = f"{name}.b64.part{index}"
        (OUTPUT / part_name).write_text(encoded[start:start + CHARS_PER_PART])
        parts.append(part_name)
    return {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "parts": parts,
    }


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "format": 1,
        "encoding": "base64",
        "maxPartChars": CHARS_PER_PART,
        "kernel": encode("kernel_1A543a.macho"),
        "devicetree": encode("devicetree_m68ap.bin"),
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(OUTPUT / "manifest.json")


if __name__ == "__main__":
    main()
