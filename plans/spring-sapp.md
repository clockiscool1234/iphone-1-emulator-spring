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
translation, changes the fixed Emscripten heap from 512 MB to 128 MB, and adds
the CommonJS export Spring's `require` expects.

The Spring host:

- allocates 64 MB of emulated DRAM, which is sufficient for this no-rootfs
  kernel milestone and reduces Spring's synchronous boot-setup turn;
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
device tree, 64 MB guest RAM, and no rootfs. It emitted the genuine serial
banner and continued through VM initialization:

```text
Darwin Kernel Version 9.0.0d1: Tue May 22 21:15:55 PDT 2007; root:xnu-933.0.0.178.obj~3/RELEASE_ARM_S5L8900XRB
standard timeslicing quantum is 10000 us
vm_page_bootstrap: 12300 free pages and 4084 wired pages
mig_table_max_displ = 79
iBoot version:
```

The Node proof reached 20,000,000 guest instructions with CPU status `ARM_OK`.
Measured speed on this host was about 1.16 MIPS for the wasm2js interpreter.
Actual Spring/Android performance remains device-dependent and must be checked
on a phone.

### Device correction: build 2

The first phone run reached “Constructing XNU boot state” but Spring ended its
timer turn after `emu_init` exceeded the one-second limit. It also demonstrated
why every installable revision needs a higher manifest build: an already
installed build 1 could retain the earlier pre-fork firmware URL and report 404
even after a corrected build-1 package was copied over it.

Build 2 uses 64 MB guest RAM and a 128 MB translated heap instead of 128/192 MB,
and identifies itself as version 0.2 so Spring installs it as an update. The
64 MB configuration reaches `vm_page_bootstrap` and MIG initialization through
12 million instructions with `ARM_OK` in the host verification. Whether the
reduced setup completes within one second on the reported Android phone remains
to be confirmed on-device.

### QuickJS throughput correction: build 3

The build-2 phone reports roughly 90–120 KIPS. A native QuickJS reproduction
confirms that this is execution-engine cost rather than only rendering: the
original wasm2js output runs the measured cold-kernel million at 66–69 KIPS.

Build 3 runs Binaryen `-O3` while translating the core. The result shrinks from
2.85 MB to about 1.77 MB and executes the same native-QuickJS workload at
117–118 KIPS, about 1.7 times baseline. It also changes the Spring scheduler
from 30 updates with an 18 ms CPU budget per second to 10 updates with a 90 ms
budget, raises the per-turn instruction ceiling, refreshes the terminal at most
twice a second, and changes status text once a second rather than every frame.
The nominal emulation duty rises from 54% to 90% while each turn remains far
below Spring's one-second limit.

The existing browser seed compiler was evaluated as a second accelerator. The
16 hottest retained cold-boot regions cover about 5.0 million of the first 12
million guest instructions, but their 1.6 MB wasm2js translation did not improve
the first million and improved a later measured phase by only about 14%. It is
not shipped. Reaching sustained MIPS in QuickJS likely requires a purpose-built
JavaScript block translator or WebAssembly/native execution support in Spring;
build 3 is expected to improve the phone by roughly 2.5–3 times, not 10 times.
