import { spawn } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * FHIR Package A2A Agent
 *
 * This agent wraps the FHIR package agent CLI to provide A2A-compliant
 * access to FHIR package management functionality.
 */
export class FhirPackageAgent {
  constructor(options = {}) {
    this.fhirAgentPath = options.fhirAgentPath || resolve(__dirname, '../../bin/fhir-package-agent');
    this.cacheRoot = options.cacheRoot || join(os.homedir(), '.fhir');
    this.logLevel = options.logLevel || 'Info';
  }

  /**
   * Get the agent card that defines this agent's capabilities
   */
  getAgentCard() {
    return {
      name: 'FHIR Package Agent',
      description: 'An A2A agent for managing FHIR Implementation Guide packages. Downloads, caches, and provides access to FHIR IG packages from official registries.',
      version: '1.0.0',
      skills: [
        {
          name: 'ensure-package',
          description: 'Download and ensure a FHIR package is cached locally. Returns the path to the cached package.',
          parameters: [
            {
              name: 'packageId',
              type: 'string',
              description: 'The FHIR package identifier (e.g., hl7.fhir.us.core)',
              required: true
            },
            {
              name: 'version',
              type: 'string',
              description: 'The package version (e.g., 6.1.0)',
              required: true
            }
          ]
        },
        {
          name: 'list-cached',
          description: 'List all currently cached FHIR packages in the local cache.',
          parameters: []
        },
        {
          name: 'get-package-info',
          description: 'Get detailed information about a cached FHIR package, including its package.json metadata.',
          parameters: [
            {
              name: 'packageId',
              type: 'string',
              description: 'The FHIR package identifier',
              required: true
            },
            {
              name: 'version',
              type: 'string',
              description: 'The package version',
              required: true
            }
          ]
        }
      ],
      author: 'FHIR Package Agent Team',
      homepage: 'https://github.com/a2aproject/fhir-package-agent'
    };
  }

  /**
   * Execute agent logic based on the incoming request
   * @param {Object} context - The request context from A2A
   * @param {Object} eventBus - Event bus for publishing responses
   */
  async execute(context, eventBus) {
    const { request } = context;

    // Extract the skill being invoked
    const skill = this.extractSkill(request);

    if (!skill) {
      eventBus.publishMessage({
        role: 'agent',
        parts: [{
          type: 'text',
          text: 'Please specify a skill to execute. Available skills: ensure-package, list-cached, get-package-info'
        }]
      });
      return;
    }

    try {
      switch (skill.name) {
        case 'ensure-package':
          await this.handleEnsurePackage(skill.params, eventBus);
          break;
        case 'list-cached':
          await this.handleListCached(eventBus);
          break;
        case 'get-package-info':
          await this.handleGetPackageInfo(skill.params, eventBus);
          break;
        default:
          eventBus.publishMessage({
            role: 'agent',
            parts: [{
              type: 'text',
              text: `Unknown skill: ${skill.name}`
            }]
          });
      }
    } catch (error) {
      eventBus.publishMessage({
        role: 'agent',
        parts: [{
          type: 'text',
          text: `Error: ${error.message}`
        }]
      });
    }
  }

  /**
   * Extract skill name and parameters from request
   */
  extractSkill(request) {
    // Try to parse from user message
    const userMessage = request.messages?.[request.messages.length - 1];
    if (!userMessage) return null;

    const text = userMessage.parts?.find(p => p.type === 'text')?.text || '';

    // Simple parsing - look for skill names in the message
    if (text.includes('ensure-package') || text.includes('download') || text.includes('ensure')) {
      const packageIdMatch = text.match(/package[:\s]+([a-z0-9.-]+)/i);
      const versionMatch = text.match(/version[:\s]+([0-9.]+)/i);

      if (packageIdMatch && versionMatch) {
        return {
          name: 'ensure-package',
          params: {
            packageId: packageIdMatch[1],
            version: versionMatch[1]
          }
        };
      }
    }

    if (text.includes('list') || text.includes('cached')) {
      return { name: 'list-cached', params: {} };
    }

    if (text.includes('get-package-info') || text.includes('info')) {
      const packageIdMatch = text.match(/package[:\s]+([a-z0-9.-]+)/i);
      const versionMatch = text.match(/version[:\s]+([0-9.]+)/i);

      if (packageIdMatch && versionMatch) {
        return {
          name: 'get-package-info',
          params: {
            packageId: packageIdMatch[1],
            version: versionMatch[1]
          }
        };
      }
    }

    return null;
  }

