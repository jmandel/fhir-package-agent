# FHIR Package A2A Agent

This example demonstrates how to integrate the [FHIR Package Agent](../../) with the [Agent2Agent (A2A) Protocol](https://github.com/a2aproject/a2a-js) to create an A2A-compliant agent for managing FHIR Implementation Guide packages.

Built with **TypeScript** and **ArkType** for compile-time and runtime type safety.

## Overview

The FHIR Package A2A Agent exposes the FHIR Package Agent's functionality through the A2A protocol, allowing other A2A agents and clients to:

- Download and cache FHIR IG packages
- List cached packages
- Retrieve package metadata

This enables multi-agent systems where FHIR package management is handled by a specialized agent that can be queried by other agents through a standardized protocol.

## Architecture

```
┌─────────────────┐
│  A2A Client     │  ← Your application or another agent
└────────┬────────┘
         │ A2A Protocol (HTTP/JSON)
         ↓
┌─────────────────────────────┐
│  FHIR Package A2A Agent     │  ← Bun.serve (native server - this example)
│  - Exposes AgentCard        │
│  - Handles A2A requests     │
│  - High-performance routing │
└────────┬────────────────────┘
         │ CLI spawn
         ↓
┌─────────────────────────────┐
│  FHIR Package Agent         │  ← C# implementation
│  - Downloads packages       │
│  - Manages cache            │
│  - Verifies integrity       │
└─────────────────────────────┘
```

## Prerequisites

1. **.NET 8+** - Required to build the FHIR Package Agent
2. **Bun 1.3+** - Required for the A2A agent (fast JavaScript/TypeScript runtime, compatible with .NET v10)

## Features

- **TypeScript** - Full type safety at compile time
- **ArkType** - Runtime type validation for robust error handling
- **Bun** - Fast JavaScript runtime with native TypeScript support
- **Bun.serve** - Native high-performance HTTP server (faster than Express!)
- **A2A Protocol** - Standardized agent communication

## Setup

### 1. Build the FHIR Package Agent

First, build the underlying FHIR Package Agent:

```bash
# From the project root
cd ../..
dotnet publish fhir-package-agent.csproj -c Release -o bin
```

This creates the `bin/fhir-package-agent` executable.

### 2. Install Dependencies with Bun

```bash
# From this directory (examples/a2a)
bun install
```

This installs:
- `@a2a-js/sdk` - A2A protocol implementation
- `arktype` - Runtime type validation
- TypeScript types for Node.js

No Express needed - we use Bun's native `Bun.serve()` for maximum performance!

## Usage

### Starting the Server

Start the A2A agent server (Bun runs TypeScript natively):

```bash
bun run server
```

No compilation step needed - Bun executes TypeScript directly!

This will start the server on `http://localhost:3000` (configurable via `PORT` and `HOST` environment variables).

You should see:

```
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏥 FHIR Package A2A Agent Server (Bun Native)              ║
║                                                                ║
║   Server running at: http://localhost:3000                    ║
║                                                                ║
║   Agent Card:  http://localhost:3000/card                     ║
║   Health:      http://localhost:3000/health                   ║
║   Message:     http://localhost:3000/message                  ║
║                                                                ║
║   Skills:                                                      ║
║   - ensure-package: Download and cache FHIR packages          ║
║   - list-cached: List all cached packages                     ║
║   - get-package-info: Get package metadata                    ║
║                                                                ║
║   Using Bun's native HTTP server for maximum performance! 🚀 ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

### Running the Client Example

In a separate terminal, run the client example:

```bash
bun run client
```

This will:
1. Connect to the agent
2. List cached packages
3. Download FHIR R4 core package
4. Get package information
5. Download US Core package

### Manual Testing

You can also interact with the agent using curl or any HTTP client:

#### Get the Agent Card

```bash
curl http://localhost:3000/card
```

Response:
```json
{
  "name": "FHIR Package Agent",
  "description": "An A2A agent for managing FHIR Implementation Guide packages...",
  "version": "1.0.0",
  "skills": [
    {
      "name": "ensure-package",
      "description": "Download and ensure a FHIR package is cached locally...",
      "parameters": [...]
    },
    ...
  ]
}
```

#### Send a Message

```bash
curl -X POST http://localhost:3000/message \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "parts": [{
        "type": "text",
        "text": "ensure package: hl7.fhir.r4.core version: 4.0.1"
      }]
    }]
  }'
