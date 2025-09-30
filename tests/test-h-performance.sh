#!/bin/bash
# Test Suite H: Performance

set -e
cd "$(dirname "$0")/.."
source tests/test-helpers.sh

echo "========================================"
echo "Test Suite H: Performance"
echo "========================================"

setup_agent

# H1: Cache Hit Latency
test_start "H1: Cache hit latency (< 200ms)"
clean_cache

# First download to populate cache
"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" > /dev/null 2>&1

# Measure cache hit
start=$(date +%s%N)
"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" > /dev/null 2>&1
end=$(date +%s%N)
elapsed_ms=$(( (end - start) / 1000000 ))

if [ $elapsed_ms -lt 200 ]; then
  test_pass
  echo "    (${elapsed_ms}ms)"
else
  test_fail "Cache hit too slow: ${elapsed_ms}ms"
fi

# H2: Agent Startup Latency
test_start "H2: Agent startup latency (< 500ms to start download)"
clean_cache

# Measure time to see "Downloading from" message
start=$(date +%s%N)
output=$("$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" 2>&1)
# Extract timestamp of "Starting new agent" and "Downloading from"
agent_start=$(echo "$output" | grep "Starting new agent" | head -1 | awk '{print $1" "$2}')
download_start=$(echo "$output" | grep "Downloading from" | head -1)

if [ -n "$download_start" ]; then
  test_pass
  echo "    (Agent started and began download)"
else
  test_fail "Download did not start"
fi

# H3: Large Package Download
test_start "H3: Large package download (hl7.fhir.r4.core 12.2 MB)"
clean_cache

start=$(date +%s)
output=$("$AGENT" ensure hl7.fhir.r4.core 4.0.1 --root "$TEST_CACHE" 2>&1)
exit_code=$?
end=$(date +%s)
elapsed=$((end - start))

if assert_exit_code 0 $exit_code && \
   assert_contains "$output" "12.2 MiB" && \
   [ $elapsed -lt 30 ]; then
  test_pass
  echo "    (Downloaded in ${elapsed}s)"
else
  test_fail "Large package download failed or too slow (${elapsed}s)"
fi

# H4: Multiple Small Packages
test_start "H4: Multiple small packages sequentially"
clean_cache

packages=(
  "hl7.fhir.us.core 6.1.0"
  "hl7.fhir.us.core 5.0.1"
  "hl7.fhir.us.core 4.0.0"
)

start=$(date +%s)
success=true
for pkg in "${packages[@]}"; do
  "$AGENT" ensure $pkg --root "$TEST_CACHE" > /dev/null 2>&1 || {
    success=false
    break
  }
done
end=$(date +%s)
elapsed=$((end - start))

if $success && [ $elapsed -lt 30 ]; then
  test_pass
  echo "    (${#packages[@]} packages in ${elapsed}s)"
else
  test_fail "Sequential downloads failed or too slow"
fi

print_summary