  /**
   * Handle the ensure-package skill
   */
  async handleEnsurePackage(params, eventBus) {
    const { packageId, version } = params;

    if (!packageId || !version) {
      throw new Error('Both packageId and version are required');
    }

    eventBus.publishMessage({
      role: 'agent',
      parts: [{
        type: 'text',
        text: `Ensuring FHIR package ${packageId}@${version}...`
      }]
    });

    const result = await this.runFhirAgent(['ensure', packageId, version]);

    if (result.success) {
      const packagePath = result.path || `${this.cacheRoot}/packages/${packageId}#${version}`;

      eventBus.publishMessage({
        role: 'agent',
        parts: [
          {
            type: 'text',
            text: `✓ Package ${packageId}@${version} is ready!\n\nPath: ${packagePath}\n\n${result.output}`
          }
        ]
      });

      // Optionally publish as an artifact
      eventBus.publishArtifact({
        name: `${packageId}@${version}`,
        type: 'fhir-package',
        data: {
          packageId,
          version,
          path: packagePath
        }
      });
    } else {
      throw new Error(`Failed to ensure package: ${result.error || result.output}`);
    }
  }

  /**
   * Handle the list-cached skill
   */
  async handleListCached(eventBus) {
    const packagesDir = join(this.cacheRoot, 'packages');

    try {
      const entries = await readdir(packagesDir);
      const packages = entries
        .filter(entry => entry.includes('#') && !entry.includes('.tmp'))
        .map(entry => {
          const [id, version] = entry.split('#');
          return { id, version, path: join(packagesDir, entry) };
        });

      if (packages.length === 0) {
        eventBus.publishMessage({
          role: 'agent',
          parts: [{
            type: 'text',
            text: 'No cached packages found.'
          }]
        });
      } else {
        const list = packages.map(p => `- ${p.id}@${p.version}`).join('\n');
        eventBus.publishMessage({
          role: 'agent',
          parts: [{
            type: 'text',
            text: `Cached FHIR packages (${packages.length}):\n\n${list}`
          }]
        });

        eventBus.publishArtifact({
          name: 'cached-packages',
          type: 'package-list',
          data: packages
        });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        eventBus.publishMessage({
          role: 'agent',
          parts: [{
            type: 'text',
            text: 'Cache directory does not exist yet. No packages cached.'
          }]
        });
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle the get-package-info skill
   */
  async handleGetPackageInfo(params, eventBus) {
    const { packageId, version } = params;

    if (!packageId || !version) {
      throw new Error('Both packageId and version are required');
    }

    const packagePath = join(this.cacheRoot, 'packages', `${packageId}#${version}`);
    const packageJsonPath = join(packagePath, 'package', 'package.json');

    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

      const info = {
        id: packageId,
        version: version,
        path: packagePath,
        name: packageJson.name,
        description: packageJson.description,
        dependencies: packageJson.dependencies || {},
        fhirVersions: packageJson['fhir-version-list'] || packageJson.fhirVersions || []
      };

      eventBus.publishMessage({
        role: 'agent',
        parts: [{
          type: 'text',
          text: `Package: ${info.name || packageId}@${version}\n\nDescription: ${info.description || 'N/A'}\n\nFHIR Versions: ${info.fhirVersions.join(', ') || 'N/A'}\n\nPath: ${packagePath}`
        }]
      });

      eventBus.publishArtifact({
        name: `${packageId}@${version}-info`,
        type: 'package-info',
        data: info
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Package ${packageId}@${version} is not cached. Run ensure-package first.`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Run the FHIR package agent CLI
   */
  async runFhirAgent(args) {
    return new Promise((resolve) => {
      const fullArgs = [
        ...args,
        '--root', this.cacheRoot,
        '--log-level', this.logLevel
      ];

      const child = spawn(this.fhirAgentPath, fullArgs);

      let stdout = '';
      let stderr = '';
      let path = null;

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;

        // Try to extract the path from JSON output
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line);
              if (json.path) {
                path = json.path;
              }
            } catch (e) {
              // Not JSON, ignore
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
          path: path,
          exitCode: code
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          output: stdout,
          error: error.message,
          exitCode: -1
        });
      });
    });
  }
}

export default FhirPackageAgent;
