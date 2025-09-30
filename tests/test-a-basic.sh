#!/bin/bash
# Test Suite A: Basic Functionality

set -e
cd "$(dirname "$0")/.."
source tests/test-helpers.sh

echo "========================================"
echo "Test Suite A: Basic Functionality"
echo "========================================"

setup_agent

# A1: Single Package Download (Cache Miss)
test_start "A1: Single package download (cache miss)"
clean_cache
output=$("$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" 2>&1)
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_dir_exists "$TEST_CACHE/packages/hl7.fhir.us.core#6.1.0" && \
   assert_file_exists "$TEST_CACHE/packages/hl7.fhir.us.core#6.1.0/package.json" && \
   assert_contains "$output" '"path"'; then
  test_pass
else
  test_fail "Cache miss download failed"
fi

# A2: Package Already Cached (Cache Hit)
test_start "A2: Package already cached (cache hit)"
start_time=$(date +%s%N)
output=$("$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" 2>&1)
exit_code=$?
end_time=$(date +%s%N)
elapsed_ms=$(( (end_time - start_time) / 1000000 ))

if assert_exit_code 0 $exit_code && \
   [ $elapsed_ms -lt 200 ] && \
   assert_contains "$output" '"phase":"hit"'; then
  test_pass
  echo "    (Completed in ${elapsed_ms}ms)"
else
  test_fail "Cache hit failed or too slow (${elapsed_ms}ms)"
fi

# A3: Package Not Found
test_start "A3: Package not found"
output=$(timeout 10 "$AGENT" ensure nonexistent.package 99.99.99 --root "$TEST_CACHE" 2>&1 || true)
exit_code=$?

if assert_exit_code 1 $exit_code && \
   assert_contains "$output" '"error"' && \
   assert_contains "$output" "Could not resolve tarball"; then
  # Check no staging dirs left behind
  staging_count=$(count_files "$TEST_CACHE/packages/*.tmp-*")
  if [ "$staging_count" -eq 0 ]; then
    test_pass
  else
    test_fail "Staging directories left behind: $staging_count"
  fi
else
  test_fail "Package not found handling incorrect"
fi

# A4: Multiple Packages Sequentially
test_start "A4: Multiple packages sequentially"
clean_cache

exit1=0
exit2=0
exit3=0

"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" > /dev/null 2>&1 || exit1=$?
"$AGENT" ensure hl7.fhir.r4.core 4.0.1 --root "$TEST_CACHE" > /dev/null 2>&1 || exit2=$?
"$AGENT" ensure hl7.fhir.r5.core 5.0.0 --root "$TEST_CACHE" > /dev/null 2>&1 || exit3=$?

if [ $exit1 -eq 0 ] && [ $exit2 -eq 0 ] && [ $exit3 -eq 0 ] && \
   assert_dir_exists "$TEST_CACHE/packages/hl7.fhir.us.core#6.1.0" && \
   assert_dir_exists "$TEST_CACHE/packages/hl7.fhir.r4.core#4.0.1" && \
   assert_dir_exists "$TEST_CACHE/packages/hl7.fhir.r5.core#5.0.0"; then
  test_pass
else
  test_fail "Sequential downloads failed"
fi

print_summary
