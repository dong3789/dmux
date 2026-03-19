import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';
import './TerminalPane.css';

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
  const idRef = useRef<string>(sessionName);
  const imeInputRef = useRef<HTMLInputElement | null>(null);
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
      invoke('write_terminal', { id: idRef.current, data }).catch(console.error);
    };

    let composing = false;

    imeInput.addEventListener('compositionstart', () => { composing = true; });
    imeInput.addEventListener('compositionupdate', (e: CompositionEvent) => {
      setComposingText(e.data || '');
    });
    imeInput.addEventListener('compositionend', (e: CompositionEvent) => {
      composing = false;
      setComposingText('');
      if (e.data) writeToTerminal(e.data);
      imeInput.value = '';
    });

    imeInput.addEventListener('input', (e: Event) => {
      if (composing) return;
      const ie = e as InputEvent;
      if (ie.data) {
        writeToTerminal(ie.data);
        imeInput.value = '';
      }
    });

    imeInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (composing) return;

      const keyMap: Record<string, string> = {
        'Backspace': '\x7f',
        'Enter': '\r',
        'Escape': '\x1b',
        'Tab': '\t',
        'ArrowUp': '\x1b[A',
        'ArrowDown': '\x1b[B',
        'ArrowRight': '\x1b[C',
        'ArrowLeft': '\x1b[D',
      };

      if (keyMap[e.key]) {
        writeToTerminal(keyMap[e.key]);
        if (e.key === 'Enter') imeInput.value = '';
        e.preventDefault();
      } else if (e.ctrlKey) {
        const ctrlMap: Record<string, string> = { 'c': '\x03', 'z': '\x1a', 'l': '\x0c' };
        if (ctrlMap[e.key]) {
          writeToTerminal(ctrlMap[e.key]);
          e.preventDefault();
        }
      }
    });

    const bodyEl = containerRef.current;
    const focusIME = () => imeInput.focus();
    bodyEl.addEventListener('click', focusIME);

    let unlisten: (() => void) | null = null;
    let disposed = false;

    (async () => {
      try {
        const id = await invoke<string>('spawn_terminal', {
          sessionName,
          cwd: worktreePath || undefined,
        });
        if (disposed) {
          invoke('close_terminal', { id }).catch(() => {});
          return;
        }
        idRef.current = id;

        unlisten = await listen<string>(`pty-output-${id}`, (event) => {
          if (!disposed) term.write(event.payload);
        });

        term.onData((data) => {
          if (!disposed) writeToTerminal(data);
        });
      } catch (e) {
        if (!disposed) term.write(`\r\nFailed to connect: ${e}\r\n`);
      }
    })();

    const observer = new ResizeObserver(() => {
      if (fitRef.current) {
        fitRef.current.fit();
        const dims = fitRef.current.proposeDimensions();
        if (dims) {
          invoke('resize_terminal', {
            id: idRef.current,
            rows: dims.rows,
            cols: dims.cols,
          }).catch(() => {});
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      bodyEl.removeEventListener('click', focusIME);
      if (imeInput.parentNode) imeInput.parentNode.removeChild(imeInput);
      imeInputRef.current = null;
      if (unlisten) unlisten();
      invoke('close_terminal', { id: idRef.current }).catch(() => {});
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
