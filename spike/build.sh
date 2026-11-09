#!/bin/zsh
# Runs NativeScript's JSI bridge in Exact's lean Hermes, outside any app, on macOS:
# once as a VM of its own, once under Exact's hardening. The second is expected to fail.
set -e
S=${0:A:h}; ROOT=${S:h}; OUT=$ROOT/.gen/spike; mkdir -p $OUT
H=$HOME/.cargo/hermes-lean-sys/hermes-vanilla-d412d3bd8512-v5/bc71c7b398f1d41a5390761b75ce72e7be234aa48cb1ddec947224188ed6a4f2
NS=$ROOT/vendor/ns-runtimes
TOOLS=${NSX_METADATA_TOOLS:-$ROOT/../ns-bevy/rt/metadata-tools}
SDK=$(xcrun --sdk macosx --show-sdk-path)
HC=($H/bin/hermesc -O -emit-async-break-check -Xes6-block-scoping -emit-binary -w)
INC=(-I$H/include -I$NS/NativeScript -I$NS/metadata-generator/include -I$NS/NativeScript/libffi/macosx-universal/include -I$NS)
DEF=(-DTARGET_ENGINE_HERMES=1 -DNS_GSD_BACKEND_HERMES=0 -DNATIVESCRIPT_REACT_NATIVE=1 -DNDEBUG)
FL=(-isysroot $SDK -std=c++20 -stdlib=libc++ -fno-objc-arc -Os -g0 -fexceptions -frtti -w -arch arm64 -mmacosx-version-min=14.0)

python3 -I -c "
import re,sys
s=open('$NS/NativeScript/ffi/objc/shared/bridge/Install.mm').read()
open('$OUT/globals.js','w').write(re.search(r'R\"Engine_GLOBALS\((.*?)\)Engine_GLOBALS\"',s,re.S).group(1)+'(\"__nativeScriptNativeApi\");\n')"
$HC -out $OUT/globals.hbc $OUT/globals.js
$HC -out $OUT/harden.hbc $ROOT/vendor/exact/vendor/ibex/crates/ibex2/src/bindings/harden.js
$HC -out $OUT/test.hbc $S/js/test.js
[ -f $OUT/metadata.nsmd ] || $TOOLS/build-v1/bin/objc-metadata-generator -output-bin $OUT/metadata.nsmd -output-umbrella $OUT/umbrella.h \
  Xclang -isysroot $SDK -std=gnu99 -target arm64-apple-macos14.0 > $OUT/metadata.log 2>&1
clang++ $FL $DEF $INC -c $NS/NativeScript/ffi/objc/hermes/NativeApiJsi.mm -o $OUT/bridge.o
clang++ $FL $DEF $INC -c $S/bin/spike.mm -o $OUT/spike.o
clang++ $FL $OUT/spike.o $OUT/bridge.o $NS/NativeScript/libffi/macosx-universal/libffi.a $H/lib/libhermesvmlean_a.a $H/lib/libjsi.a $H/lib/libboost_context.a \
  -framework Foundation -framework CoreFoundation -framework AppKit -framework Security -licucore -o $OUT/spike
export SPIKE_GLOBALS_HBC=$OUT/globals.hbc SPIKE_HARDEN_HBC=$OUT/harden.hbc
echo '--- own VM'; $OUT/spike $OUT/metadata.nsmd $OUT/test.hbc plain || true
echo '--- under hardening'; $OUT/spike $OUT/metadata.nsmd $OUT/test.hbc plain+harden || true
