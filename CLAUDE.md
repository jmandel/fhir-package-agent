# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a single-file C# implementation of a FHIR Implementation Guide (IG) package manager. It operates as:
- A library API (`Fhir.Ig.FhirIgClient.EnsureAsync`)
- A CLI tool
- An in-process agent with named pipes for IPC

The agent auto-starts on demand within the calling process, and multiple processes can share one agent via named pipes (first to acquire lock pipe wins). Agent exits automatically when no active requests or downloads remain.

## Build and Run

### Building
```bash
# Release build (optimized, smaller binary)
dotnet publish fhir-package-agent.csproj -c Release -o bin

# Debug build
dotnet build fhir-package-agent.csproj -o bin
```

This produces `bin/fhir-package-agent` (74 KB) along with supporting files.

**Note**: `dotnet run fhir-package-agent.cs` has a known bug in .NET 10 RC where arguments aren't passed through. This will be fixed in the final .NET 10 release. For now, compile first with `dotnet build` or `dotnet publish`.

### Running as CLI
```bash
# Ensure a package is cached (auto-starts agent if needed)
./bin/fhir-package-agent ensure <package-id> <version> [options]

# Example: Download FHIR US Core IG
./bin/fhir-package-agent ensure hl7.fhir.us.core 6.1.0

# Run with debug logging
./bin/fhir-package-agent ensure hl7.fhir.r4.core 4.0.1 --log-level Debug

# Run agent explicitly (exits when no active work)
./bin/fhir-package-agent --agent [options]
```

### CLI Options
- `--root <path>`: Cache directory (default: `~/.fhir`)
- `--pipe <name>`: Base pipe name (default: `fhir-ig-agent-{user}`)
- `--max <n>`: Max concurrent downloads (default: 6)
- `--registries <csv>`: Comma-separated registry URLs
- `--preserve-tar`: Keep downloaded .tgz files
- `--http-timeout <sec>`: HTTP timeout (default: 600)
- `--max-retries <n>`: Max retry attempts (default: 3)
- `--retry-delay <sec>`: Initial retry delay (default: 1)
- `--log-level <level>`: Debug|Info|Warning|Error (default: Info)

### Using as Library
```csharp
using Fhir.Ig;

var options = new FhirIgOptions
{
    Root = "/path/to/cache",
    LogLevel = LogLevel.Debug
};

var path = await FhirIgClient.EnsureAsync(
    "hl7.fhir.us.core",
    "6.1.0",
    options
);

// Path to extracted package: /path/to/cache/packages/hl7.fhir.us.core#6.1.0
```

## Architecture

### Agent Lifecycle
- **In-process**: Agent runs in foreground thread within calling process
- **Singleton enforcement**: One agent per cache root via named pipe lock (`fhir-ig-agent-lock-{hash}`)
- **Auto-start**: First `EnsureAsync` call starts agent thread in same process
- **Auto-shutdown**: Agent exits when no active clients AND no active jobs
- **Named pipes**: IPC via (`fhir-ig-agent-{user}-{hash}`)
- **Multi-process**: Multiple processes can share one agent; first to grab lock pipe becomes the agent host

### Download Pipeline
1. **Resolution**: Query registries for package manifest
2. **Download**: Fetch tarball with progress tracking
3. **Verification**: SHA-512 or SHA-1 integrity check (if manifest provides)
4. **Extraction**: Unpack to staging directory with path traversal protection
5. **Atomic publish**: Move staging → final directory (handles race conditions)

### Concurrency Control
- **Throttling**: `MaxConcurrentDownloads` semaphore limits parallel downloads
- **Deduplication**: Multiple concurrent requests for same package share one download job
- **Fan-out**: Multiple clients can wait on the same package via channels
- **Atomic operations**: Directory.Move for atomic publish; handles race conditions

### Protocol Messages (JSON over named pipes)
- Request: `{"op": "ensure", "id": "...", "version": "..."}`
- Response: `start` → `progress`* → (`hit` | `completed`) or `error`
- Progress includes phase and optional message/bytes

### Error Handling
- Network retry with exponential backoff and jitter
- Structured logging with severity levels
- Path traversal protection in tar extraction
- Integrity verification (SRI sha512 or sha1 shasum)
- Stale temp directory cleanup (hourly sweep)

## Key Implementation Details

### File Structure
- Cache root: `~/.fhir/` by default
- Packages: `{root}/packages/{id}#{version}/`
- Staging: `{root}/packages/{id}#{version}.tmp-{guid}/`
- Lock pipe: `fhir-ig-agent-lock-{hash}` (one per root)
- Service pipe: `fhir-ig-agent-{user}-{hash}`

### Hash Computation
- Root path → SHA-256 → 6-byte hex suffix
- Ensures unique pipe names per cache root
- Example: `fhir-ig-agent-user-a1b2c3d4e5f6`

### Security Considerations
- Named pipes are user-scoped but not ACL-protected
- Path traversal protection in tar extraction
- Cryptographic integrity verification (when available)
- Absolute paths rejected in archives
- Symlinks and hardlinks ignored during extraction

### Dependencies
- Requires .NET 8+ for `System.Formats.Tar`
- No external NuGet packages needed (single-file design)

## Registry Configuration

Default registries (in order):
1. https://packages.fhir.org (primary FHIR registry)
2. https://packages.simplifier.net (Simplifier registry)

Registries are queried in order until package is found. Each returns either:
- JSON manifest with `dist.tarball` URL
- Direct tarball response