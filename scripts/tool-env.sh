#!/bin/sh
SPR018_ROOT=$(pwd)
if [ -d "$SPR018_ROOT/.tools/jdk/Contents/Home" ]; then
  JAVA_HOME="$SPR018_ROOT/.tools/jdk/Contents/Home"
  export JAVA_HOME
  PATH="$JAVA_HOME/bin:$PATH"
fi
if [ -d "$SPR018_ROOT/.tools/google-cloud-sdk/bin" ]; then
  PATH="$SPR018_ROOT/.tools/google-cloud-sdk/bin:$PATH"
  CLOUDSDK_CONFIG="$SPR018_ROOT/.tools/gcloud-config"
  export CLOUDSDK_CONFIG
fi
export PATH
