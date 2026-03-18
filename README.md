# dmux

A desktop terminal app for managing git worktrees with split panes.

Inspired by [Conductor](https://conductor.run), [cmux](https://cmux.dev), and [tmux](https://github.com/tmux/tmux).

> [한국어 README](./README.ko.md)

## What is dmux?

dmux is a standalone desktop terminal application that combines:

- **Conductor-style dashboard** — Visual workspace management with a sidebar
- **cmux-style split panes** — Freely split terminals horizontally and vertically
- **Git worktree integration** — Each branch gets its own isolated working directory

## Screenshot

```
┌──────┬──────────────────────┬─────────────────────────────┐
│  ◇   │  my-project          │  $ git status               │
│      │                      │  On branch main             │
│ [P]  │  ▼ main       ✓     ├──────────────┬──────────────┤
│ [D]  │  ▶ feature    ●3    │  $ npm test  │  $ npm run   │
│      │  ▶ fix/bug    ✓     │  PASS ✓      │  dev server  │
│      │                      │              │  ready       │
│ [+]  │  [+ Branch]          │              │              │
└──────┴──────────────────────┴──────────────┴──────────────┘
```

## Features

- **Workspaces** — Add multiple git repositories and switch between them
- **Branch management** — View all git worktrees as an accordion list, create new branches that auto-generate worktrees
- **Split terminal panes** — Split terminals freely with keyboard shortcuts
- **Native app** — Built with Tauri, runs as a lightweight native desktop app (~10MB)
- **Cross-platform** — macOS, Windows, Linux

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+D` | Split pane horizontally (top/bottom) |
| `Cmd+Shift+D` | Split pane vertically (left/right) |
| `Cmd+W` | Close active pane |
| `Cmd+T` | New terminal |

## Tech Stack

- **Frontend**: React + TypeScript + xterm.js
- **Backend**: Rust (Tauri)
- **Terminal**: PTY via `portable-pty`
- **UI**: Custom CSS (dark theme)

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.77+)
- [Node.js](https://nodejs.org/) (18+)
- Git

### Development

```bash
cd frontend
npm install
cargo tauri dev
```

### Build

```bash
cd frontend
cargo tauri build
```

The built app will be at:
- **macOS**: `src-tauri/target/release/bundle/macos/dmux.app`
- **DMG**: `src-tauri/target/release/bundle/dmg/dmux_*.dmg`

## Project Structure

```
dmux/
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   │   ├── WorkspaceSidebar.tsx
│   │   │   ├── BranchPanel.tsx
│   │   │   ├── PaneContainer.tsx
│   │   │   └── TerminalPane.tsx
│   │   ├── hooks/            # React hooks
│   │   │   ├── useWorkspaces.ts
│   │   │   └── usePaneLayout.ts
│   │   ├── types.ts          # TypeScript types
│   │   └── App.tsx           # Main app
│   └── src-tauri/
│       └── src/lib.rs        # Rust backend (PTY, git, tmux)
└── README.md
```

## License

MIT
