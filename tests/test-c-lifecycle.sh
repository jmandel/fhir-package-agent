#!/bin/bash
# Test Suite C: Agent Lifecycle

set -e
cd "$(dirname "$0")/.."
source tests/test-helpers.sh

echo "========================================"
echo "Test Suite C: Agent Lifecycle"
echo "========================================"

setup_agent

# C1: Agent Auto-Start
test_start "C1: Agent auto-start"
clean_cache

output=$("$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" 2>&1)
exit_code=$?

if assert_exit_code 0 $exit_code && \
   assert_contains "$output" "Starting new agent instance"; then
  test_pass
else
  test_fail "Agent did not auto-start"
fi

# C2: Agent Auto-Shutdown
test_start "C2: Agent auto-shutdown"
clean_cache

# Run a quick ensure and check it returns promptly
start=$(date +%s)
"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" > /dev/null 2>&1
end=$(date +%s)
elapsed=$((end - start))

# Should complete within reasonable time (agent exits quickly after work done)
if [ $elapsed -lt 15 ]; then
  test_pass
  echo "    (Completed in ${elapsed}s)"
else
  test_fail "Agent took too long to shutdown ($elapsed seconds)"
fi

# C3: Multiple Cache Roots = Different Agents
test_start "C3: Multiple cache roots (different lock pipes)"
clean_cache
rm -rf test-cache-2

mkdir -p "$TEST_CACHE" test-cache-2
logfile1="$TEST_CACHE/c3-log1.txt"
logfile2="test-cache-2/c3-log2.txt"

"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" --log-level Debug > "$logfile1" 2>&1 &
"$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "test-cache-2" --log-level Debug > "$logfile2" 2>&1 &
wait

# Extract pipe names from logs
pipe1=$(grep -o 'pipe=fhir-ig-agent-[^)]*' "$logfile1" | head -1 || true)
pipe2=$(grep -o 'pipe=fhir-ig-agent-[^)]*' "$logfile2" | head -1 || true)

if [ -n "$pipe1" ] && [ -n "$pipe2" ] && [ "$pipe1" != "$pipe2" ]; then
  test_pass
  echo "    (Pipe1: $pipe1)"
  echo "    (Pipe2: $pipe2)"
else
  test_fail "Did not create different pipes for different roots"
fi

rm -rf test-cache-2

print_summary
