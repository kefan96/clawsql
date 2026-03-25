/**
 * ClawSQL CLI - Raw Input Handler
 *
 * Handles raw keyboard input for real-time command suggestions.
 * Provides Claude Code-style interactive hints with keyboard navigation.
 */

import { listCommands } from './registry.js';
import { theme } from './ui/components.js';
import { getFlags } from './completer.js';

/**
 * Suggestion item for dropdown
 */
export interface Suggestion {
  name: string;
  description: string;
  isFlag?: boolean;
}

/**
 * Result from the input handler
 */
export interface InputResult {
  value: string;
  cancelled: boolean;
}

/**
 * Built-in commands that are handled directly by the REPL
 */
const BUILTIN_COMMANDS: Suggestion[] = [
  { name: 'exit', description: 'Exit the CLI' },
  { name: 'quit', description: 'Exit the CLI (alias for exit)' },
  { name: 'q', description: 'Exit the CLI (short alias)' },
  { name: 'clear', description: 'Clear the screen' },
  { name: 'cls', description: 'Clear the screen (alias)' },
];

/**
 * Get all commands with descriptions
 */
function getAllCommandSuggestions(): Suggestion[] {
  const commands = listCommands().map(cmd => ({
    name: cmd.name,
    description: cmd.description,
  }));
  return [...commands, ...BUILTIN_COMMANDS];
}

/**
 * Raw input handler for real-time suggestions
 */
export class RawInputHandler {
  private buffer: string = '';
  private filteredSuggestions: Suggestion[] = [];
  private selectedIndex: number = 0;
  private showingSuggestions: boolean = false;
  private prompt: string;
  private allCommands: Suggestion[];
  private lastSuggestionLineCount: number = 0;

  constructor(prompt: string = 'clawsql ❯ ') {
    this.prompt = prompt;
    this.allCommands = getAllCommandSuggestions();
  }

