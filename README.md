# fhir-package-agent

A high-performance FHIR Implementation Guide (IG) package manager with automatic background agent lifecycle management.

## Features

- **Single-file implementation**: Zero external dependencies, just .NET 9+
- **Dual API**: Use as library or CLI tool
- **Automatic agent management**: Background agent starts on-demand, exits when idle
- **Multi-process coordination**: Multiple processes share one agent via named pipes
- **Fast cache hits**: Filesystem check bypasses agent (~40ms)
- **Fast cache miss**: Agent starts in ~100ms, download begins immediately
- **Concurrent downloads**: Throttled parallel downloads with request deduplication
- **Atomic operations**: Race-condition-safe package publishing
- **Integrity verification**: SHA-512/SHA-1 cryptographic verification when available
- **Network resilience**: Exponential backoff with jitter for retries
- **Security**: Path traversal protection, absolute path rejection in archives
- **Structured logging**: Configurable severity levels (Debug, Info, Warning, Error)
- **JSON output**: CLI emits structured JSON for easy parsing

## Quick Start

### Installation

```bash
# Clone or download fhir-package-agent.cs
git clone https://github.com/your-org/fhir-package-agent.git
cd fhir-package-agent

# Build
dotnet publish fhir-package-agent.csproj -c Release -o bin
```

This produces `bin/fhir-package-agent` (74 KB) ready to use.

### CLI Usage

```bash
# Download a FHIR package
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0

# With custom cache directory
./bin/fhir-package-agent ensure hl7.fhir.r4.core 4.0.1 --root /custom/cache

# With debug logging
./bin/fhir-package-agent ensure hl7.fhir.r5.core 5.0.0 --log-level Debug

# Run agent explicitly (normally auto-started)
./bin/fhir-package-agent --agent
```

### Library Usage

```csharp
using Fhir.Ig;

// Simple usage with defaults
var path = await FhirIgClient.EnsureAsync("hl7.fhir.us.core", "6.1.0");
Console.WriteLine($"Package at: {path}");
// Output: /home/user/.fhir/packages/hl7.fhir.us.core#6.1.0

// With progress tracking
var progress = new Progress<ProgressInfo>(info =>
{
    Console.WriteLine($"{info.Phase}: {info.Message}");
});

var options = new FhirIgOptions
{
    Root = "/custom/cache",
    MaxConcurrentDownloads = 10,
    LogLevel = LogLevel.Debug
};

var path = await FhirIgClient.EnsureAsync(
    "hl7.fhir.r4.core",
    "4.0.1",
    options,
    progress
);
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--root <path>` | Cache root directory | `~/.fhir` |
| `--pipe <name>` | Base pipe name for IPC | `fhir-ig-agent-{user}` |
| `--max <n>` | Max concurrent downloads | `6` |
| `--registries <csv>` | Comma-separated registry URLs | `packages.fhir.org, packages.simplifier.net` |
| `--preserve-tar` | Keep downloaded .tgz files | `false` |
| `--http-timeout <sec>` | HTTP timeout in seconds | `600` |
| `--max-retries <n>` | Max retry attempts | `3` |
| `--retry-delay <sec>` | Initial retry delay in seconds | `1` |
| `--log-level <level>` | Log level (Debug, Info, Warning, Error) | `Info` |

## CLI Output Format

All CLI output is JSON for easy parsing:

```bash
$ ./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0
{"phase":"start"}
{"phase":"progress","message":"Downloading from https://packages.fhir.org"}
{"phase":"progress","message":"Downloading 1.5 MiB"}
{"phase":"progress","message":"Warning: No integrity verification"}
{"phase":"progress","message":"Extracting package"}
{"phase":"progress","message":"Package ready"}
{"phase":"completed","message":"/home/user/.fhir/packages/hl7.fhir.us.core#6.1.0"}
{"path":"/home/user/.fhir/packages/hl7.fhir.us.core#6.1.0"}
```

Parse the final `{"path":"..."}` line to get the package location.

## Architecture

### Agent Lifecycle

1. **Singleton enforcement**: One agent per cache root via lock pipe
2. **In-process**: Agent runs in foreground thread within calling process
3. **Auto-start**: First `EnsureAsync` call starts agent if not running
4. **Auto-shutdown**: Agent exits when no active clients AND no active jobs
5. **Multi-process**: Named pipes allow multiple processes to share one agent

```
Process A (CLI)                Process B (Library)
     |                                  |
     | EnsureAsync()                    | EnsureAsync()
     |                                  |
     +---> Fast path cache check        +---> Fast path cache check
     |     (filesystem only, ~40ms)     |     (filesystem only, ~40ms)
     |                                  |
     +---> Connect to agent             +---> Connect to agent
           (named pipe IPC)                   (named pipe IPC)
                    \                        /
                     \                      /
                      \                    /
                   Agent (background thread)
                   - Deduplicates requests
                   - Throttles downloads
                   - Handles all I/O
                   - Exits when idle
```

### Download Pipeline

1. **Resolution**: Query registries in order until manifest found
2. **Download**: Fetch tarball with streaming and progress tracking
3. **Verification**: SHA-512 or SHA-1 integrity check (when manifest provides)
4. **Extraction**: Unpack to staging directory with security checks
5. **Atomic publish**: `Directory.Move` from staging to final location

### Concurrency Control

- **Throttling**: `MaxConcurrentDownloads` semaphore limits parallel downloads
- **Deduplication**: Multiple concurrent requests for same package share one job
- **Fan-out**: Multiple clients can wait on same package via channels
- **Atomic operations**: Race-condition-safe directory moves

