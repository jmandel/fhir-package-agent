#!/bin/bash
# Test Suite B: Concurrency

set -e
cd "$(dirname "$0")/.."
source tests/test-helpers.sh

echo "========================================"
echo "Test Suite B: Concurrency"
echo "========================================"

setup_agent

# B1: Concurrent Identical Requests (Deduplication)
test_start "B1: Concurrent identical requests (deduplication)"
clean_cache

# Launch 10 parallel requests
logfile="$TEST_CACHE/b1-logs.txt"
mkdir -p "$TEST_CACHE"
for i in {1..10}; do
  "$AGENT" ensure hl7.fhir.us.core 6.1.0 --root "$TEST_CACHE" 2>&1 | tee -a "$logfile" &
done
wait

# Count unique agents started (should be 1)
agent_count=$(grep -c "Agent started" "$logfile" || true)
# Check all succeeded
success_count=$(grep -c '"path"' "$logfile" || true)
# Check only one package directory
dir_count=$(count_files "$TEST_CACHE/packages/hl7.fhir.us.core#6.1.0")

if [ "$agent_count" -eq 1 ] && [ "$success_count" -eq 10 ] && [ "$dir_count" -eq 1 ]; then
  test_pass
  echo "    (Agents: $agent_count, Successes: $success_count)"
else
  test_fail "Deduplication failed (agents: $agent_count, successes: $success_count, dirs: $dir_count)"
fi

# B2: Concurrent Different Requests (Parallelism)
test_start "B2: Concurrent different requests (parallelism)"
clean_cache

packages=(
  "hl7.fhir.us.core 6.1.0"
  "hl7.fhir.r4.core 4.0.1"
  "hl7.fhir.r5.core 5.0.0"
)

for pkg in "${packages[@]}"; do
  "$AGENT" ensure $pkg --root "$TEST_CACHE" --max 3 > /dev/null 2>&1 &
done
wait

success=true
for pkg in "${packages[@]}"; do
  id=$(echo $pkg | cut -d' ' -f1)
  ver=$(echo $pkg | cut -d' ' -f2)
  key="${id}#${ver}"
  if ! assert_dir_exists "$TEST_CACHE/packages/$key" > /dev/null 2>&1; then
    success=false
    break
  fi
done

if $success; then
  test_pass
else
  test_fail "Parallel downloads failed"
fi

# B3: Race Condition (Multiple Processes)
test_start "B3: Race condition handling (multiple processes)"
clean_cache

# Start 3 separate processes simultaneously
"$AGENT" ensure hl7.fhir.uv.ips 1.1.0 --root "$TEST_CACHE" > /dev/null 2>&1 &
pid1=$!
"$AGENT" ensure hl7.fhir.uv.ips 1.1.0 --root "$TEST_CACHE" > /dev/null 2>&1 &
pid2=$!
"$AGENT" ensure hl7.fhir.uv.ips 1.1.0 --root "$TEST_CACHE" > /dev/null 2>&1 &
pid3=$!

wait $pid1
exit1=$?
wait $pid2
exit2=$?
wait $pid3
exit3=$?

# All should succeed
all_success=$([ $exit1 -eq 0 ] && [ $exit2 -eq 0 ] && [ $exit3 -eq 0 ] && echo true || echo false)

# Exactly one package directory should exist (no .tmp- dirs)
final_dirs=$(count_files "$TEST_CACHE/packages/hl7.fhir.uv.ips#1.1.0")
staging_dirs=$(count_files "$TEST_CACHE/packages/hl7.fhir.uv.ips#1.1.0.tmp-*")

if $all_success && [ "$final_dirs" -eq 1 ] && [ "$staging_dirs" -eq 0 ]; then
  test_pass
else
  test_fail "Race condition not handled (exits: $exit1,$exit2,$exit3, final: $final_dirs, staging: $staging_dirs)"
fi

print_summary
