import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!containerRef.current || !sessionName) return;

    const term = new Terminal({
      cursorBlink: true,
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

    // Intercept split shortcuts
    term.attachCustomKeyEventHandler((e) => {
      if (e.metaKey && e.key === 'd') return false;
      if (e.metaKey && e.shiftKey && e.key === 'D') return false;
      if (e.metaKey && e.key === 'w') return false;
      return true;
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    setTimeout(() => fit.fit(), 50);

    termRef.current = term;
    fitRef.current = fit;

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
          if (!disposed) invoke('write_terminal', { id, data }).catch(console.error);
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
    </div>
  );
}
