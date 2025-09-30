# Test Plan for fhir-package-agent

## Core Invariants

### 1. Singleton Agent per Cache Root
- **Invariant**: Only one agent process can hold the lock pipe for a given cache root at any time
- **Behavior**: Second process attempting to start agent should fail gracefully or connect to existing agent

### 2. Atomic Package Publishing
- **Invariant**: A package directory either exists completely or not at all (no partial states)
- **Behavior**: Concurrent downloads of same package result in exactly one published directory
- **Mechanism**: Staging directory + atomic `Directory.Move`

### 3. Cache Consistency
- **Invariant**: If package directory exists, it contains valid extracted package contents
- **Behavior**: Failed downloads leave no artifacts (staging dirs cleaned up)

### 4. Request Deduplication
- **Invariant**: Multiple concurrent requests for same package share one download job
- **Behavior**: N concurrent clients for package X result in 1 download, N responses

### 5. Agent Lifecycle
- **Invariant**: Agent exits when `ActiveJobs == 0 && ConnectedClients == 0`
- **Behavior**: Agent stays alive while work pending, exits immediately when idle

### 6. Exit Codes
- **Invariant**: CLI returns 0 on success, non-zero on failure
- **Behavior**:
  - 0: Package successfully ensured
  - 1: Error (network, not found, etc.)
  - 2: Invalid usage

## Test Categories

### A. Basic Functionality Tests

#### A1. Single Package Download (Cache Miss)
**Setup**: Empty cache
**Action**: `ensure hl7.fhir.us.core 6.1.0`
**Expected**:
- Package downloads from registry
- Directory created at `~/.fhir/packages/hl7.fhir.us.core#6.1.0`
- Exit code 0
- JSON output includes `{"path": "..."}`
- Agent starts and stops automatically

**Validation**:
```bash
# Check directory exists
test -d ~/.fhir/packages/hl7.fhir.us.core#6.1.0
# Check package.json exists
test -f ~/.fhir.packages/hl7.fhir.us.core#6.1.0/package.json
# Verify exit code
echo $? # Should be 0
```

#### A2. Package Already Cached (Cache Hit)
**Setup**: Package already downloaded
**Action**: `ensure hl7.fhir.us.core 6.1.0` (again)
**Expected**:
- Fast return (~40ms)
- No agent connection (fast path)
- Exit code 0
- JSON output includes `{"phase": "hit"}`

**Validation**:
```bash
time ./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0
# Should complete in <100ms
```

#### A3. Package Not Found
**Setup**: Empty cache
**Action**: `ensure nonexistent.package 99.99.99`
**Expected**:
- All registries queried
- Error message to stderr: `{"error": "Could not resolve tarball..."}`
- Exit code 1
- No partial directories left behind
- No retries (fails immediately)

**Validation**:
```bash
./bin/fhir-package-agent ensure nonexistent.package 99.99.99 2>&1
echo $? # Should be 1
# Check no staging dirs
! ls ~/.fhir/packages/*.tmp-* 2>/dev/null
```

#### A4. Multiple Packages Sequentially
**Setup**: Empty cache
**Action**:
```bash
ensure hl7.fhir.us.core 6.1.0
ensure hl7.fhir.r4.core 4.0.1
ensure hl7.fhir.r5.core 5.0.0
```
**Expected**:
- All three packages downloaded
- Agent starts once, handles all three, then exits
- All exit codes 0

### B. Concurrency Tests

#### B1. Concurrent Identical Requests (Deduplication)
**Setup**: Empty cache
**Action**: Launch 10 parallel `ensure hl7.fhir.r4.core 4.0.1` requests
**Expected**:
- Only 1 download occurs (check logs for "Downloading from")
- All 10 requests succeed
- All receive same final path
- Only 1 package directory created
- No race condition errors

**Test Script**:
```bash
for i in {1..10}; do
  (./bin/fhir-package-agent ensure hl7.fhir.r4.core 4.0.1 --root test-cache) &
done
wait
# Count how many "Downloading from" lines appear in logs
# Should be exactly 1
```

#### B2. Concurrent Different Requests (Parallelism)
**Setup**: Empty cache, `--max 3`
**Action**: Launch 5 different package requests simultaneously
**Expected**:
- Up to 3 downloads concurrent (throttling)
- All 5 succeed
- All 5 packages cached

**Validation**:
- Monitor with `--log-level Debug` to see throttling in action

#### B3. Race Condition: Multiple Processes
**Setup**: Empty cache
**Action**: Start 3 separate process instances simultaneously, all requesting same package
**Expected**:
- All 3 processes may attempt download
- Atomic `Directory.Move` handles race
- Exactly 1 published directory
- All 3 processes return success with same path
- Losing processes log "Race condition detected"

