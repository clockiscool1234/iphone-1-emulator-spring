# Spring SAPP kernel-console port

## Scope

This proof of concept ports the existing browser emulator core to a Spring app
without bundling Apple firmware. It boots the genuine iPhone OS 1.0 `1A543a`
kernel through the existing direct-XNU handoff and displays UART0. It does not
attach a root filesystem and does not display the guest framebuffer.

The app source is `spring/s5lbox-kernel/`, and the ready-to-install package is
`spring/S5LBox-Kernel.sapp`.
By default the app fetches text-only base64 chunks from the repository's direct
`raw.githubusercontent.com` host. Users can instead import their own
`kernel_1A543a.macho` and `devicetree_m68ap.bin` through Spring's file picker.

## Architecture

Spring's QuickJS sandbox has no WebAssembly or native-code API. Binaryen
`wasm2js` 132.0.0 translates the committed `web/dist/emu.wasm` to a 2.85 MB
plain-JavaScript module. `tools/build-spring-sapp-core.py` performs that
translation, changes the fixed Emscripten heap from 512 MB to 192 MB, and adds
the CommonJS export Spring's `require` expects.

The Spring host:

- allocates 128 MB of emulated DRAM;
- decodes imported base64 firmware into the translated C heap in 128 KiB turns;
- downloads each network chunk as text through Spring `fetch` and decodes it
  directly into the translated C heap;
- calls `emu_init` with no ramdisk and the M68 board;
- runs bounded CPU slices from a 30 fps `UIGameView` callback;
- drains `emu_serial_read` into an 80-column bitmap terminal;
- regenerates that terminal as a small indexed PNG in the app's `files/` folder.

The bitmap path is necessary because Spring runtime 10 has no raw-pixel canvas.
It follows the established `apps/Linux.sapp` terminal approach. A framebuffer
port would need native Spring support for mutable pixel buffers or would have to
encode whole PNG frames in JavaScript, which is not suitable for interactive
scanout.

The ordinary binary firmware URLs cannot be fetched by a Spring app: responses
are limited to 5 MB and only `text()`/`json()` are exposed. The generated files
under `web/firmware/spring/` are base64 text split at 4,000,000 characters, so
every response remains below that limit. The app uses `raw.githubusercontent.com`
directly because Spring does not follow redirects.

The app downloads these chunks directly from:

```text
https://raw.githubusercontent.com/clockiscool1234/iphone-1-emulator-spring/main/web/firmware/spring/
```

The URL becomes available once these files are pushed to the fork's `main`
branch. Local file import remains available as an offline fallback.

## Rebuilding

From `work/iphone-1-emulator` after rebuilding `web/dist/emu.wasm`:

```bash
npm install --prefix /tmp/opencode/wasm2js binaryen@132.0.0
python3 tools/build-spring-sapp-core.py \
  --wasm2js /tmp/opencode/wasm2js/node_modules/.bin/wasm2js
python3 tools/firmware/build_spring_chunks.py
```

Then validate and package from the SDK root:

```bash
python3 ../../tools/spring_pack.py check spring/s5lbox-kernel
python3 ../../tools/spring_pack.py pack spring/s5lbox-kernel -o spring/S5LBox-Kernel.sapp
```

## Verification

The translated core was exercised under Node with the local 1A543a kernel and
device tree, 128 MB guest RAM, and no rootfs. It emitted the genuine serial
banner and continued through VM initialization:

```text
Darwin Kernel Version 9.0.0d1: Tue May 22 21:15:55 PDT 2007; root:xnu-933.0.0.178.obj~3/RELEASE_ARM_S5L8900XRB
standard timeslicing quantum is 10000 us
vm_page_bootstrap: 28461 free pages and 4307 wired pages
mig_table_max_displ = 79
iBoot version:
```

The Node proof reached 20,000,000 guest instructions with CPU status `ARM_OK`.
Measured speed on this host was about 1.16 MIPS for the wasm2js interpreter.
Actual Spring/Android performance remains device-dependent and must be checked
on a phone.
