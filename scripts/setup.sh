#!/bin/zsh
# Fetches the pinned Exact and NativeScript sources, and builds NativeScript's metadata tools from them.
set -e
ROOT=${0:A:h:h}
EXACT_COMMIT=94b8671f70fe2e25b307a40e7fce66dc27c9f802
RUNTIMES_COMMIT=c68bbeff9e53d9768341b25352c842dc10e97a50
# The binary metadata comes from this older generator: it keeps the categories of the classes a release
# build retains (UIColor's system colours), which the newer one's whitelist drops.
GENERATOR_V1_COMMIT=3549e1989e20d8b80c6308bc82856e15eb5b84d0
TOOLS=$ROOT/.gen/metadata-tools

if [ ! -d $ROOT/vendor/exact/.git ]; then
  git clone https://github.com/expo/exact.git $ROOT/vendor/exact
  git -C $ROOT/vendor/exact checkout $EXACT_COMMIT
fi
# Exact's setup names everything a host lacks and exits non-zero for any of it, Chrome for its web tests included;
# the Apple builds here need only Xcode and its Hermes bundles, which it reports above.
(cd $ROOT/vendor/exact && bun scripts/exact.mjs setup) || echo "setup.sh: exact setup reported what this Mac lacks; continuing"

rustup target add aarch64-apple-ios-sim aarch64-apple-ios --toolchain 1.97.0

if [ ! -d $ROOT/vendor/ns-runtimes/.git ]; then
  git clone --filter=blob:none --no-checkout https://github.com/NativeScript/runtimes.git $ROOT/vendor/ns-runtimes
  git -C $ROOT/vendor/ns-runtimes fetch origin $RUNTIMES_COMMIT
  git -C $ROOT/vendor/ns-runtimes sparse-checkout init --no-cone
  git -C $ROOT/vendor/ns-runtimes sparse-checkout set /NativeScript/ffi/objc/ /NativeScript/jsi/ /packages/objc-node-api/ \
    /NativeScript/libffi/iphonesimulator-universal/ /NativeScript/libffi/iphoneos-arm64/ \
    /NativeScript/libffi/macosx-universal/ /metadata-generator/
  git -C $ROOT/vendor/ns-runtimes checkout $RUNTIMES_COMMIT
  git -C $ROOT/vendor/ns-runtimes apply $ROOT/patches/ns-lean-globals.patch $ROOT/patches/ns-objc-extend-types.patch
fi
git -C $ROOT/vendor/ns-runtimes sparse-checkout add /metadata-generator/

if [ ! -d $ROOT/vendor/ns-metadata-generator-v1/.git ]; then
  git clone --filter=blob:none --no-checkout https://github.com/NativeScript/runtimes.git $ROOT/vendor/ns-metadata-generator-v1
  git -C $ROOT/vendor/ns-metadata-generator-v1 fetch origin $GENERATOR_V1_COMMIT
  git -C $ROOT/vendor/ns-metadata-generator-v1 sparse-checkout init --no-cone
  git -C $ROOT/vendor/ns-metadata-generator-v1 sparse-checkout set /metadata-generator/
  git -C $ROOT/vendor/ns-metadata-generator-v1 checkout $GENERATOR_V1_COMMIT
  git -C $ROOT/vendor/ns-metadata-generator-v1 apply $ROOT/patches/ns-runtimes-metadata-filter.patch
fi

# The generators link Xcode's libclang, so they need CMake and nothing else; the analyzer is a Cargo crate.
generator() {
  [ -x $2/bin/objc-metadata-generator ] && return
  cmake -S $1/metadata-generator -B $2 -DCMAKE_BUILD_TYPE=Release -DMETADATA_BINARY_ARCH=arm64 -DCMAKE_OSX_ARCHITECTURES=arm64
  cmake --build $2 -j$(sysctl -n hw.ncpu)
}
generator $ROOT/vendor/ns-runtimes $TOOLS/build
generator $ROOT/vendor/ns-metadata-generator-v1 $TOOLS/build-v1
[ -x $TOOLS/analyzer/release/ns-metadata-symbols ] || cargo +stable build --locked --release \
  --manifest-path $ROOT/vendor/ns-runtimes/metadata-generator/symbol-analyzer/Cargo.toml --target-dir $TOOLS/analyzer
echo "metadata tools: $TOOLS"
