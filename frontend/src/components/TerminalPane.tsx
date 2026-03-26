import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';
import './TerminalPane.css';

// ── PTY lifecycle management (independent of React component) ──
// PTYs persist across component unmount/remount (e.g. during split).
// Only explicitly closed when the user removes the pane.

interface PtyHandle {
  id: string;
  unlisten: (() => void) | null;
  listeners: Set<(data: string) => void>;
  spawning: boolean;
}

const activePtys = new Map<string, PtyHandle>();

async function ensurePty(sessionName: string, cwd?: string): Promise<PtyHandle> {
  const existing = activePtys.get(sessionName);
  if (existing && !existing.spawning) return existing;
  if (existing?.spawning) {
    // Wait for spawn to complete with 10s timeout
    await new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      const check = setInterval(() => {
        elapsed += 50;
        const h = activePtys.get(sessionName);
        if (h && !h.spawning) { clearInterval(check); resolve(); }
        if (elapsed > 10000) { clearInterval(check); reject(new Error('Spawn timeout')); }
      }, 50);
    });
    return activePtys.get(sessionName)!;
  }

  const handle: PtyHandle = { id: sessionName, unlisten: null, listeners: new Set(), spawning: true };
  activePtys.set(sessionName, handle);

  try {
    const id = await invoke<string>('spawn_terminal', {
      sessionName,
      cwd: cwd || undefined,
    });
    handle.id = id;

    handle.unlisten = await listen<string>(`pty-output-${id}`, (event) => {
      for (const cb of handle.listeners) cb(event.payload);
    });
  } catch (e) {
    activePtys.delete(sessionName);
    throw e;
  } finally {
    handle.spawning = false;
  }

  return handle;
}

export function destroyPty(sessionName: string) {
  const handle = activePtys.get(sessionName);
  if (!handle) return;
  if (handle.unlisten) handle.unlisten();
  invoke('close_terminal', { id: handle.id }).catch(() => {});
  activePtys.delete(sessionName);
}

// ── React component ──

interface Props {
  paneId: string;
  sessionName: string;
  worktreePath: string;
  isActive: boolean;
  onFocus: (paneId: string) => void;
  onClose: (paneId: string) => void;
}

