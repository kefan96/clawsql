/**
 * ClawSQL CLI - Interactive REPL
 *
 * Read-Eval-Print Loop for interactive CLI sessions.
 * Features: Real-time suggestions, keyboard navigation, professional UI.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseInput, executeCommand, createCLIContext, CLIContext, getCommand } from './registry.js';
import { AIAgent, createAIAgent, loadAIConfig } from './agent/index.js';
import { createCompleter as createCompleterFn } from './completer.js';
import { StreamingMarkdownProcessor } from './formatter.js';
import { RawInputHandler } from './raw-input.js';
import {
  createBanner,
  createPrompt,
  createDidYouMean,
  clearScreen,
  formatWelcomeMessage,
  theme,
} from './ui/components.js';

/**
 * REPL configuration
 */
export interface REPLConfig {
  prompt: string;
  historyFile: string;
  historySize: number;
}

/**
 * Default REPL configuration
 */
const DEFAULT_CONFIG: REPLConfig = {
  prompt: 'clawsql> ',
  historyFile: path.join(os.homedir(), '.clawsql', 'history'),
  historySize: 1000,
};

/**
 * Interactive REPL session
 */
export class REPL {
  private config: REPLConfig;
  private context: CLIContext;
  private running: boolean = false;
  private history: string[] = [];
  private agent: AIAgent | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private completer: ReturnType<typeof createCompleterFn> | null = null;
  private currentContext: string = '';
  private orchestratorConnected: boolean = false;
  private rawInputHandler: RawInputHandler | null = null;

  constructor(config?: Partial<REPLConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.context = createCLIContext();
    this.loadHistory();
    this.initAgent();
    this.initCompleter();
    this.rawInputHandler = new RawInputHandler(this.getPrompt());
  }

  /**
   * Initialize the completer
   */
  private initCompleter(): void {
    this.completer = createCompleterFn();
  }

  /**
   * Check orchestrator connection
   */
  private async checkOrchestratorConnection(): Promise<boolean> {
    try {
      return await this.context.orchestrator.healthCheck();
    } catch {
      return false;
    }
  }

  /**
   * Initialize AI agent
   */
  private initAgent(): void {
    const aiConfig = loadAIConfig();
    // Always create agent - it will try OpenClaw first, then fall back to LLM
    this.agent = createAIAgent(this.context, {
      enabled: aiConfig.enabled || true, // Default enabled
      provider: aiConfig.provider,
    });
  }

  /**
   * Start the REPL session
   */
  start(): void {
    this.running = true;

    // Keep the process alive for async operations
    this.keepAlive = setInterval(() => {}, 10000);

    // Check orchestrator connection in background
    void this.checkOrchestratorConnection().then(connected => {
      this.orchestratorConnected = connected;
    });

    // Print welcome banner
    this.printBanner();

    // Start the main input loop with raw input handler
    void this.runInputLoop();
  }

  /**
   * Main input loop using RawInputHandler for real-time suggestions
   */
  private async runInputLoop(): Promise<void> {
    while (this.running) {
      try {
        // Show prompt and get input with real-time suggestions
        process.stdout.write(this.getPrompt());
        const result = await this.rawInputHandler!.readLine();

        // Ctrl+D - exit requested
        if (result.exitRequested) {
          this.stop();
          return;
        }

        // Ctrl+C - cancel current input, continue
        if (result.cancelled) {
          continue;
        }

        const input = result.value.trim();

        // Skip empty input
        if (!input) {
          continue;
        }

        // Add to history
        this.addToHistory(input);

        // Handle special commands
        if (input === '/exit' || input === '/quit' || input === '/q') {
          // Move up one line (console.log moved us down), clear, and show goodbye
          process.stdout.write('\x1B[1A\r\x1B[K');
          process.stdout.write(this.getPrompt() + input + ' ' + theme.primary('Goodbye!') + '\n');
          this.stop(false);
          return;
        }

        // Clear screen command
        if (input === '/clear' || input === '/cls') {
          clearScreen();
          this.printBanner();
          continue;
        }

        // Parse and execute command
        const parsed = parseInput(input);
        if (parsed) {
          if (parsed.command) {
            // Check if command exists
            const cmd = getCommand(parsed.command);
            if (!cmd) {
              // Command not found - show suggestions
              if (this.completer) {
                const similar = this.completer.findSimilar(parsed.command);
                console.log(createDidYouMean(`/${parsed.command}`, similar));
              } else {
                console.log(this.context.formatter.error(`Unknown command: /${parsed.command}`));
                console.log(this.context.formatter.info('Type /help to see available commands.'));
              }
              continue;
            }
            await executeCommand(parsed.command, parsed.args, this.context);
          } else {
            // No command prefix - treat as natural language
            await this.handleNaturalLanguage(input);
          }
        }
      } catch (err) {
        console.error('Command error:', err);
      }
    }
  }