**Test Script**:
```bash
rm -rf test-cache
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0 --root test-cache &
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0 --root test-cache &
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0 --root test-cache &
wait
# Check only one directory exists
test $(ls -d test-cache/packages/hl7.fhir.us.core#6.1.0* | wc -l) -eq 1
```

### C. Agent Lifecycle Tests

#### C1. Agent Auto-Start
**Setup**: No agent running
**Action**: `ensure hl7.fhir.us.core 6.1.0`
**Expected**:
- Log shows "Starting new agent instance..."
- Agent starts in background thread
- Request completes successfully

#### C2. Agent Auto-Shutdown
**Setup**: Agent running with no work
**Action**: Wait after completing a request
**Expected**:
- Log shows "No active work, shutting down agent" within ~1 second
- Process exits cleanly

**Validation**:
```bash
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0 --root test-cache
# Process should return immediately after completion
# Agent thread should exit within 1 second
```

#### C3. Agent Reuse Across Requests
**Setup**: Agent running
**Action**: Issue second request while agent alive
**Expected**:
- No "Starting new agent" log
- Request handled by existing agent
- Agent stays alive until both complete

#### C4. Multiple Cache Roots = Multiple Agents
**Setup**: Two different cache directories
**Action**:
```bash
ensure hl7.fhir.us.core 6.1.0 --root /tmp/cache1 &
ensure hl7.fhir.us.core 6.1.0 --root /tmp/cache2 &
```
**Expected**:
- Two different lock pipes (different hash suffixes)
- Two agents can run simultaneously
- Both succeed

**Validation**:
```bash
# Check for two different pipe names in logs
# Should see different hashes: fhir-ig-agent-{user}-{hash1}, fhir-ig-agent-{user}-{hash2}
```

### D. Error Handling & Recovery Tests

#### D1. Network Timeout
**Setup**: Configure `--http-timeout 1` (1 second)
**Action**: Attempt to download large package
**Expected**:
- Download times out
- Retries up to `--max-retries` times
- Eventually fails with timeout error
- Exit code 1
- No partial files

#### D2. Network Interruption (Transient)
**Setup**: Simulate network failure on first attempt
**Action**: `ensure` with retries enabled
**Expected**:
- First attempt fails
- Exponential backoff retry
- Second attempt succeeds
- Exit code 0

#### D3. Corrupted Download (Integrity Check)
**Setup**: Package with integrity metadata in manifest
**Action**: Download package (simulate corruption if possible)
**Expected**:
- SHA-512 or SHA-1 verification
- If mismatch: SecurityException thrown
- No corrupted package published

#### D4. Disk Full During Download
**Setup**: Fill disk or use quota limit
**Action**: Attempt package download
**Expected**:
- IOException during write
- Staging directory cleaned up
- Exit code 1
- Error message in JSON

#### D5. Stale Staging Directory Cleanup
**Setup**: Create fake staging dir `*.tmp-{guid}` with old timestamp
**Action**: Run agent (triggers hourly sweep)
**Expected**:
- Stale dirs older than 24 hours are deleted
- Recent staging dirs preserved

**Test Script**:
```bash
# Create fake old staging dir
mkdir -p test-cache/packages/test.package#1.0.0.tmp-abc123
touch -t 202301010000 test-cache/packages/test.package#1.0.0.tmp-abc123
# Run agent
./bin/fhir-package-agent --agent --root test-cache &
sleep 2
pkill -f fhir-package-agent
# Check stale dir was cleaned
! test -d test-cache/packages/test.package#1.0.0.tmp-abc123
```

### E. Security Tests

#### E1. Path Traversal in Archive
**Setup**: Create malicious tarball with `../../etc/passwd` entry
**Action**: Attempt to extract (requires mocking/stubbing)
**Expected**:
- SecurityException: "Path traversal attempt detected"
- No files written outside staging directory
- Staging directory cleaned up

#### E2. Absolute Path in Archive
**Setup**: Tarball with `/tmp/evil.txt` entry
**Action**: Attempt to extract
**Expected**:
- SecurityException: "Absolute path in archive rejected"
- No extraction occurs

#### E3. Integrity Verification (SHA-512)
**Setup**: Package with `dist.integrity` in manifest
**Action**: Download package
**Expected**:
- SHA-512 computed during download
- Compared against SRI hash
- Log shows "Integrity verified (sha512)"
- Mismatch causes SecurityException

