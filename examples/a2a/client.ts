import { A2AClient } from '@a2a-js/sdk';

/**
 * FHIR Package A2A Client Example
 *
 * This demonstrates how to interact with the FHIR Package A2A Agent
 * using the A2A protocol.
 */

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3000';

interface MessagePart {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  parts?: MessagePart[];
}

interface Task {
  id?: string;
  status?: string;
  artifacts?: Array<{
    name: string;
    type: string;
    data: unknown;
  }>;
}

interface A2AResponse {
  message?: Message;
  task?: Task;
}

async function main(): Promise<void> {
  console.log('🔍 Connecting to FHIR Package A2A Agent...\n');

  try {
    // Connect to the agent using its card URL
    const client = await A2AClient.fromCardUrl(`${AGENT_URL}/card`);

    console.log('✓ Connected to agent:', client.agentCard.name);
    console.log('  Description:', client.agentCard.description);
    console.log('  Available skills:', client.agentCard.skills.map((s: { name: string }) => s.name).join(', '));
    console.log();

    // Example 1: List cached packages
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 1: List cached packages');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const listResponse = await client.sendMessage({
      role: 'user',
      parts: [{
        type: 'text',
        text: 'list cached packages'
      }]
    }) as A2AResponse;

    console.log('Response:', extractTextFromResponse(listResponse));
    console.log();

    // Example 2: Ensure a FHIR package
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 2: Ensure FHIR package (hl7.fhir.r4.core)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const ensureResponse = await client.sendMessage({
      role: 'user',
      parts: [{
        type: 'text',
        text: 'ensure package: hl7.fhir.r4.core version: 4.0.1'
      }]
    }) as A2AResponse;

    console.log('Response:', extractTextFromResponse(ensureResponse));
    console.log();

    // If the response is a task, we can monitor its progress
    if (ensureResponse.task) {
      console.log('Task created:', ensureResponse.task.id);
      console.log('Task status:', ensureResponse.task.status);

      if (ensureResponse.task.artifacts) {
        console.log('Artifacts:', ensureResponse.task.artifacts);
      }
    }

    // Example 3: Get package info
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 3: Get package info');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const infoResponse = await client.sendMessage({
      role: 'user',
      parts: [{
        type: 'text',
        text: 'get package info for package: hl7.fhir.r4.core version: 4.0.1'
      }]
    }) as A2AResponse;

    console.log('Response:', extractTextFromResponse(infoResponse));
    console.log();

    // Example 4: Ensure US Core package
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Example 4: Ensure US Core package');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const usCoreResponse = await client.sendMessage({
      role: 'user',
      parts: [{
        type: 'text',
        text: 'ensure package: hl7.fhir.us.core version: 6.1.0'
      }]
    }) as A2AResponse;

    console.log('Response:', extractTextFromResponse(usCoreResponse));
    console.log();

    console.log('✅ All examples completed successfully!\n');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error:', errorMessage);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Helper function to extract text from A2A response
 */
function extractTextFromResponse(response: A2AResponse): string {
  if (response.message) {
    const textParts = response.message.parts?.filter(p => p.type === 'text') || [];
    return textParts.map(p => p.text).join('\n');
  }
  return 'No text response';
}

// Run the main function
main().catch((error: Error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