  /**
   * Stop the REPL session
   */
  stop(printGoodbye: boolean = true): void {
    // Set running to false immediately to prevent prompt from showing
    this.running = false;

    // Cleanup raw input handler (disable bracketed paste mode)
    if (this.rawInputHandler) {
      this.rawInputHandler.cleanup();
    }

    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    this.saveHistory();
    if (printGoodbye) {
      process.stdout.write(' ' + theme.primary('Goodbye!\n'));
    }
    process.exit(0);
  }

  /**
   * Handle natural language input using AI agent
   */
  private async handleNaturalLanguage(input: string): Promise<void> {
    const processor = new StreamingMarkdownProcessor();
    let gotFirstChunk = false;
    let spinnerInterval: NodeJS.Timeout | null = null;
    const startTime = Date.now();

    // AbortController for cancelling the AI request
    const abortController = new AbortController();
    let wasAborted = false;

    // Start thinking spinner
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const thinkingMessages = [
      'Thinking...',
      'Consulting the cluster...',
      'Querying the depths...',
      'Processing your request...',
      'Analyzing topology...',
      'Connecting the dots...',
      'Parsing SQL mysteries...',
      'Asking the replicas nicely...',
      'Waking up the primary...',
      'Counting rows in background...',
      'Optimizing queries in my head...',
      'Checking for runaway transactions...',
      'Petitioning the binlogs...',
      'Synchronizing brain cells...',
      'Consulting the MySQL oracle...',
      'Herding the clusters...',
      'Decoding network packets...',
      'Channeling database vibes...',
      'Asking nicely for permission...',
      'Negotiating with ProxySQL...',
    ];
    let frameIndex = 0;
    let msgIndex = 0;

    spinnerInterval = setInterval(() => {
      const frame = spinnerFrames[frameIndex % spinnerFrames.length];
      const msg = thinkingMessages[msgIndex % thinkingMessages.length];
      // Clear line before writing to handle shorter messages after longer ones
      process.stdout.write(`\r\x1b[K${frame} ${msg}  ${theme.muted('(double tap ESC to stop)')}`);
      frameIndex++;
      if (frameIndex % 20 === 0) msgIndex++; // Change message every ~2s
    }, 100);

    // Set up ESC key listener to abort AI thinking
    // Require double-ESC to abort: two ESC presses within 500ms
    // This prevents spurious terminal-generated ESC events from triggering abort
    let lastEscTime = 0;
    const doubleEscThresholdMs = 500;
    let abortResolve: (() => void) | null = null;
    const abortPromise = new Promise<void>((resolve) => {
      abortResolve = resolve;
    });

    const escListener = (data: string) => {
      // Ignore if not ESC
      if (data !== '\x1B') {
        return;
      }

      const now = Date.now();

      // Check for double-ESC (two ESCs within threshold)
      if (now - lastEscTime < doubleEscThresholdMs && !wasAborted) {
        // Double-ESC detected - abort!
        wasAborted = true;
        abortController.abort();
        process.stdin.off('data', escListener);

        // Clean up spinner
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
          spinnerInterval = null;
        }

        // Show stopped message
        const elapsed = ((now - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r\x1b[K${theme.warning('⏹ Stopped')} (${elapsed}s)\n`);

        // Immediately resolve the abort promise to unblock the main flow
        // This ensures the prompt appears without waiting for agent cleanup
        if (abortResolve) {
          abortResolve();
        }
      } else {
        // First ESC or too slow - just record the time
        lastEscTime = now;
      }
    };

    // Enable raw mode and add listener
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      if (wasRaw !== true) {
        process.stdin.setRawMode(true);
      }
    }
    process.stdin.on('data', escListener);

    try {
      // Race between the agent processing and the abort promise
      await Promise.race([
        this.agent!.process(input, (chunk: string) => {
          // Ignore chunks if already aborted
          if (wasAborted) {
            return;
          }

          // Stop spinner on first chunk
          if (!gotFirstChunk) {
            gotFirstChunk = true;
            if (spinnerInterval) {
              clearInterval(spinnerInterval);
              spinnerInterval = null;
            }
            // Clear the spinner line
            process.stdout.write('\r\x1b[K');
          }

          const { text, backspace } = processor.process(chunk);
          if (backspace > 0) {
            process.stdout.write(`\x1b[${backspace}D\x1b[K${text}`);
          } else if (text) {
            process.stdout.write(text);
          }
        }, abortController.signal),
        abortPromise,
      ]);

      // Make sure spinner is stopped
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        process.stdout.write('\r\x1b[K');
      }

      // Don't show remaining output if aborted
      if (!wasAborted) {
        const remaining = processor.flush();
        if (remaining) process.stdout.write(remaining);

        process.stdout.write('\n');
      }
    } catch (error) {
      // Clean up spinner
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        process.stdout.write('\r\x1b[K');
      }

      // Don't show error if aborted (already shown by ESC handler)
      if (!wasAborted) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(this.context.formatter.error(`AI error: ${message}`));
      }
    } finally {
      // Clean up ESC listener and restore raw mode
      process.stdin.off('data', escListener);
      if (process.stdin.isTTY && wasRaw !== undefined) {
        process.stdin.setRawMode(wasRaw);
      }
    }
  }

  /**
   * Get the prompt string
   */
  private getPrompt(): string {
    return createPrompt({
      context: this.currentContext || undefined,
      status: 'normal',
    });
  }

  /**
   * Print welcome banner
   */
  private printBanner(): void {
    const version = this.context.settings.appVersion;
    const aiProvider = this.agent?.getProviderName();

    console.log(createBanner({
      version,
      aiStatus: {
        enabled: this.agent?.isConfigured() ?? false,
        provider: aiProvider,
      },
      orchestratorStatus: this.orchestratorConnected ? 'connected' : 'unknown',
    }));

    console.log(formatWelcomeMessage());
  }

  /**
   * Load command history from file
   */
  private loadHistory(): void {
    try {
      const historyDir = path.dirname(this.config.historyFile);
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      if (fs.existsSync(this.config.historyFile)) {
        const content = fs.readFileSync(this.config.historyFile, 'utf-8');
        this.history = content.split('\n').filter(Boolean);
      }
    } catch (error) {
      // Ignore errors loading history
    }
  }

  /**
   * Save command history to file
   */
  private saveHistory(): void {
    try {
      const historyDir = path.dirname(this.config.historyFile);
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      fs.writeFileSync(
        this.config.historyFile,
        this.history.slice(-this.config.historySize).join('\n'),
        'utf-8'
      );
    } catch (error) {
      // Ignore errors saving history
    }
  }

  /**
   * Add command to history
   */
  private addToHistory(command: string): void {
    this.history.push(command);
    // Note: readline.Interface has history property but it's not in TypeScript types
    // We manage history separately and sync on save
  }
}

/**
 * Start an interactive REPL session
 */
export function startREPL(): void {
  const repl = new REPL();
  repl.start();
}