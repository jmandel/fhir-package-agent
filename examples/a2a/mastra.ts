import { Mastra } from '@mastra/core';
import { fhirPackageAgent } from './agent.js';

/**
 * Mastra Instance Configuration
 *
 * This file configures the Mastra framework instance and registers
 * the FHIR Package Agent.
 *
 * The Mastra instance provides:
 * - Agent registration and management
 * - Tool execution orchestration
 * - LLM provider integration
 * - Observability and logging
 */
export const mastra = new Mastra({
  agents: {
    fhirPackageAgent,
  },
});

export default mastra;