  /**
   * Get visible prompt length (strips ANSI escape codes)
   */
  private getVisiblePromptLength(): number {
    // Strip ANSI escape codes to get visible character count
    return this.prompt.replace(/\x1B\[[0-9;]*m/g, '').length;
  }

  /**
   * Start raw input mode and return the result
   */
  async readLine(): Promise<InputResult> {
    return new Promise((resolve) => {
      // Save current terminal state
      const wasRaw = process.stdin.isRaw;

      // Enable raw mode
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      // Reset state
      this.buffer = '';
      this.filteredSuggestions = [];
      this.selectedIndex = 0;
      this.showingSuggestions = false;
      this.lastSuggestionLineCount = 0;

      // Show initial prompt
      this.render();

      const onData = (data: string) => {
        const result = this.handleInput(data);

        if (result.done) {
          // Cleanup
          process.stdin.off('data', onData);
          if (process.stdin.isTTY && wasRaw !== undefined) {
            process.stdin.setRawMode(wasRaw);
          }

          if (this.showingSuggestions) {
            this.clearSuggestions();
          }

          resolve({
            value: result.value ?? this.buffer,
            cancelled: result.cancelled ?? false,
          });
        }
      };

      process.stdin.on('data', onData);
    });
  }

  /**
   * Handle keyboard input
   */
  private handleInput(data: string): { done?: boolean; value?: string; cancelled?: boolean } {
    // Handle special keys
    if (data === '\x03') { // Ctrl+C
      this.clearSuggestions();
      console.log();
      return { done: true, cancelled: true };
    }

    if (data === '\x04') { // Ctrl+D
      this.clearSuggestions();
      return { done: true, cancelled: true };
    }

    if (data === '\x1B') { // Escape
      if (this.showingSuggestions) {
        this.clearSuggestions();
        this.showingSuggestions = false;
        this.render();
      }
      return {};
    }

    // Arrow keys
    if (data === '\x1B[A') { // Up
      if (this.showingSuggestions && this.filteredSuggestions.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.renderSuggestions();
      }
      return {};
    }

    if (data === '\x1B[B') { // Down
      if (this.showingSuggestions && this.filteredSuggestions.length > 0) {
        this.selectedIndex = Math.min(this.filteredSuggestions.length - 1, this.selectedIndex + 1);
        this.renderSuggestions();
      }
      return {};
    }

    // Tab or Enter - accept suggestion or submit
    if (data === '\t' || data === '\r' || data === '\n') {
      if (this.showingSuggestions && this.filteredSuggestions.length > 0) {
        // Accept selected suggestion
        const selected = this.filteredSuggestions[this.selectedIndex];

        if (selected.isFlag) {
          // Flag completion - replace the last part
          const parts = this.buffer.split(/\s+/);
          parts[parts.length - 1] = selected.name.split(' ')[0]; // Just the flag name
          this.buffer = parts.join(' ') + ' ';
        } else {
          // Command completion
          this.buffer = '/' + selected.name + ' ';
        }

        this.clearSuggestions();
        this.showingSuggestions = false;

        if (data === '\r' || data === '\n') {
          // Enter submits the command
          console.log();
          return { done: true, value: this.buffer };
        } else {
          // Tab just accepts, continue editing
          this.render();
          return {};
        }
      } else if (data === '\r' || data === '\n') {
        // No suggestions, submit current buffer
        console.log();
        return { done: true, value: this.buffer };
      }
      return {};
    }

    // Backspace
    if (data === '\x7F' || data === '\x08') {
      if (this.buffer.length > 0) {
        this.buffer = this.buffer.slice(0, -1);
        this.updateSuggestions();
        this.render();
      }
      return {};
    }

    // Regular character
    if (data.length === 1 && data >= ' ' && data <= '~') {
      this.buffer += data;
      this.updateSuggestions();
      this.render();
      return {};
    }

    // Ignore other control sequences
    return {};
  }

  /**
   * Update suggestions based on current buffer
   */
  private updateSuggestions(): void {
    if (!this.buffer.startsWith('/')) {
      this.showingSuggestions = false;
      this.filteredSuggestions = [];
      return;
    }

    const input = this.buffer.slice(1);
    const parts = input.split(/\s+/);

    // Command name completion (first part)
    if (parts.length === 1) {
      const partial = parts[0].toLowerCase();
      this.filteredSuggestions = this.allCommands.filter(cmd =>
        cmd.name.toLowerCase().startsWith(partial)
      );
      this.selectedIndex = 0;
      this.showingSuggestions = this.filteredSuggestions.length > 0;
      return;
    }

    // Flag completion (starts with --)
    const lastPart = parts[parts.length - 1];
    if (lastPart.startsWith('--') || lastPart.startsWith('-')) {
      const commandName = parts[0].toLowerCase();
      const partial = lastPart.toLowerCase();
      const flags = getFlags(commandName);

      this.filteredSuggestions = flags
        .filter(f => f.name.toLowerCase().startsWith(partial))
        .map(f => ({
          name: f.name + (f.hasValue ? ` ${f.valuePlaceholder || '<value>'}` : ''),
          description: f.description,
          isFlag: true,
        }));

      this.selectedIndex = 0;
      this.showingSuggestions = this.filteredSuggestions.length > 0;
      return;
    }

    // No suggestions for other cases
    this.showingSuggestions = false;
    this.filteredSuggestions = [];
  }

  /**
   * Render the current state
   */
  private render(): void {
    // Clear current line and show prompt + buffer
    process.stdout.write('\x1B[2K\x1B[0G');
    process.stdout.write(this.prompt + this.buffer);

    // Show suggestions if applicable
    if (this.showingSuggestions) {
      this.renderSuggestions();
    } else if (this.lastSuggestionLineCount > 0) {
      // No suggestions now, but we had some - clear them
      this.clearOldSuggestions();
      this.lastSuggestionLineCount = 0;
    }
  }

  /**
   * Render the suggestions dropdown
   */
  private renderSuggestions(): void {
    if (this.filteredSuggestions.length === 0) return;

    // Calculate terminal width
    const width = process.stdout.columns || 80;
    const nameWidth = Math.max(...this.filteredSuggestions.map(s => s.name.length)) + 2;
    const descWidth = width - nameWidth - 6;

    // Build suggestion lines
    const lines: string[] = [];

    // Top border
    const borderLen = Math.min(width, 100);
    lines.push(theme.muted('─'.repeat(borderLen)));

    // Suggestions (show max 8)
    const maxShow = Math.min(this.filteredSuggestions.length, 8);
    for (let i = 0; i < maxShow; i++) {
      const suggestion = this.filteredSuggestions[i];
      const isSelected = i === this.selectedIndex;
      const name = suggestion.name.padEnd(nameWidth);
      const desc = this.truncateText(suggestion.description, descWidth);

      if (isSelected) {
        lines.push(
          theme.primary('❯ ') +
          theme.primary.bold(name) +
          theme.muted(desc)
        );
      } else {
        lines.push(
          '  ' +
          theme.info(name) +
          theme.muted(desc)
        );
      }
    }

    if (this.filteredSuggestions.length > 8) {
      lines.push(theme.muted(`  ... and ${this.filteredSuggestions.length - 8} more`));
    }

    // Bottom border
    lines.push(theme.muted('─'.repeat(borderLen)));

    const newLineCount = lines.length;
    const oldLineCount = this.lastSuggestionLineCount;

    // Step 1: Move cursor down to first suggestion line (below input)
    process.stdout.write('\x1B[1B'); // Move down 1 line
    process.stdout.write('\x1B[0G'); // Go to start of line

    // Step 2: Clear ONLY old suggestion lines (not new ones!)
    // If oldLineCount is 0 (first render), we clear nothing
    for (let i = 0; i < oldLineCount; i++) {
      process.stdout.write('\x1B[2K'); // Clear this line
      if (i < oldLineCount - 1) {
        process.stdout.write('\x1B[1B'); // Move down to next line
      }
    }

    // Step 3: Move cursor back to first suggestion line
    if (oldLineCount > 0) {
      process.stdout.write('\x1B[' + (oldLineCount - 1) + 'A');
    }
    process.stdout.write('\x1B[0G'); // Start of line

    // Step 4: Write new suggestions
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(lines[i]);
      if (i < lines.length - 1) {
        process.stdout.write('\n'); // Newline to next line
      }
    }

    // Step 5: Move cursor back up to input line
    // We're at the last suggestion line, need to move up newLineCount lines
    process.stdout.write('\x1B[' + newLineCount + 'A');
    process.stdout.write('\x1B[0G'); // Start of line

    // Step 6: Redraw input line (prompt + buffer) and position cursor
    process.stdout.write(this.prompt + this.buffer);
    const cursorCol = this.getVisiblePromptLength() + this.buffer.length + 1;
    process.stdout.write('\x1B[' + cursorCol + 'G');

    // Update line count for next render
    this.lastSuggestionLineCount = newLineCount;
  }