```

## Available Skills

### 1. ensure-package

Downloads and caches a FHIR package.

**Parameters:**
- `packageId` (string, required): The FHIR package identifier (e.g., `hl7.fhir.us.core`)
- `version` (string, required): The package version (e.g., `6.1.0`)

**Example message:**
```
"ensure package: hl7.fhir.us.core version: 6.1.0"
```

**Returns:**
- Success message with package path
- Artifact with package metadata

### 2. list-cached

Lists all currently cached FHIR packages.

**Parameters:** None

**Example message:**
```
"list cached packages"
```

**Returns:**
- List of cached packages (id and version)
- Artifact with package details

### 3. get-package-info

Retrieves detailed information about a cached package.

**Parameters:**
- `packageId` (string, required): The FHIR package identifier
- `version` (string, required): The package version

**Example message:**
```
"get package info for package: hl7.fhir.r4.core version: 4.0.1"
```

**Returns:**
- Package name, description, and FHIR versions
- Artifact with full package metadata

## Configuration

You can customize the agent's behavior through environment variables or by modifying the `FhirPackageAgent` constructor in `server.ts`:

```typescript
const fhirAgent = new FhirPackageAgent({
  // Path to the FHIR agent executable
  fhirAgentPath: '/path/to/fhir-package-agent',

  // Cache directory (default: ~/.fhir)
  cacheRoot: '/custom/cache/path',

  // Log level: Debug, Info, Warning, Error (default: Info)
  logLevel: 'Debug' // Type-safe: only accepts valid log levels
});
```

Options are validated at runtime using ArkType, ensuring type safety even when loading from environment variables or config files.

### Environment Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: localhost)
- `AGENT_URL`: Agent URL for client (default: http://localhost:3000)

## Integration with Other Agents

The FHIR Package A2A Agent can be integrated into multi-agent systems. Here's an example of how another agent might use it:

```typescript
import { A2AClient } from '@a2a-js/sdk';

async function myAgent() {
  // Connect to the FHIR Package Agent
  const fhirAgent = await A2AClient.fromCardUrl('http://localhost:3000/card');

  // Request a package (fully typed)
  const response = await fhirAgent.sendMessage({
    role: 'user',
    parts: [{
      type: 'text',
      text: 'ensure package: hl7.fhir.us.core version: 6.1.0'
    }]
  });

  // TypeScript knows the structure of the response
  const packagePath = response.task?.artifacts?.[0]?.data?.path;

  // Now you can read FHIR resources from the package
  console.log('Package available at:', packagePath);
}
```

## Use Cases

1. **Multi-Agent Healthcare Systems**: Multiple specialized agents (data validators, profile checkers, terminology servers) coordinate through A2A, with the FHIR Package Agent providing access to canonical FHIR definitions.

2. **FHIR Validation Services**: A validation agent can request specific FHIR profiles and value sets on-demand without maintaining its own package cache.

3. **Dynamic Implementation Guide Access**: Agents can discover and download FHIR IGs based on runtime requirements rather than bundling all profiles at build time.

4. **Educational Tools**: Interactive learning systems where students query FHIR resources and the agent fetches the latest definitions from official registries.

## Files

- `agent.ts` - Core FHIR Package A2A Agent implementation (TypeScript + ArkType)
- `server.ts` - Bun native server (`Bun.serve`) that exposes the agent
- `client.ts` - Example client demonstrating agent usage
- `package.json` - Bun project configuration
- `tsconfig.json` - TypeScript configuration
- `.gitignore` - Git ignore patterns
- `README.md` - This file

## TypeScript and ArkType

This project uses **TypeScript** for compile-time type safety and **ArkType** for runtime validation:

### Compile-Time Safety (TypeScript)
```typescript
// TypeScript catches errors at development time
const agent = new FhirPackageAgent({
  logLevel: 'Invalid' // ❌ TypeScript error: not a valid log level
});
```

### Runtime Safety (ArkType)
```typescript
// ArkType validates data at runtime (e.g., from config files)
const options = loadFromConfig(); // unknown data
const agent = new FhirPackageAgent(options); // ✓ Validated by ArkType
```

### Type Checking

Run TypeScript type checker:
```bash
bun run typecheck
```

## Troubleshooting

### "Cannot find module '@a2a-js/sdk'"

Run `bun install` to install dependencies.

### "FHIR agent not found"

Make sure you've built the FHIR Package Agent:
```bash
cd ../.. && dotnet publish fhir-package-agent.csproj -c Release -o bin
```

### "Connection refused"

Ensure the server is running (`bun run server`) before running the client.

### "Package download failed"

Check your internet connection and verify the package ID and version are correct. You can test the underlying FHIR agent directly:

```bash
../../bin/fhir-package-agent ensure hl7.fhir.r4.core 4.0.1 --log-level Debug
```

## Learn More

- [FHIR Package Agent Documentation](../../README.md)
- [Agent2Agent Protocol](https://github.com/a2aproject/a2a-js)
- [FHIR Implementation Guides](https://fhir.org/guides/registry/)
- [FHIR Package Registry](https://packages.fhir.org/)

## License

This example is part of the FHIR Package Agent project. See the project root for license information.