#### E4. Integrity Verification (SHA-1)
**Setup**: Package with `dist.shasum` in manifest
**Action**: Download package
**Expected**:
- SHA-1 computed during download
- Compared against shasum
- Log shows "Integrity verified (sha1 shasum)"

### F. CLI & Configuration Tests

#### F1. Custom Cache Root
**Action**: `ensure hl7.fhir.us.core 6.1.0 --root /tmp/custom-cache`
**Expected**:
- Package cached in `/tmp/custom-cache/packages/`
- Different lock pipe hash

#### F2. Custom Registries
**Action**: `ensure pkg 1.0.0 --registries https://my-registry.com,https://backup.com`
**Expected**:
- Queries my-registry.com first
- Falls back to backup.com if not found
- Default registries not used

#### F3. Preserve Tarballs
**Action**: `ensure hl7.fhir.us.core 6.1.0 --preserve-tar`
**Expected**:
- Package directory contains `package.tgz`
- File not deleted after extraction

#### F4. Debug Logging
**Action**: `ensure hl7.fhir.us.core 6.1.0 --log-level Debug`
**Expected**:
- Verbose logs including "DBG" level messages
- Shows connection attempts, retries, etc.

#### F5. Max Concurrent Downloads
**Action**: Launch many requests with `--max 2`
**Expected**:
- Only 2 downloads active simultaneously
- Others wait for semaphore

#### F6. Help Text
**Action**: `fhir-package-agent --help`
**Expected**:
- Usage information printed
- Exit code 0 (not 2)

#### F7. No Arguments
**Action**: `fhir-package-agent`
**Expected**:
- Help text printed
- Exit code 0

#### F8. Invalid Arguments
**Action**: `fhir-package-agent invalid-command`
**Expected**:
- Help text printed
- Exit code 2

### G. Registry Behavior Tests

#### G1. Primary Registry Success
**Setup**: Package exists on packages.fhir.org
**Action**: `ensure hl7.fhir.us.core 6.1.0`
**Expected**:
- Only queries packages.fhir.org
- Success without trying Simplifier

#### G2. Primary Registry Failure, Secondary Success
**Setup**: Package only on packages.simplifier.net
**Action**: `ensure some.simplifier.package 1.0.0`
**Expected**:
- Tries packages.fhir.org first (404)
- Falls back to packages.simplifier.net
- Success

#### G3. All Registries Fail
**Setup**: Package doesn't exist anywhere
**Action**: `ensure nonexistent 1.0.0`
**Expected**:
- Tries all registries
- Error lists all failures
- Exit code 1

#### G4. JSON Manifest Response
**Setup**: Registry returns JSON with `dist.tarball`
**Action**: Request package
**Expected**:
- Parses JSON
- Extracts tarball URL
- Downloads from tarball URL

#### G5. Direct Tarball Response
**Setup**: Registry returns tarball directly (binary)
**Action**: Request package
**Expected**:
- Detects non-JSON content-type
- Treats response as tarball
- Extracts directly

### H. Performance Tests

#### H1. Cache Hit Latency
**Setup**: Package already cached
**Action**: `time ensure hl7.fhir.us.core 6.1.0`
**Expected**: < 100ms (target: ~40ms)

#### H2. Agent Startup Latency
**Setup**: No agent running, package not cached
**Action**: `time ensure hl7.fhir.us.core 6.1.0`
**Expected**: Agent starts in < 200ms, then download begins

#### H3. Large Package Download
**Setup**: Empty cache
**Action**: `ensure hl7.fhir.r4.core 4.0.1` (12.2 MB)
**Expected**:
- Progress messages with size
- Completes in reasonable time (~6 seconds on good connection)
- No memory leaks (streaming)

#### H4. Many Small Packages
**Setup**: Empty cache
**Action**: Download 50 small packages sequentially
**Expected**:
- Agent handles all without crashing
- Memory usage stays bounded
- All packages successfully cached

### I. Edge Cases

#### I1. Package ID Case Sensitivity
**Action**:
```bash
ensure HL7.FHIR.US.CORE 6.1.0
ensure hl7.fhir.us.core 6.1.0
```
**Expected**:
- Both resolve to same cache key (lowercase)
- Second request is cache hit

#### I2. Empty Package (Valid but No Files)
**Setup**: Package tarball with only `package/` directory
**Action**: Extract and publish
**Expected**:
- Succeeds
- Directory created with just package.json

#### I3. Package with Many Files (>10,000)
**Setup**: Large IG package
**Action**: Download and extract
**Expected**:
- All files extracted
- No path traversal issues
- Reasonable performance

