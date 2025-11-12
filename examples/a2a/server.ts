import { FhirPackageAgent } from './agent.js';
import type { RequestContext, EventBus } from './agent.js';

/**
 * FHIR Package A2A Server
 *
 * This server exposes the FHIR Package Agent as an A2A-compliant agent
 * using Bun's native high-performance HTTP server.
 */

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

interface HealthResponse {
  status: string;
  agent: string;
  version: string;
}

// Create the FHIR Package Agent instance
const fhirAgent = new FhirPackageAgent({
  // You can customize these options:
  // fhirAgentPath: '/path/to/fhir-package-agent',
  // cacheRoot: '/custom/cache/path',
  // logLevel: 'Debug'
});

// Mock EventBus for A2A protocol
class SimpleEventBus implements EventBus {
  private messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> = [];
  private artifacts: Array<{ name: string; type: string; data: unknown }> = [];

  publishMessage(message: { role: string; parts: Array<{ type: string; text?: string }> }): void {
    this.messages.push(message);
  }

  publishArtifact(artifact: { name: string; type: string; data: unknown }): void {
    this.artifacts.push(artifact);
  }

  getMessages() {
    return this.messages;
  }

  getArtifacts() {
    return this.artifacts;
  }
}

// Start Bun's native server
const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS for CORS
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route: GET /card - Agent card
    if (url.pathname === '/card' && req.method === 'GET') {
      return Response.json(fhirAgent.getAgentCard(), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Route: GET /health - Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      const health: HealthResponse = {
        status: 'ok',
        agent: 'FHIR Package Agent',
        version: '1.0.0'
      };
      return Response.json(health, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Route: POST /message - Send message to agent
    if (url.pathname === '/message' && req.method === 'POST') {
      try {
        const body = await req.json() as { messages?: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }> };

        const context: RequestContext = {
          request: {
            messages: body.messages || []
          }
        };

        const eventBus = new SimpleEventBus();
        await fhirAgent.execute(context, eventBus);

        const messages = eventBus.getMessages();
        const artifacts = eventBus.getArtifacts();

        const response = {
          message: messages.length > 0 ? messages[messages.length - 1] : null,
          task: artifacts.length > 0 ? {
            id: `task-${Date.now()}`,
            status: 'completed',
            artifacts: artifacts
          } : null
        };

        return Response.json(response, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return Response.json(
          { error: errorMessage },
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Route: GET / - Welcome message
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(
        `FHIR Package A2A Agent\n\nEndpoints:\n- GET /card - Agent card\n- GET /health - Health check\n- POST /message - Send message`,
        {
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        }
      );
    }

    // 404 for unknown routes
    return new Response('Not Found', {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  },

  error(error: Error) {
    console.error('Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Display startup banner
const paddedHost = HOST.padEnd(20);
const portStr = PORT.toString();

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏥 FHIR Package A2A Agent Server (Bun Native)              ║
║                                                                ║
║   Server running at: http://${paddedHost}:${portStr}${' '.repeat(20 - portStr.length)}║
║                                                                ║
║   Agent Card:  http://${paddedHost}:${portStr}/card${' '.repeat(15 - portStr.length)}║
║   Health:      http://${paddedHost}:${portStr}/health${' '.repeat(13 - portStr.length)}║
║   Message:     http://${paddedHost}:${portStr}/message${' '.repeat(11 - portStr.length)}║
║                                                                ║
║   Skills:                                                      ║
║   - ensure-package: Download and cache FHIR packages          ║
║   - list-cached: List all cached packages                     ║
║   - get-package-info: Get package metadata                    ║
║                                                                ║
║   Using Bun's native HTTP server for maximum performance! 🚀 ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down server...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down server...');
  server.stop();
  process.exit(0);
});
