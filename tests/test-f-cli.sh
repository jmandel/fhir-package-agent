#!/bin/bash
# Test Suite F: CLI & Configuration

set -e
cd "$(dirname "$0")/.."
source tests/test-helpers.sh

echo "========================================"
echo "Test Suite F: CLI & Configuration"
echo "========================================"

setup_agent

# F1: Custom Cache Root
test_start "F1: Custom cache root"
custom_root="/tmp/fhir-test-custom-$$"
rm -rf "$custom_root"

"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$custom_root" > /dev/null 2>&1
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_dir_exists "$custom_root/packages/hl7.fhir.us.core#6.1.0"; then
  test_pass
  rm -rf "$custom_root"
else
  test_fail "Custom root not used"
  rm -rf "$custom_root"
fi

# F3: Preserve Tarballs
test_start "F3: Preserve tarballs"
clean_cache

"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" --preserve-tar > /dev/null 2>&1
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_file_exists "$TEST_CACHE/packages/hl7.fhir.us.core#6.1.0/package.tgz"; then
  test_pass
else
  test_fail "Tarball not preserved"
fi

# F4: Debug Logging
test_start "F4: Debug logging"
clean_cache

output=$("$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" --log-level Debug 2>&1)
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_contains "$output" "DBG"; then
  test_pass
else
  test_fail "Debug logging not enabled"
fi

# F6: Help Text
test_start "F6: Help text"
output=$("$AGENT" --help 2>&1)
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_contains "$output" "USAGE" && \
   assert_contains "$output" "OPTIONS"; then
  test_pass
else
  test_fail "Help text not displayed"
fi

# F7: No Arguments
test_start "F7: No arguments (shows help)"
output=$("$AGENT" 2>&1)
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_contains "$output" "USAGE"; then
  test_pass
else
  test_fail "No arguments did not show help"
fi

# F8: Invalid Arguments
test_start "F8: Invalid arguments"
set +e
output=$("$AGENT" invalid-command 2>&1)
exit_code=$?
set -e

if assert_exit_code 2 $exit_code && \
   assert_contains "$output" "USAGE"; then
  test_pass
else
  test_fail "Invalid arguments not handled (exit: $exit_code)"
fi

print_summary
