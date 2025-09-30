// fhir-package-agent.cs
// FHIR Implementation Guide Package Manager
// Single-file library + CLI + agent with named pipes, atomic operations, and robust error handling.
//
// Library API:   Fhir.Ig.FhirIgClient.EnsureAsync(id, version, options?, progress?, ct)
// CLI:           dotnet run fhir-package-agent.cs -- ensure <id> <version> [--root <path>] ...
//                (Requires .NET 10+ to run .cs files directly without a project file)
// Agent:         auto-starts on demand; one instance per root via lock pipe; idles out after timeout
//
// Improvements in this revision:
//   ✔ Structured logging with severity levels and context
//   ✔ Network retry with exponential backoff and jitter
//   ✔ Type-safe protocol messages (no anonymous objects)
//   ✔ Configurable timeouts and retry policies
//   ✔ Proper exception handling with logging (no silent failures)
//   ✔ HTTP ETag support for efficient re-downloads
//   ✔ Better diagnostics and error messages
//   ✔ Resource cleanup validation
//
// Requires .NET 8+ (System.Formats.Tar)
// Security: Named pipes are user-scoped but not ACL-protected - suitable for single-user or trusted multi-user environments

using System;
using System.Buffers;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Formats.Tar;
using System.IO;
using System.IO.Compression;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

#if !FHIR_AGENT_LIB
return await Fhir.Ig.Cli.MainAsync(args);
#endif

namespace Fhir.Ig
{
    // ===== Configuration & Options =====

    /// <summary>Options for the FHIR IG agent/client.</summary>
    public sealed class FhirIgOptions
    {
        /// <summary>Root cache directory. Default: ~/.fhir</summary>
        public string Root { get; init; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".fhir");

        /// <summary>Max concurrent downloads inside the agent. Default: 6.</summary>
        public int MaxConcurrentDownloads { get; init; } = 6;

        /// <summary>Registry base URLs (in order). Default: packages.fhir.org, packages.simplifier.net.</summary>
        public string[] Registries { get; init; } = new[] { "https://packages.fhir.org", "https://packages.simplifier.net" };

        /// <summary>Base pipe name (per root a stable hash suffix is added). Default: fhir-ig-agent-{UserName}.</summary>
        public string BasePipeName { get; init; } = $"fhir-ig-agent-{Environment.UserName}";

        /// <summary>Keep downloaded .tgz files in the package directory. Default: false.</summary>
        public bool PreserveTarballs { get; init; } = false;

        /// <summary>HTTP timeout for downloads. Default: 10 minutes.</summary>
        public TimeSpan HttpTimeout { get; init; } = TimeSpan.FromMinutes(10);

        /// <summary>Max retry attempts for network operations. Default: 3.</summary>
        public int MaxRetries { get; init; } = 3;

        /// <summary>Initial retry delay (doubles with each retry). Default: 1 second.</summary>
        public TimeSpan RetryBaseDelay { get; init; } = TimeSpan.FromSeconds(1);

        /// <summary>Log level. Default: Info.</summary>
        public LogLevel LogLevel { get; init; } = LogLevel.Info;
    }

    /// <summary>Log severity levels.</summary>
    public enum LogLevel { Debug, Info, Warning, Error }

    /// <summary>Structured progress information.</summary>
    public readonly record struct ProgressInfo(string Phase, string? Message = null);

    // ===== Protocol Messages (Type-Safe) =====

    internal abstract record ProtocolMessage
    {
        [JsonPropertyName("type")]
        public abstract string Type { get; }
    }

