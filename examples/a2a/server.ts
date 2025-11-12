import { mastra } from './mastra.js';

/**
 * FHIR Package Mastra Agent Server
 *
 * This server exposes the FHIR Package Agent powered by Mastra AI
 * using Bun's native high-performance HTTP server.
 */

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';

interface HealthResponse {
  status: string;
  agent: string;
  version: string;
  framework: string;
}

interface ChatRequest {
  message: string;
}

interface ChatResponse {
  response: string;
  success: boolean;
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

    // Route: GET /health - Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      const health: HealthResponse = {
        status: 'ok',
        agent: 'FHIR Package Agent',
        version: '1.0.0',
        framework: 'Mastra AI',
      };
      return Response.json(health, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Route: POST /chat - Chat with the agent
    if (url.pathname === '/chat' && req.method === 'POST') {
      try {
        const body = await req.json() as ChatRequest;
        const message = body.message;

        if (!message) {
          return Response.json(
            { error: 'Message is required', success: false },
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }

        // Get the agent
        const agent = mastra.getAgent('fhirPackageAgent');

        // Generate response
        const result = await agent.generate(message);

        const response: ChatResponse = {
          response: result.text,
          success: true,
        };

        return Response.json(response, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return Response.json(
          { error: errorMessage, success: false },
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Route: GET /agent - Get agent information
    if (url.pathname === '/agent' && req.method === 'GET') {
      const agent = mastra.getAgent('fhirPackageAgent');

      return Response.json({
        name: agent.name,
        instructions: agent.instructions,
        tools: Object.keys(agent.tools || {}),
      }, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Route: GET / - Welcome message
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(
        `FHIR Package Mastra Agent\n\nEndpoints:\n- GET /health - Health check\n- POST /chat - Chat with agent\n- GET /agent - Agent info\n\nPowered by Mastra AI`,
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
║   🏥 FHIR Package Mastra Agent Server                        ║
║                                                                ║
║   Server running at: http://${paddedHost}:${portStr}${' '.repeat(20 - portStr.length)}║
║                                                                ║
║   Health:      http://${paddedHost}:${portStr}/health${' '.repeat(13 - portStr.length)}║
║   Chat:        http://${paddedHost}:${portStr}/chat${' '.repeat(15 - portStr.length)}║
║   Agent Info:  http://${paddedHost}:${portStr}/agent${' '.repeat(14 - portStr.length)}║
║                                                                ║
║   Tools:                                                       ║
║   - ensure-fhir-package: Download and cache FHIR packages     ║
║   - list-cached-fhir-packages: List all cached packages       ║
║   - get-fhir-package-info: Get package metadata               ║
║                                                                ║
║   Powered by Mastra AI + Bun 🚀                               ║
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