#### I4. Concurrent Requests During Agent Shutdown
**Setup**: Agent about to shutdown
**Action**: New request arrives just as agent checks idle state
**Expected**:
- Race handled gracefully
- Either agent stays alive or new agent starts

#### I5. Kill Agent Mid-Download
**Setup**: Download in progress
**Action**: SIGTERM/SIGINT to process
**Expected**:
- Partial download cleaned up (staging dir)
- Next request starts fresh

### J. Library API Tests

#### J1. Basic Library Usage
```csharp
var path = await FhirIgClient.EnsureAsync("hl7.fhir.us.core", "6.1.0");
```
**Expected**:
- Returns absolute path
- Path exists and contains package

#### J2. Progress Reporting
```csharp
var progress = new Progress<ProgressInfo>(info => {
  Console.WriteLine($"{info.Phase}: {info.Message}");
});
var path = await FhirIgClient.EnsureAsync("hl7.fhir.r4.core", "4.0.1", progress: progress);
```
**Expected**:
- Progress callbacks invoked
- Phases: start, progress, completed/hit

#### J3. Custom Options
```csharp
var options = new FhirIgOptions {
  Root = "/tmp/test-cache",
  MaxConcurrentDownloads = 10,
  LogLevel = LogLevel.Debug
};
var path = await FhirIgClient.EnsureAsync("hl7.fhir.us.core", "6.1.0", options);
```
**Expected**:
- Respects all options
- Cache in custom location

#### J4. Cancellation Token
```csharp
var cts = new CancellationTokenSource();
cts.CancelAfter(TimeSpan.FromSeconds(5));
await FhirIgClient.EnsureAsync("hl7.fhir.r4.core", "4.0.1", ct: cts.Token);
```
**Expected**:
- Download cancelled after 5 seconds
- OperationCanceledException thrown
- Staging dir cleaned up

#### J5. Exception Handling
```csharp
try {
  await FhirIgClient.EnsureAsync("nonexistent", "1.0.0");
} catch (InvalidOperationException ex) {
  // Expected
}
```
**Expected**:
- InvalidOperationException for not found
- IOException for connection failures

## Test Execution Strategy

### Automated Test Suite
Create `test.sh` script with:
```bash
#!/bin/bash
set -e

echo "=== A. Basic Functionality Tests ==="
./test-a1-single-download.sh
./test-a2-cache-hit.sh
./test-a3-not-found.sh
./test-a4-sequential.sh

echo "=== B. Concurrency Tests ==="
./test-b1-deduplication.sh
./test-b2-parallelism.sh
./test-b3-race-condition.sh

echo "=== C. Agent Lifecycle Tests ==="
./test-c1-auto-start.sh
./test-c2-auto-shutdown.sh
./test-c4-multiple-roots.sh

echo "=== D. Error Handling Tests ==="
./test-d1-timeout.sh
./test-d3-integrity.sh
./test-d5-stale-cleanup.sh

echo "=== E. Security Tests ==="
./test-e3-sha512.sh
./test-e4-sha1.sh

echo "=== F. CLI Tests ==="
./test-f1-custom-root.sh
./test-f3-preserve-tar.sh
./test-f4-debug-log.sh
./test-f6-help.sh

echo "=== G. Registry Tests ==="
./test-g1-primary.sh
./test-g3-all-fail.sh

echo "=== H. Performance Tests ==="
./test-h1-cache-hit-latency.sh
./test-h2-startup-latency.sh

echo "=== I. Edge Cases ==="
./test-i1-case-sensitivity.sh

echo "All tests passed!"
```

### Manual Testing Checklist
- [ ] Test on Linux
- [ ] Test on macOS
- [ ] Test on Windows
- [ ] Test with .NET 9
- [ ] Test with .NET 10
- [ ] Test with slow network (throttle)
- [ ] Test with unreliable network (packet loss)
- [ ] Verify no memory leaks (long-running agent)
- [ ] Verify no file descriptor leaks
- [ ] Load test: 1000 concurrent requests

### CI/CD Integration
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '9.0'
      - run: dotnet build fhir-package-agent.csproj
      - run: chmod +x test.sh
      - run: ./test.sh
```

## Success Criteria

All tests must:
1. ✅ Pass consistently (no flaky tests)
2. ✅ Complete in reasonable time (< 5 min total)
3. ✅ Clean up after themselves (no leftover test-cache dirs)
4. ✅ Run in isolation (order-independent)
5. ✅ Provide clear failure messages

## Test Metrics

Track:
- Code coverage (aim for >80%)
- Mean time to execute suite
- Flakiness rate (should be 0%)
- Performance regression detection