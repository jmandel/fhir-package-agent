import { type } from 'arktype';
import { spawn, type ChildProcess } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ArkType schemas for runtime validation
const FhirPackageOptionsSchema = type({
  'fhirAgentPath?': 'string',
  'cacheRoot?': 'string',
  'logLevel?': '"Debug" | "Info" | "Warning" | "Error"'
});

const SkillParamsSchema = type({
  'packageId?': 'string',
  'version?': 'string'
});

const MessagePartSchema = type({
  type: 'string',
  'text?': 'string'
});

const RequestMessageSchema = type({
  'role?': 'string',
  'parts?': MessagePartSchema.array()
});

// TypeScript interfaces (compile-time)
export interface FhirPackageOptions {
  fhirAgentPath?: string;
  cacheRoot?: string;
  logLevel?: 'Debug' | 'Info' | 'Warning' | 'Error';
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  skills: Skill[];
  author: string;
  homepage: string;
}

export interface Skill {
  name: string;
  description: string;
  parameters: SkillParameter[];
}

export interface SkillParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface MessagePart {
  type: string;
  text?: string;
}

export interface Message {
  role: string;
  parts?: MessagePart[];
}

export interface RequestContext {
  request: {
    messages?: Message[];
  };
}

export interface EventBus {
  publishMessage(message: Message): void;
  publishArtifact(artifact: Artifact): void;
}

export interface Artifact {
  name: string;
  type: string;
  data: unknown;
}

interface SkillInfo {
  name: string;
  params: Record<string, string>;
}

interface FhirAgentResult {
  success: boolean;
  output: string;
  error?: string;
  path?: string | null;
  exitCode?: number;
}

interface PackageInfo {
  id: string;
  version: string;
  path: string;
}

/**
 * FHIR Package A2A Agent
 *
 * This agent wraps the FHIR package agent CLI to provide A2A-compliant
 * access to FHIR package management functionality.
 */
export class FhirPackageAgent {
  private readonly fhirAgentPath: string;
  private readonly cacheRoot: string;
  private readonly logLevel: string;

  constructor(options: FhirPackageOptions = {}) {
    // Validate options at runtime with ArkType
    const validatedOptions = FhirPackageOptionsSchema(options);
    if (validatedOptions instanceof type.errors) {
      throw new Error(`Invalid options: ${validatedOptions.summary}`);
    }

    this.fhirAgentPath = options.fhirAgentPath || resolve(__dirname, '../../bin/fhir-package-agent');
    this.cacheRoot = options.cacheRoot || join(os.homedir(), '.fhir');
    this.logLevel = options.logLevel || 'Info';
  }

  /**
   * Get the agent card that defines this agent's capabilities
   */
  getAgentCard(): AgentCard {
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
   */
  async execute(context: RequestContext, eventBus: EventBus): Promise<void> {
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      eventBus.publishMessage({
        role: 'agent',
        parts: [{
          type: 'text',
          text: `Error: ${errorMessage}`
        }]
      });
    }
  }

  /**
   * Extract skill name and parameters from request
   */
  private extractSkill(request: RequestContext['request']): SkillInfo | null {
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
            packageId: packageIdMatch[1]!,
            version: versionMatch[1]!
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
            packageId: packageIdMatch[1]!,
            version: versionMatch[1]!
          }
        };
      }
    }

    return null;
  }

  /**
   * Handle the ensure-package skill
   */
  private async handleEnsurePackage(params: Record<string, string>, eventBus: EventBus): Promise<void> {
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
  private async handleListCached(eventBus: EventBus): Promise<void> {
    const packagesDir = join(this.cacheRoot, 'packages');

    try {
      const entries = await readdir(packagesDir);
      const packages: PackageInfo[] = entries
        .filter(entry => entry.includes('#') && !entry.includes('.tmp'))
        .map(entry => {
          const [id, version] = entry.split('#');
          return { id: id!, version: version!, path: join(packagesDir, entry) };
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
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
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
  private async handleGetPackageInfo(params: Record<string, string>, eventBus: EventBus): Promise<void> {
    const { packageId, version } = params;

    if (!packageId || !version) {
      throw new Error('Both packageId and version are required');
    }

    const packagePath = join(this.cacheRoot, 'packages', `${packageId}#${version}`);
    const packageJsonPath = join(packagePath, 'package', 'package.json');

    try {
      const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent) as Record<string, unknown>;

      const info = {
        id: packageId,
        version: version,
        path: packagePath,
        name: packageJson.name as string,
        description: packageJson.description as string,
        dependencies: packageJson.dependencies || {},
        fhirVersions: (packageJson['fhir-version-list'] || packageJson.fhirVersions || []) as string[]
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
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Package ${packageId}@${version} is not cached. Run ensure-package first.`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Run the FHIR package agent CLI
   */
  private async runFhirAgent(args: string[]): Promise<FhirAgentResult> {
    return new Promise((resolve) => {
      const fullArgs = [
        ...args,
        '--root', this.cacheRoot,
        '--log-level', this.logLevel
      ];

      const child: ChildProcess = spawn(this.fhirAgentPath, fullArgs);

      let stdout = '';
      let stderr = '';
      let path: string | null = null;

      child.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        stdout += output;

        // Try to extract the path from JSON output
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line) as { path?: string };
              if (json.path) {
                path = json.path;
              }
            } catch (e) {
              // Not JSON, ignore
            }
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
          path: path,
          exitCode: code ?? undefined
        });
      });

      child.on('error', (error: Error) => {
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
