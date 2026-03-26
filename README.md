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

### macOS / Linux

#### Prerequisites

- [Rust](https://rustup.rs/) (1.77+)
- [Node.js](https://nodejs.org/) (18+)
- Git
- tmux (`brew install tmux`)

#### Development

```bash
cd frontend
npm install
cargo tauri dev
```

#### Build

```bash
cd frontend
cargo tauri build
```

The built app will be at:
- **macOS**: `src-tauri/target/release/bundle/macos/dmux.app`
- **DMG**: `src-tauri/target/release/bundle/dmg/dmux_*.dmg`

### Windows (WSL)

#### Prerequisites

1. **WSL 2 설치**
   ```powershell
   wsl --install
   ```

2. **WSL 안에서 의존성 설치**
   ```bash
   wsl
   sudo apt update
   sudo apt install -y tmux git
   ```

3. **Windows 측 설치**
   - [Rust](https://rustup.rs/) (1.77+)
   - [Node.js](https://nodejs.org/) (18+)
   - [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ 빌드 도구)

#### Development

```powershell
cd frontend
npm install
cargo tauri dev
```

#### How it works on Windows

dmux는 Windows에서 WSL을 통해 tmux와 git을 실행합니다:
- 터미널 세션: `wsl tmux attach-session -t <name>`
- Git 명령: `wsl git worktree list`
- 경로 자동 변환: `C:\Users\foo` ↔ `/mnt/c/Users/foo`

WSL 내부의 tmux 데몬이 세션을 관리하므로, 앱을 껐다 켜도 터미널 세션이 유지됩니다.

#### Build

```powershell
cd frontend
cargo tauri build
```

The built app will be at:
- **Windows**: `src-tauri\target\release\bundle\msi\dmux_*.msi`
- **NSIS**: `src-tauri\target\release\bundle\nsis\dmux_*-setup.exe`

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
│       └── src/
│           ├── lib.rs        # Rust backend (PTY, git, tmux)
│           └── platform.rs   # Platform abstraction (macOS/Windows WSL)
└── README.md
```

## License

MIT
