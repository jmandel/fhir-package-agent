import express from 'express';
import { A2AExpressApp } from '@a2a-js/sdk';
import { FhirPackageAgent } from './agent.js';

/**
 * FHIR Package A2A Server
 *
 * This server exposes the FHIR Package Agent as an A2A-compliant agent
 * that can be accessed by other A2A clients and agents.
 */

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

async function startServer() {
  // Create the FHIR Package Agent instance
  const fhirAgent = new FhirPackageAgent({
    // You can customize these options:
    // fhirAgentPath: '/path/to/fhir-package-agent',
    // cacheRoot: '/custom/cache/path',
    // logLevel: 'Debug'
  });

  // Create Express app
  const app = express();

  // Create A2A Express app with the agent
  const a2aApp = new A2AExpressApp({
    agentCard: fhirAgent.getAgentCard(),
    executor: async (context, eventBus) => {
      await fhirAgent.execute(context, eventBus);
    }
  });

  // Mount the A2A app
  app.use('/', a2aApp.router);

  // Add a simple health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      agent: 'FHIR Package Agent',
      version: '1.0.0'
    });
  });

  // Start the server
  app.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏥 FHIR Package A2A Agent Server                           ║
║                                                                ║
║   Server running at: http://${HOST}:${PORT}                    ║
║                                                                ║
║   Agent Card:  http://${HOST}:${PORT}/card                     ║
║   Health:      http://${HOST}:${PORT}/health                   ║
║                                                                ║
║   Skills:                                                      ║
║   - ensure-package: Download and cache FHIR packages          ║
║   - list-cached: List all cached packages                     ║
║   - get-package-info: Get package metadata                    ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  });
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Start the server
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
