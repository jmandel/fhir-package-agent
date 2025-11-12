import { Agent } from '@mastra/core/agent';
import { ensurePackageTool, listCachedTool, getPackageInfoTool } from './tools.js';

/**
 * FHIR Package Agent
 *
 * An intelligent agent powered by Mastra AI that manages FHIR Implementation Guide packages.
 * This agent can download packages, list cached packages, and retrieve package information
 * using natural language conversations.
 *
 * The agent uses three specialized tools:
 * - ensure-fhir-package: Downloads and caches FHIR IG packages
 * - list-cached-fhir-packages: Lists all locally cached packages
 * - get-fhir-package-info: Retrieves detailed package metadata
 *
 * You can interact with this agent using natural language queries like:
 * - "Download the US Core 6.1.0 package"
 * - "What packages do I have cached?"
 * - "Tell me about the hl7.fhir.r4.core package version 4.0.1"
 */
export const fhirPackageAgent = new Agent({
  name: 'FHIR Package Agent',
  instructions: `You are an intelligent FHIR (Fast Healthcare Interoperability Resources) Implementation Guide package manager.

Your role is to help users manage FHIR IG packages by:
1. **Downloading and caching packages** from official FHIR registries (packages.fhir.org and packages.simplifier.net)
2. **Listing cached packages** to show what's available locally
3. **Providing package information** including descriptions, FHIR versions, and metadata

When users ask you to ensure/download/get a package, use the ensure-fhir-package tool with the package ID and version.
When users ask what packages are cached or available, use the list-cached-fhir-packages tool.
When users ask for details about a specific package, use the get-fhir-package-info tool.

Be helpful, concise, and technical. Provide the package paths when packages are downloaded.
If a package isn't cached and the user asks for info, suggest using ensure-fhir-package first.

Common FHIR packages include:
- hl7.fhir.r4.core (FHIR R4 core specification)
- hl7.fhir.r5.core (FHIR R5 core specification)
- hl7.fhir.us.core (US Core Implementation Guide)
- hl7.fhir.uv.ips (International Patient Summary)

Always use proper semantic versioning for package versions (e.g., 4.0.1, 6.1.0).`,

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

export default fhirPackageAgent;