### Protocol Messages

Communication over named pipes uses JSON-line protocol:

**Request** (client → agent):
```json
{"op": "ensure", "id": "hl7.fhir.us.core", "version": "6.1.0"}
```

**Responses** (agent → client):
```json
{"type": "start", "id": "...", "version": "..."}
{"type": "progress", "id": "...", "version": "...", "message": "..."}
{"type": "hit", "id": "...", "version": "...", "path": "..."}
{"type": "completed", "id": "...", "version": "...", "path": "..."}
{"type": "error", "id": "...", "version": "...", "message": "..."}
```

## File Structure

```
~/.fhir/
├── packages/
│   ├── hl7.fhir.us.core#6.1.0/          # Final package directory
│   │   ├── package.json
│   │   ├── StructureDefinition-*.json
│   │   └── ...
│   ├── hl7.fhir.r4.core#4.0.1/
│   └── hl7.fhir.r5.core#5.0.0.tmp-abc123/  # Staging directory (temporary)
```

### Named Pipes

- **Lock pipe**: `fhir-ig-agent-lock-{hash}` (singleton enforcement)
- **Service pipe**: `fhir-ig-agent-{user}-{hash}` (IPC communication)
- **Hash**: 6-byte SHA-256 hex of cache root path (ensures unique pipes per root)

Example: `fhir-ig-agent-jmandel-0fcf31f61496`

## Security Considerations

- **Named pipes**: User-scoped but not ACL-protected (suitable for single-user or trusted environments)
- **Path traversal protection**: Archive entries validated before extraction
- **Absolute path rejection**: Archive entries with absolute paths rejected
- **Symlinks ignored**: Symbolic and hard links in archives are skipped
- **Cryptographic verification**: SHA-512 (SRI) or SHA-1 (shasum) when manifest provides
- **Secure string comparison**: Constant-time comparison for integrity checks

## Performance

- **Cache hit**: ~40ms (filesystem check only, no agent)
- **Cache miss**: ~100ms to agent start + download time
- **Concurrent requests**: Same package → single download, multiple waiters
- **Parallel downloads**: Up to `MaxConcurrentDownloads` simultaneous

Example timings:
```
hl7.fhir.us.core 6.1.0  (1.5 MiB)  → ~3 seconds
hl7.fhir.r4.core 4.0.1  (12.2 MiB) → ~6 seconds
hl7.fhir.r5.core 5.0.0  (16.3 MiB) → ~7 seconds
```

## Error Handling

- **Network failures**: Automatic retry with exponential backoff and jitter
- **Registry fallback**: Tries registries in order until package found
- **Race conditions**: Atomic directory moves handle concurrent downloads
- **Stale cleanup**: Hourly sweep removes staging directories older than 24 hours
- **Structured logging**: All errors logged with context and severity

## Registry Configuration

Default registries (queried in order):

1. `https://packages.fhir.org` (primary FHIR registry)
2. `https://packages.simplifier.net` (Simplifier registry)

Each registry returns either:
- JSON manifest with `dist.tarball` URL
- Direct tarball response (binary)

## Requirements

- **.NET 9+** (or .NET 8+ with `System.Formats.Tar`)
- **Platform**: Linux, macOS, Windows (named pipes support required)

## Known Issues

- **dotnet run bug**: In .NET 10 RC, `dotnet run fhir-package-agent.cs -- args` doesn't pass arguments correctly. Workaround: compile first with `dotnet build`.

## Development

### Building

```bash
# Debug build
dotnet build fhir-package-agent.csproj -o bin

# Release build (optimized)
dotnet publish fhir-package-agent.csproj -c Release -o bin
```

### Testing

```bash
# Basic functionality
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0

# Custom cache directory
./bin/fhir-package-agent ensure hl7.fhir.r4.core 4.0.1 --root test-cache

# Verify cache hit performance
time ./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0  # Should be ~40ms

# Debug logging
./bin/fhir-package-agent ensure hl7.fhir.r5.core 5.0.0 --log-level Debug
```

### Library API

```csharp
// Minimal options
public sealed class FhirIgOptions
{
    public string Root { get; init; }                   // Cache directory
    public int MaxConcurrentDownloads { get; init; }    // Throttling
    public string[] Registries { get; init; }           // Registry URLs
    public string BasePipeName { get; init; }           // Pipe name prefix
    public bool PreserveTarballs { get; init; }         // Keep .tgz files
    public TimeSpan HttpTimeout { get; init; }          // Download timeout
    public int MaxRetries { get; init; }                // Network retries
    public TimeSpan RetryBaseDelay { get; init; }       // Retry delay
    public LogLevel LogLevel { get; init; }             // Logging
}

// Progress tracking
public readonly record struct ProgressInfo(string Phase, string? Message = null);

// Main API
public static class FhirIgClient
{
    public static Task<string> EnsureAsync(
        string id,
        string version,
        FhirIgOptions? options = null,
        IProgress<ProgressInfo>? progress = null,
        CancellationToken ct = default
    );
}
```

## License

[Your License Here]

## Contributing

Contributions welcome! Please ensure:
- Single-file design is maintained
- No external dependencies added
- Security best practices followed
- Tests pass and performance is maintained

## Authors

[Your Name/Organization]

## See Also

- [FHIR Package Registry Specification](https://wiki.hl7.org/FHIR_Package_Registry)
- [HL7 FHIR Implementation Guides](https://www.hl7.org/fhir/implementationguide.html)
- [packages.fhir.org](https://packages.fhir.org/) (primary registry)