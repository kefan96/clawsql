/**
 * ClawSQL CLI - Interactive REPL
 *
 * Read-Eval-Print Loop for interactive CLI sessions.
 * Features: Tab completion, keyboard shortcuts, professional UI.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseInput, executeCommand, createCLIContext, CLIContext, getCommand } from './registry.js';
import { AIAgent, createAIAgent, loadAIConfig } from './agent/index.js';
import { createCompleter as createCompleterFn } from './completer.js';
import {
  createBanner,
  createPrompt,
  createDidYouMean,
  clearScreen,
  createSpinner,
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
  private rl: readline.Interface | null = null;
  private config: REPLConfig;
  private context: CLIContext;
  private running: boolean = false;
  private history: string[] = [];
  private agent: AIAgent | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private pendingCommand: Promise<void> = Promise.resolve();
  private completer: ReturnType<typeof createCompleterFn> | null = null;
  private currentContext: string = '';
  private orchestratorConnected: boolean = false;

  constructor(config?: Partial<REPLConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.context = createCLIContext();
    this.loadHistory();
    this.initAgent();
    this.initCompleter();
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
  async start(): Promise<void> {
    this.running = true;

    // Keep the process alive for async operations
    this.keepAlive = setInterval(() => {}, 10000);

    // Check orchestrator connection in background
    this.checkOrchestratorConnection().then(connected => {
      this.orchestratorConnected = connected;
    });

    // Create readline interface with completer
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
      historySize: this.config.historySize,
      removeHistoryDuplicates: true,
      completer: this.completerCallback.bind(this),
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      console.log();
      if (this.rl) {
        this.rl.prompt();
      }
    });

    // Print welcome banner
    this.printBanner();

    // Start the prompt loop
    this.rl.prompt();

    // Handle input - chain commands so they execute sequentially
    this.rl.on('line', (input: string) => {
      // Handle special key sequences
      if (input === '\x0c') {
        // Ctrl+L - clear screen
        clearScreen();
        this.printBanner();
        if (this.rl) {
          this.rl.prompt();
        }
        return;
      }

      // Chain this command after the previous one completes
      this.pendingCommand = this.pendingCommand
        .then(() => this.handleInput(input))
        .then(() => {
          if (this.running && this.rl) {
            this.rl.prompt();
          }
        })
        .catch(err => {
          console.error('Command error:', err);
        });
    });

    // Handle close (Ctrl+D)
    this.rl.on('close', () => {
      this.saveHistory();
      this.running = false;
      if (this.keepAlive) {
        clearInterval(this.keepAlive);
        this.keepAlive = null;
      }
      console.log();
      console.log(theme.primary('Goodbye!'));
      process.exit(0);
    });
  }

  /**
   * Completer callback for readline
   */
  private completerCallback(
    line: string,
    callback: (err: null, result: [string[], string]) => void
  ): void {
    if (!this.completer) {
      callback(null, [[], line]);
      return;
    }

    const [completions, original] = this.completer.complete(line);
    callback(null, [completions, original]);
  }

  /**
   * Stop the REPL session
   */
  async stop(): Promise<void> {
    // Wait for any pending command to complete
    await this.pendingCommand;

    this.running = false;
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    this.saveHistory();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    console.log();
    console.log(theme.primary('Goodbye!'));
    process.exit(0);
  }

  /**
   * Handle user input
   */
  private async handleInput(input: string): Promise<void> {
    const trimmed = input.trim();

    // Skip empty input
    if (!trimmed) {
      return;
    }

    // Add to history
    this.addToHistory(trimmed);

    // Check for special commands
    if (trimmed === '/exit' || trimmed === '/quit' || trimmed === '/q') {
      this.stop();
      return;
    }

    // Clear screen command
    if (trimmed === '/clear' || trimmed === '/cls') {
      clearScreen();
      this.printBanner();
      return;
    }

    // Parse and execute command
    const parsed = parseInput(trimmed);
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
          return;
        }
        await executeCommand(parsed.command, parsed.args, this.context);
      } else {
        // No command prefix - treat as natural language
        await this.handleNaturalLanguage(trimmed);
      }
    }
  }

  /**
   * Handle natural language input using AI agent
   */
  private async handleNaturalLanguage(input: string): Promise<void> {
    const spinner = createSpinner('Thinking...').start();
    try {
      const response = await this.agent!.process(input);
      spinner.stop();
      console.log();
      console.log(response);
      console.log();
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      console.log(this.context.formatter.error(`AI error: ${message}`));
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
export async function startREPL(): Promise<void> {
  const repl = new REPL();
  await repl.start();
}