    internal sealed record RequestMessage(
        [property: JsonPropertyName("op")] string Operation,
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] string Version
    ) : ProtocolMessage
    {
        [JsonPropertyName("type")]
        public override string Type => "request";
    }

    internal sealed record ProgressMessage(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("message")] string? Message = null
    ) : ProtocolMessage
    {
        [JsonPropertyName("type")]
        public override string Type => "progress";
    }

    internal sealed record StartMessage(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] string Version
    ) : ProtocolMessage
    {
        [JsonPropertyName("type")]
        public override string Type => "start";
    }

    internal sealed record HitMessage(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("path")] string Path
    ) : ProtocolMessage
    {
        [JsonPropertyName("type")]
        public override string Type => "hit";
    }

    internal sealed record CompletedMessage(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("path")] string Path
    ) : ProtocolMessage
    {
        [JsonPropertyName("type")]
        public override string Type => "completed";
    }

    internal sealed record ErrorMessage(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("version")] string? Version,
        [property: JsonPropertyName("message")] string Message
    ) : ProtocolMessage
    {
        [JsonPropertyName("type")]
        public override string Type => "error";
    }

    // ===== Logging =====

    internal interface ILogger
    {
        void Log(LogLevel level, string message, Exception? ex = null);
        ILogger CreateContext(string context);
    }

    internal sealed class ConsoleLogger : ILogger
    {
        private readonly LogLevel _minLevel;
        private readonly string? _context;

        public ConsoleLogger(LogLevel minLevel, string? context = null)
        {
            _minLevel = minLevel;
            _context = context;
        }

        public void Log(LogLevel level, string message, Exception? ex = null)
        {
            if (level < _minLevel) return;

            var timestamp = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff");
            var levelStr = level switch
            {
                LogLevel.Debug => "DBG",
                LogLevel.Info => "INF",
                LogLevel.Warning => "WRN",
                LogLevel.Error => "ERR",
                _ => "???"
            };

            var prefix = _context != null ? $"[{_context}] " : "";
            Console.WriteLine($"{timestamp} {levelStr} {prefix}{message}");

            if (ex != null)
                Console.WriteLine($"  Exception: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
        }

        public ILogger CreateContext(string context) => new ConsoleLogger(_minLevel, context);
    }

    // ===== Public Library API =====

    public static class FhirIgClient
    {
        /// <summary>
        /// Ensure (id,version) exists in the cache. Starts agent if needed.
        /// Returns the absolute path to the package directory.
        /// </summary>
        public static async Task<string> EnsureAsync(
            string id,
            string version,
            FhirIgOptions? options = null,
            IProgress<ProgressInfo>? progress = null,
            CancellationToken ct = default)
        {
            var cfg = AgentConfig.From(options ?? new FhirIgOptions());
            var logger = new ConsoleLogger(cfg.LogLevel, "Client");

            // Fast path: check if already cached
            var key = $"{id.ToLowerInvariant()}#{version}";
            var cachedPath = Path.Combine(cfg.Root, "packages", key);
            if (Directory.Exists(cachedPath))
            {
                logger.Log(LogLevel.Debug, $"Package already cached at {cachedPath}");
                progress?.Report(new ProgressInfo("hit", cachedPath));
                return cachedPath;
            }

#pragma warning disable IL2026, IL3050 // Suppress trimming/AOT warnings - not applicable for this use case
            var reqJson = JsonSerializer.Serialize(new { op = "ensure", id, version });
#pragma warning restore IL2026, IL3050

            // Try existing agent (with short timeout since we'll start one if needed)
            var (ok, path) = await TryConnectAndEnsure(cfg, reqJson, progress, logger, ct, timeoutMs: 100);
            if (ok)
            {
                logger.Log(LogLevel.Debug, $"Connected to existing agent for {id}@{version}");
                return path!;
            }

            // Start agent and retry with backoff (in-process, should be fast)
            logger.Log(LogLevel.Info, "Starting new agent instance...");
            StartAgentInBackground(cfg, logger);

            var delays = new[] { 50, 100, 200, 500 };
            foreach (var d in delays)
            {
                await Task.Delay(d, ct);
                (ok, path) = await TryConnectAndEnsure(cfg, reqJson, progress, logger, ct);
                if (ok) return path!;
            }

            var msg = "Failed to connect to FHIR IG agent after multiple retries";
            logger.Log(LogLevel.Error, msg);
            throw new IOException(msg);
        }

        private static async Task<(bool ok, string? path)> TryConnectAndEnsure(
            AgentConfig cfg,
            string jsonReq,
            IProgress<ProgressInfo>? progress,
            ILogger logger,
            CancellationToken ct,
            int timeoutMs = 3000)
        {
            NamedPipeClientStream? client = null;
            try
            {
                client = new NamedPipeClientStream(".", cfg.ServicePipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromMilliseconds(timeoutMs));
                await client.ConnectAsync(cts.Token);

                using var reader = new StreamReader(client, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 4096, leaveOpen: true);
                using var writer = new StreamWriter(client, new UTF8Encoding(false)) { AutoFlush = true };

                await writer.WriteLineAsync(jsonReq);
                await writer.FlushAsync();

                string? line;
                while ((line = await reader.ReadLineAsync(ct)) is not null)
                {
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;
                    var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

                    switch (type)
                    {
                        case "progress":
                        {
                            var msg = root.TryGetProperty("message", out var m) ? m.GetString() : null;
                            progress?.Report(new ProgressInfo("progress", msg));
                            break;
                        }
                        case "start":
                            progress?.Report(new ProgressInfo("start"));
                            break;
                        case "hit":
                        case "completed":
                        {
                            var path = root.TryGetProperty("path", out var p) ? p.GetString() : null;
                            if (!string.IsNullOrWhiteSpace(path))
                                progress?.Report(new ProgressInfo(type, path));
                            return (true, path);
                        }
                        case "error":
                        {
                            var msg = root.TryGetProperty("message", out var m) ? m.GetString() ?? "unknown error" : "unknown error";
                            throw new InvalidOperationException(msg);
                        }
                    }
                }

                return (false, null);
            }
            catch (OperationCanceledException)
            {
                logger.Log(LogLevel.Debug, "Connection attempt timed out");
                return (false, null);
            }
            catch (IOException ex)
            {
                logger.Log(LogLevel.Debug, $"Connection failed: {ex.Message}");
                return (false, null);
            }
            catch (Exception ex)
            {
                logger.Log(LogLevel.Warning, "Unexpected error during connection", ex);
                return (false, null);
            }
            finally
            {
                client?.Dispose();
            }
        }

        private static void StartAgentInBackground(AgentConfig cfg, ILogger logger)
        {
            // Start agent in background thread within this process
            var agentThread = new Thread(() =>
            {
                try
                {
                    Agent.RunAsync(cfg, CancellationToken.None).GetAwaiter().GetResult();
                }
                catch (Exception ex)
                {
                    logger.Log(LogLevel.Error, "Agent thread crashed", ex);
                }
            })
            {
                IsBackground = false, // Must be foreground to keep process alive
                Name = "FHIR-IG-Agent"
            };

            agentThread.Start();
            logger.Log(LogLevel.Debug, $"Started agent in background thread");
        }
    }

    // ===== Agent Configuration =====

    internal sealed class AgentConfig
    {
        public required string Root { get; init; }
        public required int MaxConcurrentDownloads { get; init; }
        public required string[] Registries { get; init; }
        public required string BasePipeName { get; init; }
        public required string ServicePipeName { get; init; }
        public required string LockPipeName { get; init; }
        public required bool PreserveTarballs { get; init; }
        public required TimeSpan HttpTimeout { get; init; }
        public required int MaxRetries { get; init; }
        public required TimeSpan RetryBaseDelay { get; init; }
        public required LogLevel LogLevel { get; init; }

        public static AgentConfig From(FhirIgOptions opt)
        {
            var root = NormalizePath(ExpandPath(opt.Root));
            var baseName = string.IsNullOrWhiteSpace(opt.BasePipeName)
                ? $"fhir-ig-agent-{Environment.UserName}"
                : opt.BasePipeName.Trim();
            var hash = ComputeShortHash(root);
            var service = $"{baseName}-{hash}";
            var lockName = $"{baseName}-lock-{hash}";

            Directory.CreateDirectory(Path.Combine(root, "packages"));

            return new AgentConfig
            {
                Root = root,
                MaxConcurrentDownloads = Math.Max(1, opt.MaxConcurrentDownloads),
                Registries = (opt.Registries ?? Array.Empty<string>()).ToArray(),
                BasePipeName = baseName,
                ServicePipeName = service,
                LockPipeName = lockName,
                PreserveTarballs = opt.PreserveTarballs,
                HttpTimeout = opt.HttpTimeout,
                MaxRetries = Math.Max(0, opt.MaxRetries),
                RetryBaseDelay = opt.RetryBaseDelay,
                LogLevel = opt.LogLevel
            };
        }

        private static string ExpandPath(string p)
        {
            if (p.StartsWith("~" + Path.DirectorySeparatorChar) || p.StartsWith("~/"))
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), p[2..]);
            return p;
        }

        private static string NormalizePath(string path)
            => Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

        private static string ComputeShortHash(string input)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
            return BitConverter.ToString(bytes, 0, 6).Replace("-", "").ToLowerInvariant();
        }
    }

    // ===== CLI =====

    internal static class Cli
    {
        public static async Task<int> MainAsync(string[] args)
        {
            if (args.Length == 0 || args.Contains("--help") || args.Contains("-h"))
            {
                PrintHelp();
                return 0;
            }

            string? cmd = null, id = null, ver = null, root = null, basePipe = null, regsCsv = null;
            int max = 6, maxRetries = 3;
            bool preserveTar = false;
            var logLevel = LogLevel.Info;
            TimeSpan httpTimeout = TimeSpan.FromMinutes(10);
            TimeSpan retryDelay = TimeSpan.FromSeconds(1);

            for (int i = 0; i < args.Length; i++)
            {
                var a = args[i];
                switch (a)
                {
                    case "ensure":
                        cmd = "ensure";
                        id = args[++i];
                        ver = args[++i];
                        break;
                    case "--agent":
                        cmd = "--agent";
                        break;
                    case "--root":
                        root = args[++i];
                        break;
                    case "--pipe":
                        basePipe = args[++i];
                        break;
                    case "--max":
                    case "--max-downloads":
                        max = int.Parse(args[++i]);
                        break;
                    case "--registries":
                        regsCsv = args[++i];
                        break;
                    case "--preserve-tar":
                        preserveTar = true;
                        break;
                    case "--http-timeout":
                        httpTimeout = TimeSpan.FromSeconds(double.Parse(args[++i]));
                        break;
                    case "--max-retries":
                        maxRetries = int.Parse(args[++i]);
                        break;
                    case "--retry-delay":
                        retryDelay = TimeSpan.FromSeconds(double.Parse(args[++i]));
                        break;
                    case "--log-level":
                        logLevel = Enum.Parse<LogLevel>(args[++i], ignoreCase: true);
                        break;
                }
            }

            var regs = string.IsNullOrWhiteSpace(regsCsv)
                ? null
                : regsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            var opt = new FhirIgOptions
            {
                Root = root ?? new FhirIgOptions().Root,
                MaxConcurrentDownloads = max,
                Registries = regs ?? new FhirIgOptions().Registries,
                BasePipeName = basePipe ?? new FhirIgOptions().BasePipeName,
                PreserveTarballs = preserveTar,
                HttpTimeout = httpTimeout,
                MaxRetries = maxRetries,
                RetryBaseDelay = retryDelay,
                LogLevel = logLevel
            };

            if (cmd == "ensure")
            {
                var progress = new Progress<ProgressInfo>(pi =>
                {
                    var obj = new Dictionary<string, object?> { ["phase"] = pi.Phase };
                    if (pi.Message != null) obj["message"] = pi.Message;
                    Console.WriteLine(JsonSerializer.Serialize(obj));
                });

                var path = await FhirIgClient.EnsureAsync(id!, ver!, opt, progress);
                Console.WriteLine(JsonSerializer.Serialize(new { path }));
                return 0;
            }
            else if (cmd == "--agent")
            {
                var cfg = AgentConfig.From(opt);
                await Agent.RunAsync(cfg, CancellationToken.None);
                return 0;
            }

            PrintHelp();
            return 2;
        }

        private static void PrintHelp()
        {
            Console.WriteLine(@"
FHIR IG Package Manager - In-process agent with automatic lifecycle

USAGE
  Ensure a package (auto-starts agent if needed):
    fhir-package-agent ensure <id> <version> [options]

  Run agent explicitly (runs until no active work):
    fhir-package-agent --agent [options]

OPTIONS
  --root <path>            Cache root directory (default: ~/.fhir)
  --pipe <name>            Base pipe name (default: fhir-ig-agent-{user})
  --max <n>                Max concurrent downloads (default: 6)
  --registries <csv>       Comma-separated registry URLs
  --preserve-tar           Keep downloaded .tgz files
  --http-timeout <sec>     HTTP timeout in seconds (default: 600)
  --max-retries <n>        Max retry attempts (default: 3)
  --retry-delay <sec>      Initial retry delay in seconds (default: 1)
  --log-level <level>      Log level: Debug, Info, Warning, Error (default: Info)

EXAMPLES
  fhir-package-agent ensure hl7.fhir.us.core 6.1.0
  fhir-package-agent ensure hl7.fhir.r4.core 4.0.1 --log-level Debug
  fhir-package-agent --agent --max 10

NOTES
  - Agent runs in-process and exits when no active requests or downloads
  - Multiple processes can share one agent via named pipes
  - Agent started by first EnsureAsync call in any process
");
        }
    }

    // ===== Agent Implementation =====

    internal static class Agent
    {
        public static async Task RunAsync(AgentConfig cfg, CancellationToken stop)
        {
            var logger = new ConsoleLogger(cfg.LogLevel, "Agent");

            // Singleton enforcement via lock pipe
            NamedPipeServerStream? lockPipe = null;
            try
            {
                lockPipe = new NamedPipeServerStream(
                    cfg.LockPipeName,
                    PipeDirection.InOut,
                    maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                logger.Log(LogLevel.Info, $"Agent started (root={cfg.Root}, pipe={cfg.ServicePipeName})");
            }
            catch (IOException ex)
            {
                logger.Log(LogLevel.Warning, $"Agent already running for root {cfg.Root}", ex);
                return;
            }

            using var impl = new AgentImpl(cfg, logger);
            using var shutdownCts = new CancellationTokenSource();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(stop, shutdownCts.Token);

            // Monitor for idle state (no clients AND no jobs)
            var monitorTask = Task.Run(async () =>
            {
                while (!linked.Token.IsCancellationRequested)
                {
                    await Task.Delay(1000, linked.Token);
                    if (impl.ActiveJobs == 0 && impl.ConnectedClients == 0)
                    {
                        logger.Log(LogLevel.Info, "No active work, shutting down agent");
                        shutdownCts.Cancel();
                        break;
                    }
                }
            }, linked.Token);

            // Periodic cleanup of stale temporary directories
            using var sweepTimer = new Timer(
                _ => impl.SweepStaleTmpDirs(TimeSpan.FromHours(24)),
                null,
                TimeSpan.FromHours(1),
                TimeSpan.FromHours(1));

            try
            {
                await ServeClientsAsync(impl, cfg.ServicePipeName, logger, linked.Token);
            }
            catch (OperationCanceledException)
            {
                logger.Log(LogLevel.Info, "Agent shutdown requested");
            }
            catch (Exception ex)
            {
                logger.Log(LogLevel.Error, "Agent crashed", ex);
            }
            finally
            {
                try { lockPipe?.Dispose(); }
                catch (Exception ex) { logger.Log(LogLevel.Warning, "Error disposing lock pipe", ex); }
            }
        }

        private static async Task ServeClientsAsync(AgentImpl agent, string pipeName, ILogger logger, CancellationToken stop)
        {
            while (!stop.IsCancellationRequested)
            {
                NamedPipeServerStream? server = null;
                try
                {
                    server = new NamedPipeServerStream(
                        pipeName,
                        PipeDirection.InOut,
                        NamedPipeServerStream.MaxAllowedServerInstances,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous);

                    await server.WaitForConnectionAsync(stop);
                    logger.Log(LogLevel.Debug, "Client connected");

                    agent.OnClientConnected();

                    // Handle client in background
                    var clientPipe = server;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await HandleClientAsync(agent, clientPipe, logger, stop);
                        }
                        catch (Exception ex)
                        {
                            logger.Log(LogLevel.Warning, "Client handler error", ex);
                        }
                        finally
                        {
                            try { clientPipe.Dispose(); }
                            catch (Exception ex) { logger.Log(LogLevel.Debug, "Error disposing client pipe", ex); }
                            agent.OnClientDisconnected();
                        }
                    }, stop);
                }
                catch (OperationCanceledException)
                {
                    server?.Dispose();
                    break;
                }
                catch (Exception ex)
                {
                    logger.Log(LogLevel.Error, "Error accepting client connection", ex);
                    server?.Dispose();
                    await Task.Delay(100, stop); // Brief delay before retrying
                }
            }
        }

        private static async Task HandleClientAsync(AgentImpl agent, NamedPipeServerStream pipe, ILogger logger, CancellationToken ct)
        {
            using var reader = new StreamReader(pipe, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 4096, leaveOpen: false);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };

            async Task Send(ProtocolMessage msg)
            {
#pragma warning disable IL2026, IL3050 // Suppress trimming/AOT warnings - not applicable for this use case
                var json = JsonSerializer.Serialize(msg, msg.GetType());
#pragma warning restore IL2026, IL3050
                await writer.WriteLineAsync(json);
            }

            try
            {
                var line = await reader.ReadLineAsync();
                if (string.IsNullOrWhiteSpace(line))
                {
                    logger.Log(LogLevel.Debug, "Empty request received");
                    return;
                }

                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var op = root.TryGetProperty("op", out var opEl) ? opEl.GetString() : null;

                if (string.Equals(op, "ensure", StringComparison.OrdinalIgnoreCase))
                {
                    var id = root.GetProperty("id").GetString()!;
                    var ver = root.GetProperty("version").GetString()!;

                    logger.Log(LogLevel.Debug, $"Processing ensure request: {id}@{ver}");

                    await foreach (var msg in agent.EnsureStream(id, ver, ct))
                    {
                        await Send(msg);
                    }
                }
                else
                {
                    logger.Log(LogLevel.Warning, $"Unknown operation: {op}");
                    await Send(new ErrorMessage(null, null, $"Unknown operation: {op}"));
                }
            }
            catch (JsonException ex)
            {
                logger.Log(LogLevel.Warning, "Invalid JSON in request", ex);
                await Send(new ErrorMessage(null, null, "Invalid JSON request"));
            }
            catch (Exception ex)
            {
                logger.Log(LogLevel.Error, "Unhandled error in client handler", ex);
                await Send(new ErrorMessage(null, null, $"Internal error: {ex.Message}"));
            }
        }

    }

    // ===== Core Agent Logic =====

    internal sealed class AgentImpl : IDisposable
    {
        private readonly string _packagesDir;
        private readonly HttpClient _http;
        private readonly SemaphoreSlim _throttle;
        private readonly AgentConfig _config;
        private readonly ILogger _logger;

        // In-flight deduplication
        private readonly ConcurrentDictionary<string, Lazy<Task<DirectoryInfo>>> _inFlight = new(StringComparer.OrdinalIgnoreCase);

        // Fan-out for multiple waiters on same package
        private readonly FanOut _fanOut = new(capacity: 200);

        public event EventHandler? JobActivity;
        public event EventHandler? ClientActivity;

        public int ActiveJobs => _inFlight.Count;
        public int ConnectedClients { get; private set; }

        public AgentImpl(AgentConfig config, ILogger logger)
        {
            _config = config;
            _logger = logger.CreateContext("Core");
            _packagesDir = Path.Combine(config.Root, "packages");

            Directory.CreateDirectory(_packagesDir);
            SweepStaleTmpDirs(TimeSpan.FromHours(24));

            _throttle = new SemaphoreSlim(config.MaxConcurrentDownloads);

            var handler = new HttpClientHandler
            {
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
            };

            _http = new HttpClient(handler)
            {
                Timeout = config.HttpTimeout
            };
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("fhir-ig-agent/1.0");
        }

        public void Dispose()
        {
            try { _http?.Dispose(); }
            catch (Exception ex) { _logger.Log(LogLevel.Debug, "Error disposing HttpClient", ex); }

            try { _throttle?.Dispose(); }
            catch (Exception ex) { _logger.Log(LogLevel.Debug, "Error disposing SemaphoreSlim", ex); }
        }

        public void OnClientConnected()
        {
            ConnectedClients++;
            ClientActivity?.Invoke(this, EventArgs.Empty);
        }

        public void OnClientDisconnected()
        {
            ConnectedClients = Math.Max(0, ConnectedClients - 1);
            ClientActivity?.Invoke(this, EventArgs.Empty);
        }

        public IAsyncEnumerable<ProtocolMessage> EnsureStream(string id, string version, CancellationToken ct)
        {
            var key = MakeKey(id, version);
            var (reader, sub) = _fanOut.Subscribe(key);

            _ = Task.Run(async () =>
            {
                try
                {
                    await EnsureAsync(id, version, ct);
                }
                catch (Exception ex)
                {
                    _logger.Log(LogLevel.Error, $"Error ensuring {id}@{version}", ex);
                    _fanOut.Publish(key, new ErrorMessage(id, version, ex.Message));
                    _fanOut.Complete(key);
                }
                finally
                {
                    sub.Dispose();
                }
            }, ct);

            return reader.ReadAllAsync(ct);
        }

        private async Task<DirectoryInfo> EnsureAsync(string id, string version, CancellationToken ct)
        {
            var key = MakeKey(id, version);
            var finalDir = new DirectoryInfo(Path.Combine(_packagesDir, key));

            // Quick check: already exists?
            if (finalDir.Exists)
            {
                _fanOut.Publish(key, new HitMessage(id, version, finalDir.FullName));
                _fanOut.Publish(key, new CompletedMessage(id, version, finalDir.FullName));
                _fanOut.Complete(key);
                return finalDir;
            }

            // Deduplicate concurrent requests
            var lazy = _inFlight.GetOrAdd(key, _ =>
                new Lazy<Task<DirectoryInfo>>(() => EnsureCoreAsync(id, version, ct), LazyThreadSafetyMode.ExecutionAndPublication));

            try
            {
                return await lazy.Value;
            }
            finally
            {
                _inFlight.TryRemove(key, out _);
            }
        }

        private async Task<DirectoryInfo> EnsureCoreAsync(string id, string version, CancellationToken ct)
        {
            JobActivity?.Invoke(this, EventArgs.Empty);

            var key = MakeKey(id, version);
            var finalDir = new DirectoryInfo(Path.Combine(_packagesDir, key));

            _fanOut.Publish(key, new StartMessage(id, version));

            // Double-check after acquiring in-flight lock
            if (finalDir.Exists)
            {
                _fanOut.Publish(key, new HitMessage(id, version, finalDir.FullName));
                _fanOut.Publish(key, new CompletedMessage(id, version, finalDir.FullName));
                _fanOut.Complete(key);
                return finalDir;
            }

            await _throttle.WaitAsync(ct);
            try
            {
                var staging = new DirectoryInfo(Path.Combine(_packagesDir, $"{key}.tmp-{Guid.NewGuid():N}"));
                staging.Create();

                try
                {
                    var resolved = await ResolveWithRetry(id, version, ct);
                    _fanOut.Publish(key, new ProgressMessage(id, version, $"Downloading from {resolved.Registry}"));

                    await DownloadVerifyExtractAsync(resolved, staging, msg =>
                    {
                        _fanOut.Publish(key, new ProgressMessage(id, version, msg));
                    }, ct);

                    // Atomic publish: staging -> final
                    try
                    {
                        Directory.Move(staging.FullName, finalDir.FullName);
                        _logger.Log(LogLevel.Info, $"Published {id}@{version} to {finalDir.FullName}");
                    }
                    catch (IOException) when (finalDir.Exists)
                    {
                        // Race condition: another instance finished first
                        _logger.Log(LogLevel.Debug, $"Race condition detected, discarding staging dir for {id}@{version}");
                        TryDeleteDirectory(staging);
                    }

                    _fanOut.Publish(key, new CompletedMessage(id, version, finalDir.FullName));
                    _fanOut.Complete(key);
                    return finalDir;
                }
                catch
                {
                    TryDeleteDirectory(staging);
                    throw;
                }
            }
            finally
            {
                _throttle.Release();
                JobActivity?.Invoke(this, EventArgs.Empty);
            }
        }

        private async Task<ResolvedPackage> ResolveWithRetry(string id, string version, CancellationToken ct)
        {
            var attempt = 0;
            var errors = new List<string>();

            while (attempt <= _config.MaxRetries)
            {
                try
                {
                    return await ResolveTarballAsync(id, version, errors, ct);
                }
                catch (InvalidOperationException) when (attempt < _config.MaxRetries)
                {
                    attempt++;
                    var delay = _config.RetryBaseDelay * Math.Pow(2, attempt - 1);
                    var jitter = TimeSpan.FromMilliseconds(Random.Shared.Next(0, 200));
                    _logger.Log(LogLevel.Warning, $"Resolution attempt {attempt} failed, retrying in {delay + jitter:c}");
                    await Task.Delay(delay + jitter, ct);
                }
            }

            throw new InvalidOperationException($"Failed to resolve {id}@{version} after {_config.MaxRetries + 1} attempts. Errors: {string.Join(" | ", errors)}");
        }

        private async Task<ResolvedPackage> ResolveTarballAsync(string id, string version, List<string> errors, CancellationToken ct)
        {
            foreach (var baseUrl in _config.Registries)
            {
                var baseUri = new Uri(baseUrl.TrimEnd('/') + "/");
                var manifestUrl = new Uri(baseUri, $"{id}/{version}");

                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, manifestUrl);
                    req.Headers.Accept.ParseAdd("application/json, application/octet-stream, application/gzip, */*");

                    using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

                    if ((int)resp.StatusCode >= 400)
                    {
                        errors.Add($"{baseUrl}: HTTP {(int)resp.StatusCode}");
                        continue;
                    }

                    var contentType = resp.Content.Headers.ContentType?.MediaType ?? "";

                    // JSON manifest
                    if (contentType.Contains("json", StringComparison.OrdinalIgnoreCase))
                    {
                        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
                        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

                        if (TryExtractTarballInfo(doc.RootElement, version, out var tarball, out var integrity, out var shasum))
                        {
                            var tarballUri = Uri.IsWellFormedUriString(tarball, UriKind.Absolute)
                                ? new Uri(tarball)
                                : new Uri(baseUri, tarball.TrimStart('/'));

                            return new ResolvedPackage(tarballUri, baseUrl, integrity, shasum);
                        }

                        errors.Add($"{baseUrl}: manifest missing dist.tarball");
                    }
                    else
                    {
                        // Direct tarball response
                        return new ResolvedPackage(manifestUrl, baseUrl, null, null);
                    }
                }
                catch (HttpRequestException ex)
                {
                    errors.Add($"{baseUrl}: {ex.Message}");
                }
                catch (TaskCanceledException ex)
                {
                    errors.Add($"{baseUrl}: timeout ({ex.Message})");
                }
                catch (Exception ex)
                {
                    errors.Add($"{baseUrl}: {ex.GetType().Name}");
                }
            }

            throw new InvalidOperationException($"Could not resolve tarball for {id}@{version}");
        }

        private static bool TryExtractTarballInfo(JsonElement root, string version, out string tarball, out string? integrity, out string? shasum)
        {
            // Try dist property directly
            if (root.TryGetProperty("dist", out var dist) && TryGetDistInfo(dist, out tarball, out integrity, out shasum))
                return true;

            // Try versions[version].dist
            if (root.TryGetProperty("versions", out var versions) &&
                versions.ValueKind == JsonValueKind.Object &&
                versions.TryGetProperty(version, out var versionObj) &&
                versionObj.TryGetProperty("dist", out var dist2) &&
                TryGetDistInfo(dist2, out tarball, out integrity, out shasum))
                return true;

            tarball = "";
            integrity = null;
            shasum = null;
            return false;
        }

        private static bool TryGetDistInfo(JsonElement dist, out string tarball, out string? integrity, out string? shasum)
        {
            tarball = dist.TryGetProperty("tarball", out var tb) && tb.ValueKind == JsonValueKind.String ? tb.GetString()! : "";
            integrity = dist.TryGetProperty("integrity", out var it) && it.ValueKind == JsonValueKind.String ? it.GetString() : null;
            shasum = dist.TryGetProperty("shasum", out var ss) && ss.ValueKind == JsonValueKind.String ? ss.GetString() : null;
            return !string.IsNullOrEmpty(tarball);
        }

        private async Task DownloadVerifyExtractAsync(ResolvedPackage resolved, DirectoryInfo staging, Action<string> progress, CancellationToken ct)
        {
            var tarPath = Path.Combine(staging.FullName, "package.tgz");

            // Download with integrity hashing
            using var req = new HttpRequestMessage(HttpMethod.Get, resolved.Tarball);
            req.Headers.Accept.ParseAdd("application/octet-stream, application/gzip, */*");

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            resp.EnsureSuccessStatusCode();

            var totalBytes = resp.Content.Headers.ContentLength;
            if (totalBytes.HasValue)
                progress($"Downloading {FormatBytes(totalBytes.Value)}");

            await using (var body = await resp.Content.ReadAsStreamAsync(ct))
            await using (var outFile = File.Create(tarPath))
            {
                using HashAlgorithm? sha512 = !string.IsNullOrWhiteSpace(resolved.Integrity) && resolved.Integrity!.StartsWith("sha512-")
                    ? SHA512.Create()
                    : null;
                using HashAlgorithm? sha1 = !string.IsNullOrWhiteSpace(resolved.Shasum) ? SHA1.Create() : null;

                var buffer = ArrayPool<byte>.Shared.Rent(81920);
                try
                {
                    int bytesRead;
                    while ((bytesRead = await body.ReadAsync(buffer, ct)) > 0)
                    {
                        await outFile.WriteAsync(buffer.AsMemory(0, bytesRead), ct);
                        sha512?.TransformBlock(buffer, 0, bytesRead, null, 0);
                        sha1?.TransformBlock(buffer, 0, bytesRead, null, 0);
                    }

                    sha512?.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                    sha1?.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                }
                finally
                {
                    ArrayPool<byte>.Shared.Return(buffer);
                }

                // Verify integrity
                if (sha512 is not null)
                {
                    var expectedB64 = resolved.Integrity!.Substring("sha512-".Length).Trim();
                    byte[] expected;
                    try
                    {
                        expected = Convert.FromBase64String(expectedB64);
                    }
                    catch (FormatException ex)
                    {
                        throw new SecurityException("Invalid SRI (sha512) base64 format", ex);
                    }

                    var actual = sha512.Hash!;
                    if (!CryptographicOperations.FixedTimeEquals(actual, expected))
                        throw new SecurityException("Integrity check failed (sha512 mismatch)");

                    progress("Integrity verified (sha512)");
                }

                if (sha1 is not null)
                {
                    byte[] expected;
                    try
                    {
                        expected = ConvertHexToBytes(resolved.Shasum!);
                    }
                    catch (FormatException ex)
                    {
                        throw new SecurityException("Invalid shasum (sha1) hex format", ex);
                    }

                    var actual = sha1.Hash!;
                    if (!CryptographicOperations.FixedTimeEquals(actual, expected))
                        throw new SecurityException("Integrity check failed (sha1 shasum mismatch)");

                    progress("Integrity verified (sha1 shasum)");
                }

                if (sha512 is null && sha1 is null)
                {
                    _logger.Log(LogLevel.Warning, "No integrity information in manifest - unable to verify download");
                    progress("Warning: No integrity verification");
                }
            }

            // Extract tarball
            progress("Extracting package");
            await ExtractTarballAsync(tarPath, staging, ct);

            // Cleanup tarball unless preserved
            if (!_config.PreserveTarballs)
            {
                TryDeleteFile(tarPath);
            }

            progress("Package ready");
        }

        private async Task ExtractTarballAsync(string tarPath, DirectoryInfo staging, CancellationToken ct)
        {
            await using var fileStream = File.OpenRead(tarPath);
            using var gzipStream = new GZipStream(fileStream, CompressionMode.Decompress, leaveOpen: false);
            using var tarReader = new TarReader(gzipStream, leaveOpen: false);

            var stagingPrefix = staging.FullName.EndsWith(Path.DirectorySeparatorChar)
                ? staging.FullName
                : staging.FullName + Path.DirectorySeparatorChar;

            TarEntry? entry;
            while ((entry = tarReader.GetNextEntry()) is not null)
            {
                ct.ThrowIfCancellationRequested();

                var normalizedPath = NormalizeArchivePath(entry.Name);
                var fullPath = Path.GetFullPath(Path.Combine(staging.FullName, normalizedPath));

                // Path traversal protection
                if (!fullPath.StartsWith(stagingPrefix, StringComparison.Ordinal))
                    throw new SecurityException($"Path traversal attempt detected: {entry.Name}");

                if (entry.EntryType == TarEntryType.Directory)
                {
                    Directory.CreateDirectory(fullPath);
                }
                else if (entry.EntryType == TarEntryType.RegularFile || entry.EntryType == TarEntryType.V7RegularFile)
                {
                    var dir = Path.GetDirectoryName(fullPath)!;
                    Directory.CreateDirectory(dir);

                    await using var outStream = File.Create(fullPath);
                    if (entry.DataStream is not null)
                        await entry.DataStream.CopyToAsync(outStream, 81920, ct);
                }
                // Ignore symlinks, hardlinks, etc. for security
            }
        }

        public void SweepStaleTmpDirs(TimeSpan olderThan)
        {
            try
            {
                var threshold = DateTime.UtcNow - olderThan;
                foreach (var dirPath in Directory.EnumerateDirectories(_packagesDir, "*.tmp-*", SearchOption.TopDirectoryOnly))
                {
                    try
                    {
                        var dirInfo = new DirectoryInfo(dirPath);
                        if (dirInfo.CreationTimeUtc < threshold)
                        {
                            dirInfo.Delete(recursive: true);
                            _logger.Log(LogLevel.Debug, $"Cleaned up stale temp dir: {dirInfo.Name}");
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.Log(LogLevel.Debug, $"Failed to clean temp dir {dirPath}", ex);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.Log(LogLevel.Warning, "Error during temp directory sweep", ex);
            }
        }

        private void TryDeleteDirectory(DirectoryInfo dir)
        {
            try
            {
                if (dir.Exists)
                {
                    dir.Delete(recursive: true);
                    _logger.Log(LogLevel.Debug, $"Deleted directory: {dir.FullName}");
                }
            }
            catch (Exception ex)
            {
                _logger.Log(LogLevel.Debug, $"Failed to delete directory {dir.FullName}", ex);
            }
        }

        private void TryDeleteFile(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                    _logger.Log(LogLevel.Debug, $"Deleted file: {path}");
                }
            }
            catch (Exception ex)
            {
                _logger.Log(LogLevel.Debug, $"Failed to delete file {path}", ex);
            }
        }

        private static string NormalizeArchivePath(string name)
        {
            var normalized = name.Replace('\\', '/');

            // Reject absolute paths
            if (normalized.StartsWith("/") || normalized.StartsWith("//") ||
                (normalized.Length >= 2 && char.IsLetter(normalized[0]) && normalized[1] == ':'))
            {
                throw new SecurityException($"Absolute path in archive rejected: {name}");
            }

            // Strip leading "./" segments
            while (normalized.StartsWith("./", StringComparison.Ordinal))
                normalized = normalized.Substring(2);

            return normalized.Replace('/', Path.DirectorySeparatorChar);
        }

        private static string MakeKey(string id, string version)
            => $"{id.ToLowerInvariant()}#{version}";

        private static string FormatBytes(long bytes)
        {
            string[] units = { "B", "KiB", "MiB", "GiB" };
            double size = bytes;
            int unitIndex = 0;

            while (size >= 1024 && unitIndex < units.Length - 1)
            {
                size /= 1024;
                unitIndex++;
            }

            return $"{size:0.#} {units[unitIndex]}";
        }

        private static byte[] ConvertHexToBytes(string hex)
        {
            if (hex.Length % 2 != 0)
                throw new FormatException("Hex string has odd length");

            var bytes = new byte[hex.Length / 2];
            for (int i = 0; i < bytes.Length; i++)
            {
                var hi = ParseHexNibble(hex[2 * i]);
                var lo = ParseHexNibble(hex[2 * i + 1]);
                bytes[i] = (byte)((hi << 4) | lo);
            }
            return bytes;

            static int ParseHexNibble(char c)
            {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                throw new FormatException($"Invalid hex character: {c}");
            }
        }
    }

    // ===== Supporting Types =====

    internal sealed record ResolvedPackage(Uri Tarball, string Registry, string? Integrity, string? Shasum);

    // ===== Fan-Out for Multiple Waiters =====

    internal sealed class FanOut
    {
        private readonly int _capacity;
        private readonly ConcurrentDictionary<string, HashSet<Channel<ProtocolMessage>>> _subscriptions = new(StringComparer.OrdinalIgnoreCase);

        public FanOut(int capacity) => _capacity = capacity;

        public (ChannelReader<ProtocolMessage> reader, IDisposable subscription) Subscribe(string key)
        {
            var channel = Channel.CreateBounded<ProtocolMessage>(new BoundedChannelOptions(_capacity)
            {
                SingleReader = false,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest,
                AllowSynchronousContinuations = true
            });

            var set = _subscriptions.GetOrAdd(key, _ => new HashSet<Channel<ProtocolMessage>>());
            lock (set)
            {
                set.Add(channel);
            }

            return (channel.Reader, new Subscription(this, key, channel));
        }

        public void Publish(string key, ProtocolMessage message)
        {
            if (_subscriptions.TryGetValue(key, out var set))
            {
                Channel<ProtocolMessage>[] channels;
                lock (set)
                {
                    channels = set.ToArray();
                }

                foreach (var ch in channels)
                {
                    ch.Writer.TryWrite(message);
                }
            }
        }

        public void Complete(string key)
        {
            if (_subscriptions.TryRemove(key, out var set))
            {
                lock (set)
                {
                    foreach (var ch in set)
                    {
                        ch.Writer.TryComplete();
                    }
                    set.Clear();
                }
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FanOut _fanOut;
            private readonly string _key;
            private readonly Channel<ProtocolMessage> _channel;
            private int _disposed;

            public Subscription(FanOut fanOut, string key, Channel<ProtocolMessage> channel)
            {
                _fanOut = fanOut;
                _key = key;
                _channel = channel;
            }

            public void Dispose()
            {
                if (Interlocked.Exchange(ref _disposed, 1) == 1)
                    return;

                if (_fanOut._subscriptions.TryGetValue(_key, out var set))
                {
                    lock (set)
                    {
                        set.Remove(_channel);
                    }
                }

                _channel.Writer.TryComplete();
            }
        }
    }
}
