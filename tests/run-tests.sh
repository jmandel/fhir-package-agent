#!/bin/bash
# Main Test Runner

set -e
cd "$(dirname "$0")/.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================"
echo "FHIR Package Agent Test Suite"
echo -e "========================================${NC}"
echo ""

# Build agent first
echo "Building agent..."
if dotnet build fhir-package-agent.csproj -o bin -v quiet > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Build successful${NC}"
else
  echo -e "${RED}✗ Build failed${NC}"
  exit 1
fi
echo ""

# Track overall results
SUITES_RUN=0
SUITES_PASSED=0
SUITES_FAILED=0

# Run test suite
run_suite() {
  local suite_script="$1"
  local suite_name="$2"

  SUITES_RUN=$((SUITES_RUN + 1))

  echo -e "${BLUE}Running: $suite_name${NC}"

  if bash "$suite_script"; then
    SUITES_PASSED=$((SUITES_PASSED + 1))
    echo ""
  else
    SUITES_FAILED=$((SUITES_FAILED + 1))
    echo -e "${RED}Suite failed: $suite_name${NC}"
    echo ""
    return 1
  fi
}

# Run all test suites
run_suite "tests/test-a-basic.sh" "Basic Functionality" || true
run_suite "tests/test-b-concurrency.sh" "Concurrency" || true
run_suite "tests/test-c-lifecycle.sh" "Agent Lifecycle" || true
run_suite "tests/test-f-cli.sh" "CLI & Configuration" || true
run_suite "tests/test-h-performance.sh" "Performance" || true

# Overall summary
echo ""
echo -e "${BLUE}========================================"
echo "Overall Test Summary"
echo -e "========================================${NC}"
echo "Test Suites Run:    $SUITES_RUN"
echo -e "Test Suites Passed: ${GREEN}$SUITES_PASSED${NC}"
echo -e "Test Suites Failed: ${RED}$SUITES_FAILED${NC}"
echo -e "${BLUE}========================================${NC}"

# Cleanup
echo ""
echo "Cleaning up test artifacts..."
rm -rf test-cache test-cache-2

if [ $SUITES_FAILED -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✓ All test suites passed!${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}✗ Some test suites failed${NC}"
  exit 1
fi
