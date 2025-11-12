/**
 * FHIR Package Mastra Agent Client Example
 *
 * This demonstrates how to interact with the FHIR Package Mastra Agent
 * using HTTP requests to chat with the AI agent.
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3000';

interface ChatResponse {
  response: string;
  success: boolean;
  error?: string;
}

async function chat(message: string): Promise<string> {
  const response = await fetch(`${AGENT_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const data = await response.json() as ChatResponse;

  if (!data.success) {
    throw new Error(data.error || 'Chat request failed');
  }

  return data.response;
}

async function main(): Promise<void> {
  console.log('🤖 Connecting to FHIR Package Mastra Agent...\n');

  try {
    // Check health
    const healthResponse = await fetch(`${AGENT_URL}/health`);
    const health = await healthResponse.json();
    console.log('✓ Connected to:', health.agent);
    console.log('  Framework:', health.framework);
    console.log();

    // Example 1: List cached packages
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 1: List cached packages');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const listResponse = await chat('What FHIR packages do I have cached?');
    console.log('Agent:', listResponse);
    console.log();

    // Example 2: Download a FHIR package
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 2: Download FHIR R4 Core package');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const downloadResponse = await chat('Please download hl7.fhir.r4.core version 4.0.1');
    console.log('Agent:', downloadResponse);
    console.log();

    // Example 3: Get package information
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 3: Get package information');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const infoResponse = await chat('Tell me about the hl7.fhir.r4.core package version 4.0.1');
    console.log('Agent:', infoResponse);
    console.log();

    // Example 4: Download US Core
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 4: Download US Core package');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const usCoreResponse = await chat('Can you get me the US Core 6.1.0 package?');
    console.log('Agent:', usCoreResponse);
    console.log();

    // Example 5: Natural language conversation
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 5: Natural language query');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const nlResponse = await chat('How many packages do I have now?');
    console.log('Agent:', nlResponse);
    console.log();

    console.log('✅ All examples completed successfully!\n');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error:', errorMessage);
    console.error(error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error: Error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
