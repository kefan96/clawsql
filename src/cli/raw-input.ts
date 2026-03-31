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
  exitRequested?: boolean; // Ctrl+D was pressed - user wants to exit
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
  private cursorPos: number = 0; // Cursor position within buffer
  private filteredSuggestions: Suggestion[] = [];
  private selectedIndex: number = 0;
  private showingSuggestions: boolean = false;
  private prompt: string;
  private allCommands: Suggestion[];
  private lastSuggestionLineCount: number = 0;
  private inBracketedPaste: boolean = false;
  private pasteBuffer: string = '';
  private pasteTimeout: NodeJS.Timeout | null = null;
  private static readonly PASTE_TIMEOUT_MS = 5000; // 5 second timeout for bracketed paste
  private bracketedPasteSupported: boolean = false;
  private history: string[] = []; // Command history
  private historyIndex: number = -1; // Current position in history (-1 = not navigating)
  private savedBuffer: string = ''; // Buffer saved before history navigation

  constructor(prompt: string = 'clawsql ❯ ', history: string[] = []) {
    this.prompt = prompt;
    this.allCommands = getAllCommandSuggestions();
    this.history = history;
    this.bracketedPasteSupported = this.enableBracketedPaste();
  }

  /**
   * Update history array (called from REPL after command execution)
   */
  setHistory(history: string[]): void {
    this.history = history;
  }

  /**
   * Enable bracketed paste mode (for better paste handling)
   * Returns true if the terminal likely supports it
   */
  private enableBracketedPaste(): boolean {
    if (process.stdout.isTTY) {
      // Check if terminal likely supports bracketed paste mode
      // Most modern terminals (xterm, screen-256color, tmux, etc.) support it
      const term = process.env.TERM || '';
      const supportedTerms = ['xterm', 'screen', 'tmux', 'vt', 'rxvt', 'putty', 'iterm'];
      const isSupported = supportedTerms.some(t => term.toLowerCase().includes(t));

      if (isSupported || !term) {
        // Terminal likely supports bracketed paste mode
        process.stdout.write('\x1B[?2004h');
        return true;
      }
    }
    return false;
  }

  /**
   * Disable bracketed paste mode
   */
  private disableBracketedPaste(): void {
    if (process.stdout.isTTY) {
      process.stdout.write('\x1B[?2004l');
    }
  }

  /**
   * Clear the paste timeout
   */
  private clearPasteTimeout(): void {
    if (this.pasteTimeout) {
      clearTimeout(this.pasteTimeout);
      this.pasteTimeout = null;
    }
  }

  /**
   * Cleanup - call when done with the handler
   */
  cleanup(): void {
    this.clearPasteTimeout();
    if (this.bracketedPasteSupported) {
      this.disableBracketedPaste();
    }
  }

  /**
   * Get visible prompt length (strips ANSI escape codes)
   */
  private getVisiblePromptLength(): number {
    // Strip ANSI escape codes to get visible character count
    // eslint-disable-next-line no-control-regex
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
      this.cursorPos = 0;
      this.filteredSuggestions = [];
      this.selectedIndex = 0;
      this.showingSuggestions = false;
      this.lastSuggestionLineCount = 0;
      this.historyIndex = -1;
      this.savedBuffer = '';

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
            exitRequested: result.exitRequested ?? false,
          });
        }
      };

      process.stdin.on('data', onData);
    });
  }

  /**
   * Handle keyboard input
   */
  private handleInput(data: string): { done?: boolean; value?: string; cancelled?: boolean; exitRequested?: boolean } {
    // Handle bracketed paste mode (if supported)
    if (this.bracketedPasteSupported) {
      if (data.startsWith('\x1B[200~')) {
        // Start of bracketed paste
        this.inBracketedPaste = true;
        this.pasteBuffer = '';

        // Check if the end sequence is also in this chunk (complete paste in one chunk)
        const endIdx = data.indexOf('\x1B[201~');
        if (endIdx !== -1) {
          // Complete paste in single chunk - extract content between markers
          const content = data.slice(6, endIdx); // Between start and end sequences
          this.inBracketedPaste = false;
          this.processPaste(content);
          return {};
        }

        // Set timeout to prevent getting stuck if end sequence never arrives
        this.clearPasteTimeout();
        this.pasteTimeout = setTimeout(() => {
          if (this.inBracketedPaste && this.pasteBuffer) {
            // Timeout - process what we have and exit bracketed paste mode
            this.inBracketedPaste = false;
            this.processPaste(this.pasteBuffer);
            this.pasteBuffer = '';
          }
        }, RawInputHandler.PASTE_TIMEOUT_MS);
        // Extract any content after the start sequence
        const afterStart = data.slice(6); // '\x1B[200~'.length = 6
        if (afterStart) {
          this.pasteBuffer += afterStart;
        }
        return {};
      }

      if (this.inBracketedPaste) {
        if (data.includes('\x1B[201~')) {
          // End of bracketed paste
          this.clearPasteTimeout();
          this.inBracketedPaste = false;
          // Extract content before the end sequence
          const endIndex = data.indexOf('\x1B[201~');
          this.pasteBuffer += data.slice(0, endIndex);
          // Process the pasted content
          this.processPaste(this.pasteBuffer);
          this.pasteBuffer = '';
          return {};
        } else {
          // Continue collecting paste content
          this.pasteBuffer += data;
          return {};
        }
      }

      // Ignore stray end bracketed paste sequence (can happen after timeout)
      if (data.includes('\x1B[201~')) {
        return {};
      }
    }

    // Handle special keys
    if (data === '\x03') { // Ctrl+C
      // Cancel bracketed paste mode if stuck
      this.clearPasteTimeout();
      this.inBracketedPaste = false;
      this.pasteBuffer = '';
      this.clearSuggestions();
      console.log();
      return { done: true, cancelled: true };
    }

    if (data === '\x04') { // Ctrl+D
      // Cancel bracketed paste mode if stuck
      this.clearPasteTimeout();
      this.inBracketedPaste = false;
      this.pasteBuffer = '';
      this.clearSuggestions();
      return { done: true, cancelled: true, exitRequested: true };
    }

    if (data === '\x1B') { // Escape
      // Cancel bracketed paste mode if stuck
      if (this.inBracketedPaste) {
        this.clearPasteTimeout();
        this.inBracketedPaste = false;
        // Process what we have so far
        if (this.pasteBuffer) {
          this.processPaste(this.pasteBuffer);
        }
        this.pasteBuffer = '';
        this.render();
        return {};
      }
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
        // Navigate suggestions
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.renderSuggestions();
      } else if (this.history.length > 0) {
        // History navigation
        if (this.historyIndex === -1) {
          // First time navigating - save current buffer
          this.savedBuffer = this.buffer;
        }
        this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
        this.buffer = this.history[this.history.length - 1 - this.historyIndex];
        this.cursorPos = this.buffer.length;
        this.updateSuggestions();
        this.render();
      }
      return {};
    }

    if (data === '\x1B[B') { // Down
      if (this.showingSuggestions && this.filteredSuggestions.length > 0) {
        // Navigate suggestions
        this.selectedIndex = Math.min(this.filteredSuggestions.length - 1, this.selectedIndex + 1);
        this.renderSuggestions();
      } else if (this.historyIndex > -1) {
        // History navigation
        this.historyIndex--;
        if (this.historyIndex === -1) {
          // Back to saved buffer
          this.buffer = this.savedBuffer;
        } else {
          this.buffer = this.history[this.history.length - 1 - this.historyIndex];
        }
        this.cursorPos = this.buffer.length;
        this.updateSuggestions();
        this.render();
      }
      return {};
    }

    if (data === '\x1B[D') { // Left arrow
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.render();
      }
      return {};
    }

    if (data === '\x1B[C') { // Right arrow
      if (this.cursorPos < this.buffer.length) {
        this.cursorPos++;
        this.render();
      }
      return {};
    }

    // Home/End keys (different terminal variants)
    if (data === '\x1B[H' || data === '\x1B[1~' || data === '\x1B[7~' || data === '\x01') { // Home or Ctrl+A
      this.cursorPos = 0;
      this.render();
      return {};
    }

    if (data === '\x1B[F' || data === '\x1B[4~' || data === '\x1B[8~' || data === '\x05') { // End or Ctrl+E
      this.cursorPos = this.buffer.length;
      this.render();
      return {};
    }

    // Tab or Enter - accept suggestion or submit
    if (data === '\t' || data === '\r' || data === '\n') {
      if (this.showingSuggestions && this.filteredSuggestions.length > 0) {
        // Accept selected suggestion
        const selected = this.filteredSuggestions[this.selectedIndex];

        if (selected.isFlag) {
          // Flag completion - replace the last part
          const parts = this.buffer.slice(0, this.cursorPos).split(/\s+/);
          parts[parts.length - 1] = selected.name.split(' ')[0]; // Just the flag name
          const beforeCursor = parts.join(' ') + ' ';
          this.buffer = beforeCursor + this.buffer.slice(this.cursorPos);
          this.cursorPos = beforeCursor.length;
        } else {
          // Command completion - replace entire buffer
          this.buffer = '/' + selected.name + ' ';
          this.cursorPos = this.buffer.length;
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
      if (this.cursorPos > 0) {
        this.buffer = this.buffer.slice(0, this.cursorPos - 1) + this.buffer.slice(this.cursorPos);
        this.cursorPos--;
        this.updateSuggestions();
        this.render();
      }
      return {};
    }

    // Delete key (Delete forward)
    if (data === '\x1B[3~') {
      if (this.cursorPos < this.buffer.length) {
        this.buffer = this.buffer.slice(0, this.cursorPos) + this.buffer.slice(this.cursorPos + 1);
        this.updateSuggestions();
        this.render();
      }
      return {};
    }

    // Ctrl+L - Clear screen
    if (data === '\x0C') {
      process.stdout.write('\x1B[2J\x1B[0f');
      this.render();
      return {};
    }

    // Ctrl+K - Delete from cursor to end of line
    if (data === '\x0B') {
      this.buffer = this.buffer.slice(0, this.cursorPos);
      this.updateSuggestions();
      this.render();
      return {};
    }

    // Ctrl+U - Delete from beginning to cursor
    if (data === '\x15') {
      this.buffer = this.buffer.slice(this.cursorPos);
      this.cursorPos = 0;
      this.updateSuggestions();
      this.render();
      return {};
    }

    // Ctrl+W - Delete word before cursor
    if (data === '\x17') {
      // Find the start of the word before cursor
      let wordStart = this.cursorPos;
      // Skip any trailing spaces
      while (wordStart > 0 && this.buffer[wordStart - 1] === ' ') {
        wordStart--;
      }
      // Find the start of the word
      while (wordStart > 0 && this.buffer[wordStart - 1] !== ' ') {
        wordStart--;
      }
      this.buffer = this.buffer.slice(0, wordStart) + this.buffer.slice(this.cursorPos);
      this.cursorPos = wordStart;
      this.updateSuggestions();
      this.render();
      return {};
    }

    // Ctrl+T - Transpose characters before cursor
    if (data === '\x14') {
      if (this.cursorPos >= 2) {
        const chars = this.buffer.split('');
        [chars[this.cursorPos - 2], chars[this.cursorPos - 1]] = [chars[this.cursorPos - 1], chars[this.cursorPos - 2]];
        this.buffer = chars.join('');
        this.render();
      }
      return {};
    }

    // Regular character or multi-character input (paste without bracketed paste mode)
    if (data.length >= 1) {
      // Detect large paste (multiple characters at once without bracketed paste markers)
      // This handles terminals that don't support bracketed paste mode
      if (data.length > 10 && !this.bracketedPasteSupported) {
        // Treat as paste - process all at once
        this.processPaste(data);
        return {};
      }

      // Filter out control characters and handle multi-character input
      const printableChars = data.split('').filter(c => c >= ' ' && c <= '~').join('');
      if (printableChars.length > 0) {
        // Insert at cursor position
        this.buffer = this.buffer.slice(0, this.cursorPos) + printableChars + this.buffer.slice(this.cursorPos);
        this.cursorPos += printableChars.length;
        this.updateSuggestions();
        this.render();
      }
      return {};
    }

    // Ignore other control sequences
    return {};
  }

  /**
   * Process pasted content
   */
  private processPaste(content: string): void {
    // Filter out control characters but keep the paste content
    const printableChars = content.split('').filter(c => c >= ' ' && c <= '~' || c === '\t').join('');
    if (printableChars.length > 0) {
      // Insert at cursor position
      this.buffer = this.buffer.slice(0, this.cursorPos) + printableChars + this.buffer.slice(this.cursorPos);
      this.cursorPos += printableChars.length;
      this.updateSuggestions();
      this.render();
    }
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

    // Position cursor at correct column
    const cursorCol = this.getVisiblePromptLength() + this.cursorPos;
    process.stdout.write('\x1B[' + (cursorCol + 1) + 'G');

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
    const cursorCol = this.getVisiblePromptLength() + this.cursorPos + 1;
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
    const cursorCol = this.getVisiblePromptLength() + this.cursorPos + 1;
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