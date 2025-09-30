#!/bin/bash
# Test helper functions

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Agent binary path
AGENT="${AGENT:-./bin/fhir-package-agent}"

# Test cache directory
TEST_CACHE="${TEST_CACHE:-./test-cache}"

# Setup: build agent if needed
setup_agent() {
  if [ ! -f "$AGENT" ]; then
    echo "Building agent..."
    dotnet build fhir-package-agent.csproj -o bin > /dev/null 2>&1 || {
      echo -e "${RED}Failed to build agent${NC}"
      exit 1
    }
  fi
}

# Clean test cache
clean_cache() {
  rm -rf "$TEST_CACHE"
}

# Start a test
test_start() {
  local name="$1"
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "  Testing: $name... "
}

# Pass a test
test_pass() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo -e "${GREEN}PASS${NC}"
}

# Fail a test
test_fail() {
  local reason="$1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo -e "${RED}FAIL${NC}"
  if [ -n "$reason" ]; then
    echo -e "    ${RED}Reason: $reason${NC}"
  fi
}

# Assert exit code
assert_exit_code() {
  local expected="$1"
  local actual="$2"
  if [ "$actual" -eq "$expected" ]; then
    return 0
  else
    echo "Expected exit code $expected, got $actual"
    return 1
  fi
}

# Assert file exists
assert_file_exists() {
  local file="$1"
  if [ -f "$file" ]; then
    return 0
  else
    echo "File does not exist: $file"
    return 1
  fi
}

# Assert directory exists
assert_dir_exists() {
  local dir="$1"
  if [ -d "$dir" ]; then
    return 0
  else
    echo "Directory does not exist: $dir"
    return 1
  fi
}

# Assert file does not exist
assert_file_not_exists() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 0
  else
    echo "File should not exist: $file"
    return 1
  fi
}

# Assert directory does not exist
assert_dir_not_exists() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    return 0
  else
    echo "Directory should not exist: $dir"
    return 1
  fi
}

# Assert string contains
assert_contains() {
  local haystack="$1"
  local needle="$2"
  if echo "$haystack" | grep -q "$needle"; then
    return 0
  else
    echo "String does not contain: $needle"
    return 1
  fi
}

# Assert JSON field equals
assert_json_field() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local actual=$(echo "$json" | jq -r ".$field" 2>/dev/null)
  if [ "$actual" = "$expected" ]; then
    return 0
  else
    echo "JSON field $field: expected '$expected', got '$actual'"
    return 1
  fi
}

# Run agent with timeout
run_agent_with_timeout() {
  local timeout="$1"
  shift
  timeout "$timeout" "$AGENT" "$@"
  return $?
}

# Wait for file to exist
wait_for_file() {
  local file="$1"
  local max_wait="${2:-10}"
  local waited=0
  while [ ! -f "$file" ] && [ $waited -lt $max_wait ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  [ -f "$file" ]
}

# Wait for directory to exist
wait_for_dir() {
  local dir="$1"
  local max_wait="${2:-10}"
  local waited=0
  while [ ! -d "$dir" ] && [ $waited -lt $max_wait ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  [ -d "$dir" ]
}

# Count files matching pattern
count_files() {
  local pattern="$1"
  ls -1 $pattern 2>/dev/null | wc -l
}

# Print test summary
print_summary() {
  echo ""
  echo "========================================"
  echo "Test Summary"
  echo "========================================"
  echo "Total:  $TESTS_RUN"
  echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
  echo "========================================"

  if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    return 0
  else
    echo -e "${RED}Some tests failed${NC}"
    return 1
  fi
}

# Measure execution time
time_command() {
  local start=$(date +%s%N)
  "$@"
  local exit_code=$?
  local end=$(date +%s%N)
  local elapsed=$(( (end - start) / 1000000 ))
  echo "$elapsed"
  return $exit_code
}
