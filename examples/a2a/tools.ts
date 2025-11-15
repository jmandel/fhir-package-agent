import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { spawn, type ChildProcess } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FHIR_AGENT_PATH = resolve(__dirname, '../../bin/fhir-package-agent');
const CACHE_ROOT = join(os.homedir(), '.fhir');

/**
 * Helper to run the FHIR package agent CLI
 */
async function runFhirAgent(args: string[]): Promise<{
  success: boolean;
  output: string;
  error?: string;
  path?: string | null;
}> {
  return new Promise((resolve) => {
    const fullArgs = [...args, '--root', CACHE_ROOT, '--log-level', 'Info'];
    const child: ChildProcess = spawn(FHIR_AGENT_PATH, fullArgs);

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
      });
    });

    child.on('error', (error: Error) => {
      resolve({
        success: false,
        output: stdout,
        error: error.message,
      });
    });
  });
}

/**
 * Tool: Ensure FHIR Package
 *
 * Downloads and caches a FHIR Implementation Guide package.
 */
export const ensurePackageTool = createTool({
  id: 'ensure-fhir-package',
  description: 'Download and ensure a FHIR Implementation Guide package is cached locally. Returns the path to the cached package.',
  inputSchema: z.object({
    packageId: z.string().describe('The FHIR package identifier (e.g., hl7.fhir.us.core)'),
    version: z.string().describe('The package version (e.g., 6.1.0)'),
  }),
  outputSchema: z.object({
    output: z.string(),
    path: z.string().optional(),
    success: z.boolean(),
  }),
  execute: async ({ context }) => {
    const { packageId, version } = context;

    const result = await runFhirAgent(['ensure', packageId, version]);

    if (result.success) {
      const packagePath = result.path || `${CACHE_ROOT}/packages/${packageId}#${version}`;
      return {
        output: `✓ Package ${packageId}@${version} is ready!\n\nPath: ${packagePath}\n\n${result.output}`,
        path: packagePath,
        success: true,
      };
    } else {
      return {
        output: `Failed to ensure package: ${result.error || result.output}`,
        success: false,
      };
    }
  },
});

/**
 * Tool: List Cached Packages
 *
 * Lists all FHIR packages currently cached locally.
 */
export const listCachedTool = createTool({
  id: 'list-cached-fhir-packages',
  description: 'List all FHIR Implementation Guide packages currently cached locally.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    output: z.string(),
    packages: z.array(z.object({
      id: z.string(),
      version: z.string(),
      path: z.string(),
    })).optional(),
    success: z.boolean(),
  }),
  execute: async () => {
    const packagesDir = join(CACHE_ROOT, 'packages');

    try {
      const entries = await readdir(packagesDir);
      const packages = entries
        .filter(entry => entry.includes('#') && !entry.includes('.tmp'))
        .map(entry => {
          const [id, version] = entry.split('#');
          return { id: id!, version: version!, path: join(packagesDir, entry) };
        });

      if (packages.length === 0) {
        return {
          output: 'No cached packages found.',
          packages: [],
          success: true,
        };
      } else {
        const list = packages.map(p => `- ${p.id}@${p.version}`).join('\n');
        return {
          output: `Cached FHIR packages (${packages.length}):\n\n${list}`,
          packages: packages,
          success: true,
        };
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return {
          output: 'Cache directory does not exist yet. No packages cached.',
          packages: [],
          success: true,
        };
      } else {
        return {
          output: `Error listing packages: ${error instanceof Error ? error.message : String(error)}`,
          success: false,
        };
      }
    }
  },
});

/**
 * Tool: Get Package Info
 *
 * Retrieves detailed information about a cached FHIR package.
 */
export const getPackageInfoTool = createTool({
  id: 'get-fhir-package-info',
  description: 'Get detailed information about a cached FHIR Implementation Guide package, including its metadata from package.json.',
  inputSchema: z.object({
    packageId: z.string().describe('The FHIR package identifier'),
    version: z.string().describe('The package version'),
  }),
  outputSchema: z.object({
    output: z.string(),
    info: z.object({
      id: z.string(),
      version: z.string(),
      path: z.string(),
      name: z.string(),
      description: z.string(),
      fhirVersions: z.array(z.string()),
    }).optional(),
    success: z.boolean(),
  }),
  execute: async ({ context }) => {
    const { packageId, version } = context;

    const packagePath = join(CACHE_ROOT, 'packages', `${packageId}#${version}`);
    const packageJsonPath = join(packagePath, 'package', 'package.json');

    try {
      const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent) as Record<string, unknown>;

      const info = {
        id: packageId,
        version: version,
        path: packagePath,
        name: (packageJson.name as string) || packageId,
        description: (packageJson.description as string) || 'N/A',
        fhirVersions: (packageJson['fhir-version-list'] || packageJson.fhirVersions || []) as string[],
      };

      return {
        output: `Package: ${info.name}@${version}\n\nDescription: ${info.description}\n\nFHIR Versions: ${info.fhirVersions.join(', ') || 'N/A'}\n\nPath: ${packagePath}`,
        info: info,
        success: true,
      };
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return {
          output: `Package ${packageId}@${version} is not cached. Run ensure-fhir-package first.`,
          success: false,
        };
      } else {
        return {
          output: `Error reading package info: ${error instanceof Error ? error.message : String(error)}`,
          success: false,
        };
      }
    }
  },
});