export function TerminalPane({ paneId, sessionName, worktreePath, isActive, onFocus, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const imeInputRef = useRef<HTMLInputElement | null>(null);
  const handleRef = useRef<PtyHandle | null>(null);
  const cleanupRef = useRef<{ removeOutputListener?: () => void }>({});
  const [composingText, setComposingText] = useState('');

  // Focus IME input when pane becomes active
  useEffect(() => {
    if (isActive && imeInputRef.current) {
      imeInputRef.current.focus();
    }
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current || !sessionName) return;

    const term = new Terminal({
      cursorBlink: false,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117', red: '#f85149', green: '#3fb950',
        yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff',
        cyan: '#39c5cf', white: '#e6edf3',
        brightBlack: '#484f58', brightRed: '#f85149', brightGreen: '#3fb950',
        brightYellow: '#d29922', brightBlue: '#58a6ff', brightMagenta: '#bc8cff',
        brightCyan: '#39c5cf', brightWhite: '#ffffff',
      },
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.keyCode === 229 || e.isComposing) return false;
      if (e.metaKey && e.key.toLowerCase() === 'd') return false;
      if (e.metaKey && e.key.toLowerCase() === 'w') return false;
      if (e.metaKey && e.key.toLowerCase() === 't') return false;
      return true;
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    setTimeout(() => fit.fit(), 50);

    termRef.current = term;
    fitRef.current = fit;

    // IME input element
    const imeInput = document.createElement('input');
    imeInput.className = 'ime-input';
    imeInput.setAttribute('autocapitalize', 'off');
    imeInput.setAttribute('autocomplete', 'off');
    imeInput.setAttribute('autocorrect', 'off');
    imeInput.setAttribute('spellcheck', 'false');
    containerRef.current.appendChild(imeInput);
    imeInputRef.current = imeInput;

    const writeToTerminal = (data: string) => {
      const handle = handleRef.current;
      if (handle) {
        invoke('write_terminal', { id: handle.id, data }).catch(console.error);
      }
    };

    let composing = false;

    // Named handlers so they can be removed on cleanup
    const onCompositionStart = () => { composing = true; };
    const onCompositionUpdate = (e: Event) => {
      setComposingText((e as CompositionEvent).data || '');
    };
    const onCompositionEnd = (e: Event) => {
      composing = false;
      setComposingText('');
      const data = (e as CompositionEvent).data;
      if (data) writeToTerminal(data);
      imeInput.value = '';
    };
    const onInput = (e: Event) => {
      if (composing) return;
      const ie = e as InputEvent;
      if (ie.data) {
        writeToTerminal(ie.data);
        imeInput.value = '';
      }
    };
    const onKeydown = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (composing) return;
      if (ke.metaKey) return;

      const keyMap: Record<string, string> = {
        'Backspace': '\x7f',
        'Delete': '\x1b[3~',
        'Enter': '\r',
        'Escape': '\x1b',
        'Tab': '\t',
        'ArrowUp': '\x1b[A',
        'ArrowDown': '\x1b[B',
        'ArrowRight': '\x1b[C',
        'ArrowLeft': '\x1b[D',
        'Home': '\x1b[H',
        'End': '\x1b[F',
        'PageUp': '\x1b[5~',
        'PageDown': '\x1b[6~',
        'Insert': '\x1b[2~',
        'F1': '\x1bOP', 'F2': '\x1bOQ', 'F3': '\x1bOR', 'F4': '\x1bOS',
        'F5': '\x1b[15~', 'F6': '\x1b[17~', 'F7': '\x1b[18~', 'F8': '\x1b[19~',
        'F9': '\x1b[20~', 'F10': '\x1b[21~', 'F11': '\x1b[23~', 'F12': '\x1b[24~',
      };

      if (keyMap[ke.key]) {
        writeToTerminal(keyMap[ke.key]);
        if (ke.key === 'Enter') imeInput.value = '';
        ke.preventDefault();
      } else if (ke.ctrlKey && ke.key.length === 1) {
        const code = ke.key.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          writeToTerminal(String.fromCharCode(code - 96));
          ke.preventDefault();
        }
      } else if (ke.altKey && ke.key.length === 1) {
        writeToTerminal('\x1b' + ke.key);
        ke.preventDefault();
      }
    };

    imeInput.addEventListener('compositionstart', onCompositionStart);
    imeInput.addEventListener('compositionupdate', onCompositionUpdate);
    imeInput.addEventListener('compositionend', onCompositionEnd);
    imeInput.addEventListener('input', onInput);
    imeInput.addEventListener('keydown', onKeydown);

    const bodyEl = containerRef.current;
    const focusIME = () => imeInput.focus();
    bodyEl.addEventListener('click', focusIME);

    let disposed = false;

    // Connect to PTY (reuses existing if available)
    (async () => {
      try {
        const handle = await ensurePty(sessionName, worktreePath);
        if (disposed) return;
        handleRef.current = handle;

        const outputListener = (data: string) => {
          if (!disposed) term.write(data);
        };
        handle.listeners.add(outputListener);

        term.onData((data) => {
          if (disposed) return;
          const filtered = data
            .replace(/\x1b\[\?[\d;]*c/g, '')
            .replace(/\x1b\[>[\d;]*c/g, '')
            .replace(/\x1b\[\d+;\d+R/g, '')
            .replace(/\x1b\[\d+n/g, '');
          if (filtered) writeToTerminal(filtered);
        });

        cleanupRef.current.removeOutputListener = () => handle.listeners.delete(outputListener);
      } catch (e) {
        if (!disposed) {
          term.write(`\r\n\x1b[31mFailed to connect: ${e}\x1b[0m\r\n`);
          term.write(`\r\nPress any key to retry, or close this pane.\r\n`);
          const retryHandler = term.onData(() => {
            retryHandler.dispose();
            term.clear();
            term.write('Reconnecting...\r\n');
            ensurePty(sessionName, worktreePath)
              .then(h => {
                if (disposed) return;
                handleRef.current = h;
                const listener = (data: string) => { if (!disposed) term.write(data); };
                h.listeners.add(listener);
                cleanupRef.current.removeOutputListener = () => h.listeners.delete(listener);
              })
              .catch(err => {
                if (!disposed) term.write(`\r\n\x1b[31mRetry failed: ${err}\x1b[0m\r\n`);
              });
          });
        }
      }
    })();

    const observer = new ResizeObserver(() => {
      if (fitRef.current) {
        fitRef.current.fit();
        const handle = handleRef.current;
        if (handle) {
          const dims = fitRef.current.proposeDimensions();
          if (dims) {
            invoke('resize_terminal', {
              id: handle.id,
              rows: dims.rows,
              cols: dims.cols,
            }).catch(() => {});
          }
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      // Remove all IME event listeners
      imeInput.removeEventListener('compositionstart', onCompositionStart);
      imeInput.removeEventListener('compositionupdate', onCompositionUpdate);
      imeInput.removeEventListener('compositionend', onCompositionEnd);
      imeInput.removeEventListener('input', onInput);
      imeInput.removeEventListener('keydown', onKeydown);
      bodyEl.removeEventListener('click', focusIME);
      if (imeInput.parentNode) imeInput.parentNode.removeChild(imeInput);
      imeInputRef.current = null;
      handleRef.current = null;
      if (cleanupRef.current.removeOutputListener) cleanupRef.current.removeOutputListener();
      term.dispose();
    };
  }, [sessionName, worktreePath]);

  return (
    <div
      className={`terminal-pane ${isActive ? 'active' : ''}`}
      onClick={() => onFocus(paneId)}
    >
      <div className="tp-header">
        <span className="tp-title">
          <span className="tp-dot" />
          {sessionName}
        </span>
        <button className="tp-close" onClick={(e) => { e.stopPropagation(); onClose(paneId); }}>✕</button>
      </div>
      <div className="tp-body" ref={containerRef} />
      {composingText && (
        <div className="tp-compose-bar">
          <span className="tp-compose-label">IME</span>
          <span className="tp-compose-text">{composingText}</span>
        </div>
      )}
    </div>
  );
}
