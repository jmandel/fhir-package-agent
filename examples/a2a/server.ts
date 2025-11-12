import express, { type Request, type Response } from 'express';
import { A2AExpressApp } from '@a2a-js/sdk';
import { FhirPackageAgent } from './agent.js';
import type { RequestContext, EventBus } from './agent.js';

/**
 * FHIR Package A2A Server
 *
 * This server exposes the FHIR Package Agent as an A2A-compliant agent
 * that can be accessed by other A2A clients and agents.
 */

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

interface HealthResponse {
  status: string;
  agent: string;
  version: string;
}

async function startServer(): Promise<void> {
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
    executor: async (context: RequestContext, eventBus: EventBus) => {
      await fhirAgent.execute(context, eventBus);
    }
  });

  // Mount the A2A app
  app.use('/', a2aApp.router);

  // Add a simple health check endpoint
  app.get('/health', (_req: Request, res: Response<HealthResponse>) => {
    res.json({
      status: 'ok',
      agent: 'FHIR Package Agent',
      version: '1.0.0'
    });
  });

  // Start the server
  app.listen(PORT, HOST, () => {
    const paddedHost = HOST.padEnd(20);
    const portStr = PORT.toString();

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏥 FHIR Package A2A Agent Server                           ║
║                                                                ║
║   Server running at: http://${paddedHost}:${portStr}${' '.repeat(20 - portStr.length)}║
║                                                                ║
║   Agent Card:  http://${paddedHost}:${portStr}/card${' '.repeat(15 - portStr.length)}║
║   Health:      http://${paddedHost}:${portStr}/health${' '.repeat(13 - portStr.length)}║
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
process.on('unhandledRejection', (error: Error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Start the server
startServer().catch((error: Error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
