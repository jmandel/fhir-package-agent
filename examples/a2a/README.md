# FHIR Package Mastra Agent

An intelligent AI agent powered by [Mastra AI](https://mastra.ai) that manages FHIR Implementation Guide packages through natural language conversations.

Built with **TypeScript**, **ArkType**, and **Mastra AI** for a modern agentic experience.

## Overview

The FHIR Package Mastra Agent is an autonomous AI agent that helps you manage FHIR IG packages using natural language. Simply chat with the agent to download packages, list what's cached, or get package information.

**Key Features:**
- 🤖 Natural language conversations with the agent
- 📦 Automatic FHIR package management
- 🔧 Three specialized tools (ensure, list, info)
- 🚀 Powered by Mastra AI framework
- ⚡ Bun native HTTP server
- 🎯 TypeScript + ArkType type safety

## Architecture

```
┌─────────────────┐
│  Client         │  ← Your application (natural language chat)
└────────┬────────┘
         │ HTTP/JSON (chat messages)
         ↓
┌─────────────────────────────┐
│  Mastra AI Agent            │  ← Bun.serve (this example)
│  - Understands requests     │
│  - Selects appropriate tool │
│  - Generates responses      │
└────────┬────────────────────┘
         │ Tool execution
         ↓
┌─────────────────────────────┐
│  FHIR Package Tools         │
│  - ensure-fhir-package      │
│  - list-cached-packages     │
│  - get-package-info         │
└────────┬────────────────────┘
         │ CLI spawn
         ↓
┌─────────────────────────────┐
│  FHIR Package Agent (C#)    │
│  - Downloads packages       │
│  - Manages cache            │
│  - Verifies integrity       │
└─────────────────────────────┘
```

## Prerequisites

1. **.NET 8+** - Required to build the FHIR Package Agent
2. **Bun 1.3+** - Required for the Mastra agent (fast JavaScript/TypeScript runtime)
3. **OpenAI API Key** - Required for the AI agent (set as `OPENAI_API_KEY` env var)

## Features

- **Mastra AI** - Agentic framework with LLM routing and tool orchestration
- **TypeScript** - Full type safety at compile time
- **ArkType** - Runtime type validation for robust error handling
- **Bun** - Fast JavaScript runtime with native TypeScript support
- **Bun.serve** - Native high-performance HTTP server
- **Natural Language** - Chat with the agent in plain English

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
- `@mastra/core` - Mastra AI framework
- `arktype` - Runtime type validation
- `zod` - Schema validation (used by Mastra)
- TypeScript types for Node.js

### 3. Set OpenAI API Key

```bash
export OPENAI_API_KEY="your-api-key-here"
```

Or create a `.env` file:
```
OPENAI_API_KEY=your-api-key-here
```

## Usage

### Starting the Server

Start the Mastra agent server (Bun runs TypeScript natively):

```bash
bun run server
```

No compilation step needed - Bun executes TypeScript directly!

You should see:

```
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏥 FHIR Package Mastra Agent Server                        ║
║                                                                ║
║   Server running at: http://localhost:3000                    ║
║                                                                ║
║   Health:      http://localhost:3000/health                   ║
║   Chat:        http://localhost:3000/chat                     ║
║   Agent Info:  http://localhost:3000/agent                    ║
║                                                                ║
║   Tools:                                                       ║
║   - ensure-fhir-package: Download and cache FHIR packages     ║
║   - list-cached-fhir-packages: List all cached packages       ║
║   - get-fhir-package-info: Get package metadata               ║
║                                                                ║
║   Powered by Mastra AI + Bun 🚀                               ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

### Running the Client Example

In a separate terminal, run the client example:

```bash
bun run client
```

This will demonstrate natural language interactions:
1. "What FHIR packages do I have cached?"
2. "Please download hl7.fhir.r4.core version 4.0.1"
3. "Tell me about the hl7.fhir.r4.core package"
4. "Can you get me the US Core 6.1.0 package?"
5. "How many packages do I have now?"

### Manual Testing with curl

You can chat with the agent using curl:

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What FHIR packages do I have?"}'
```

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Download hl7.fhir.r4.core version 4.0.1"}'
```

## API Endpoints

### POST /chat

Chat with the AI agent using natural language.

**Request:**
```json
{
  "message": "Download the US Core 6.1.0 package"
}
```

**Response:**
```json
{
  "response": "I've downloaded the hl7.fhir.us.core version 6.1.0 package...",
  "success": true
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "agent": "FHIR Package Agent",
  "version": "1.0.0",
  "framework": "Mastra AI"
}
```

### GET /agent

Get agent information (name, instructions, tools).

**Response:**
```json
{
  "name": "FHIR Package Agent",
  "instructions": "You are an intelligent FHIR package manager...",
  "tools": ["ensurePackageTool", "listCachedTool", "getPackageInfoTool"]
}
```

## Example Conversations

### Download a Package
```
You: Can you download the FHIR R4 core package version 4.0.1?
Agent: I've successfully downloaded the hl7.fhir.r4.core version 4.0.1
       package. It's now cached at /home/user/.fhir/packages/hl7.fhir.r4.core#4.0.1
```

### List Packages
```
You: What packages do I have?
Agent: You currently have 2 cached FHIR packages:
       - hl7.fhir.r4.core@4.0.1
       - hl7.fhir.us.core@6.1.0
```

### Get Package Info
```
You: Tell me about the US Core package
Agent: The hl7.fhir.us.core version 6.1.0 package is the US Core
       Implementation Guide. It supports FHIR versions 4.0.1 and is
       located at /home/user/.fhir/packages/hl7.fhir.us.core#6.1.0
```

## How It Works

### 1. Tools (tools.ts)

Three specialized tools built with Mastra's `createTool`:

```typescript
const ensurePackageTool = createTool({
  id: 'ensure-fhir-package',
  description: 'Download and ensure a FHIR package is cached',
  inputSchema: z.object({
    packageId: z.string(),
    version: z.string(),
  }),
  execute: async ({ context }) => {
    // Downloads the package using FHIR agent CLI
  },
});
```

### 2. Agent (agent.ts)

The Mastra agent with instructions and tools:

```typescript
const fhirPackageAgent = new Agent({
  name: 'FHIR Package Agent',
  instructions: `You are an intelligent FHIR package manager...`,
  model: {
    provider: 'OPEN_AI',
    name: 'gpt-4',
    toolChoice: 'auto',
  },
  tools: {
    ensurePackageTool,
    listCachedTool,
    getPackageInfoTool,
  },
});
```

### 3. Mastra Instance (mastra.ts)

Registers the agent:

```typescript
const mastra = new Mastra({
  agents: {
    fhirPackageAgent,
  },
});
```

### 4. Server (server.ts)

Exposes the agent via HTTP:

```typescript
const agent = mastra.getAgent('fhirPackageAgent');
const result = await agent.generate(message);
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: localhost)
- `OPENAI_API_KEY`: Your OpenAI API key (required)
- `AGENT_URL`: Agent URL for client (default: http://localhost:3000)

### Customizing the Agent

You can modify the agent's behavior in `agent.ts`:

```typescript
export const fhirPackageAgent = new Agent({
  name: 'FHIR Package Agent',
  instructions: `Your custom instructions here...`,
  model: {
    provider: 'OPEN_AI',
    name: 'gpt-4',  // or 'gpt-4o-mini', 'gpt-3.5-turbo'
    toolChoice: 'auto',
  },
  tools: {
    // Add more tools here
  },
});
```

## Files

- `tools.ts` - FHIR package tools (ensure, list, info)
- `agent.ts` - Mastra agent configuration
- `mastra.ts` - Mastra instance setup
- `server.ts` - Bun native HTTP server
- `client.ts` - Example client demonstrating usage
- `package.json` - Bun project configuration
- `tsconfig.json` - TypeScript configuration
- `README.md` - This file

## Why Mastra AI?

**Mastra** is a modern TypeScript framework for building AI agents that provides:

- **Autonomous Agents** - Agents reason about goals and decide which tools to use
- **Tool Orchestration** - Seamless integration of custom tools with LLMs
- **LLM Routing** - Support for multiple providers (OpenAI, Anthropic, Gemini, etc.)
- **Observability** - Built-in logging and monitoring
- **TypeScript-First** - Full type safety and excellent DX

Unlike traditional API wrappers, Mastra agents can:
- Understand natural language requests
- Automatically select the right tool
- Chain multiple tools together
- Provide conversational responses

## Troubleshooting

### "Cannot find module '@mastra/core'"

Run `bun install` to install dependencies.

### "FHIR agent not found"

Make sure you've built the FHIR Package Agent:
```bash
cd ../.. && dotnet publish fhir-package-agent.csproj -c Release -o bin
```

### "OpenAI API error"

Ensure your `OPENAI_API_KEY` environment variable is set:
```bash
export OPENAI_API_KEY="your-key-here"
```

### "Connection refused"

Ensure the server is running (`bun run server`) before running the client.

## Learn More

- [Mastra AI Documentation](https://mastra.ai/docs)
- [Mastra GitHub](https://github.com/mastra-ai/mastra)
- [FHIR Package Registry](https://packages.fhir.org/)
- [FHIR Implementation Guides](https://fhir.org/guides/registry/)

## License

This example is part of the FHIR Package Agent project. See the project root for license information.
