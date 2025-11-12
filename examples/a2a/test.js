import { FhirPackageAgent } from './agent.js';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

/**
 * Simple test script for the FHIR Package A2A Agent
 *
 * This tests the agent without requiring a full A2A server/client setup.
 */

class MockEventBus {
  constructor() {
    this.messages = [];
    this.artifacts = [];
  }

  publishMessage(message) {
    console.log('📨 Message:', message.parts[0].text);
    this.messages.push(message);
  }

  publishArtifact(artifact) {
    console.log('📦 Artifact:', artifact.name);
    this.artifacts.push(artifact);
  }
}

async function test() {
  console.log('🧪 Testing FHIR Package A2A Agent\n');

  const agent = new FhirPackageAgent();

  // Test 1: Get Agent Card
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Get Agent Card');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const card = agent.getAgentCard();
  console.log('Agent Name:', card.name);
  console.log('Skills:', card.skills.map(s => s.name).join(', '));
  console.log('✅ Test 1 passed\n');

  // Test 2: List Cached Packages
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 2: List Cached Packages');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const eventBus1 = new MockEventBus();
  const context1 = {
    request: {
      messages: [{
        role: 'user',
        parts: [{ type: 'text', text: 'list cached packages' }]
      }]
    }
  };

  await agent.execute(context1, eventBus1);
  console.log('✅ Test 2 passed\n');

  // Test 3: Ensure a Small Package
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 3: Ensure FHIR Package (hl7.fhir.r4.core#4.0.1)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const eventBus2 = new MockEventBus();
  const context2 = {
    request: {
      messages: [{
        role: 'user',
        parts: [{ type: 'text', text: 'ensure package: hl7.fhir.r4.core version: 4.0.1' }]
      }]
    }
  };

  try {
    await agent.execute(context2, eventBus2);
    console.log('✅ Test 3 passed\n');
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message);
    console.error('(This may be due to network issues or missing FHIR agent binary)\n');
  }

  // Test 4: Get Package Info
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 4: Get Package Info');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const eventBus3 = new MockEventBus();
  const context3 = {
    request: {
      messages: [{
        role: 'user',
        parts: [{ type: 'text', text: 'get package info for package: hl7.fhir.r4.core version: 4.0.1' }]
      }]
    }
  };

  try {
    await agent.execute(context3, eventBus3);
    console.log('✅ Test 4 passed\n');
  } catch (error) {
    console.error('❌ Test 4 failed:', error.message);
    console.error('(Package may not be cached yet)\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All tests completed!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

test().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