  /**
   * Clear suggestions from terminal
   * @param resetCount If true, reset lastSuggestionLineCount to 0
   */
  private clearSuggestions(resetCount: boolean = true): void {
    if (this.lastSuggestionLineCount === 0) return;

    // Move cursor down to first suggestion line
    process.stdout.write('\x1B[1B');
    process.stdout.write('\x1B[0G');

    // Clear all suggestion lines
    for (let i = 0; i < this.lastSuggestionLineCount; i++) {
      process.stdout.write('\x1B[2K'); // Clear line
      if (i < this.lastSuggestionLineCount - 1) {
        process.stdout.write('\x1B[1B'); // Move down
      }
    }

    // Move cursor back up to input line
    process.stdout.write('\x1B[' + this.lastSuggestionLineCount + 'A');
    process.stdout.write('\x1B[0G');

    // Redraw input line and position cursor (using visible length)
    process.stdout.write(this.prompt + this.buffer);
    const cursorCol = this.getVisiblePromptLength() + this.buffer.length + 1;
    process.stdout.write('\x1B[' + cursorCol + 'G');

    if (resetCount) {
      this.lastSuggestionLineCount = 0;
    }
  }

  /**
   * Clear old suggestions when no longer showing suggestions
   */
  private clearOldSuggestions(): void {
    this.clearSuggestions(true);
  }

  /**
   * Truncate text with ellipsis
   */
  private truncateText(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;
    if (maxWidth <= 3) return '...';
    return text.slice(0, maxWidth - 3) + '...';
  }
}