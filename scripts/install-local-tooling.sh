#!/bin/sh
set -eu

SPR018_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SPR018_TOOLS="$SPR018_ROOT/.tools"
SPR018_TEMP="${TMPDIR:-/tmp}/smart-guard-spr018"
mkdir -p "$SPR018_TOOLS" "$SPR018_TEMP"

if [ ! -x "$SPR018_TOOLS/jdk/Contents/Home/bin/java" ]; then
  curl --fail --location --retry 3 \
    "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse" \
    --output "$SPR018_TEMP/jdk.tar.gz"
  mkdir -p "$SPR018_TEMP/jdk-extract"
  tar -xzf "$SPR018_TEMP/jdk.tar.gz" -C "$SPR018_TEMP/jdk-extract"
  SPR018_JDK=$(find "$SPR018_TEMP/jdk-extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  if [ -z "$SPR018_JDK" ]; then
    echo "JDK archive did not contain a directory." >&2
    exit 1
  fi
  mv "$SPR018_JDK" "$SPR018_TOOLS/jdk"
fi

if [ ! -x "$SPR018_TOOLS/google-cloud-sdk/bin/gcloud" ]; then
  curl --fail --location --retry 3 \
    "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-514.0.0-darwin-arm.tar.gz" \
    --output "$SPR018_TEMP/google-cloud-cli.tar.gz"
  tar -xzf "$SPR018_TEMP/google-cloud-cli.tar.gz" -C "$SPR018_TOOLS"
fi

. "$SPR018_ROOT/scripts/tool-env.sh"
java -version
gcloud --version
