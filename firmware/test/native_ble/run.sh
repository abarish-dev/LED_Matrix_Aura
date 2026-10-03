#!/usr/bin/env bash
# Native test of the BLE config path. Needs a C++17 compiler; on the box we use
# zig's (pip install ziglang). Usage: test/native_ble/run.sh [python-with-ziglang]
set -euo pipefail
cd "$(dirname "$0")"
PY=${1:-python3}
CXX="$PY -m ziglang c++"
INC="-I stubs -I ../../include -I ../../.pio/libdeps/adafruit_matrixportal_esp32s3/ArduinoJson/src"
FLAGS="-std=c++17 -g -O1 -DARDUINOJSON_ENABLE_ARDUINO_STRING=1 -Wno-deprecated-declarations"
echo "== current firmware (queued BLE frames), ThreadSanitizer"
$CXX $FLAGS -fsanitize=thread $INC test_ble.cpp -o /tmp/test_ble_new
TSAN_OPTIONS="halt_on_error=1" /tmp/test_ble_new
if [ "${OLD_REF:-}" != "" ]; then
  echo "== $OLD_REF firmware (applied inside the BLE callback), ThreadSanitizer"
  mkdir -p /tmp/old_ble && git show "$OLD_REF:firmware/include/BleProvisioning.h" > /tmp/old_ble/BleProvisioning.h
  $CXX $FLAGS -DOLD -fsanitize=thread -I /tmp/old_ble $INC test_ble.cpp -o /tmp/test_ble_old
  TSAN_OPTIONS="halt_on_error=0" /tmp/test_ble_old 2>&1 | grep -E "WARNING: ThreadSanitizer|SUMMARY|PASS" | sort | uniq -c || true
fi
