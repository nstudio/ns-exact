#!/bin/zsh
# Fetches the pinned Exact and NativeScript sources and prepares the toolchain.
set -e
ROOT=${0:A:h:h}
EXACT_COMMIT=94b8671f70fe2e25b307a40e7fce66dc27c9f802
RUNTIMES_COMMIT=c68bbeff9e53d9768341b25352c842dc10e97a50

if [ ! -d $ROOT/vendor/exact/.git ]; then
  git clone https://github.com/expo/exact.git $ROOT/vendor/exact
  git -C $ROOT/vendor/exact checkout $EXACT_COMMIT
fi
(cd $ROOT/vendor/exact && bun scripts/exact.mjs setup)
rustup target add aarch64-apple-ios-sim aarch64-apple-ios --toolchain 1.97.0

if [ ! -d $ROOT/vendor/ns-runtimes/.git ]; then
  git clone --filter=blob:none --no-checkout https://github.com/NativeScript/runtimes.git $ROOT/vendor/ns-runtimes
  git -C $ROOT/vendor/ns-runtimes fetch origin $RUNTIMES_COMMIT
  git -C $ROOT/vendor/ns-runtimes sparse-checkout init --no-cone
  git -C $ROOT/vendor/ns-runtimes sparse-checkout set /NativeScript/ffi/objc/ /NativeScript/jsi/ /packages/objc-node-api/ \
    /NativeScript/libffi/iphonesimulator-universal/ /NativeScript/libffi/iphoneos-arm64/ \
    /NativeScript/libffi/macosx-universal/ /metadata-generator/include/
  git -C $ROOT/vendor/ns-runtimes checkout $RUNTIMES_COMMIT
  git -C $ROOT/vendor/ns-runtimes apply $ROOT/patches/ns-lean-globals.patch $ROOT/patches/ns-objc-extend-types.patch
fi

# scripts/nsx.mjs takes the metadata generator and symbol analyzer from
# NSX_METADATA_TOOLS, by default ns-bevy's build (its scripts/build-metadata-tools.sh).
