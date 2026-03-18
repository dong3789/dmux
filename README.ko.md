# dmux

Git worktree를 분할 터미널로 관리하는 데스크톱 앱.

[Conductor](https://conductor.run), [cmux](https://cmux.dev), [tmux](https://github.com/tmux/tmux)에서 영감을 받았습니다.

> [English README](./README.md)

## dmux란?

dmux는 독립 실행형 데스크톱 터미널 앱으로 다음을 결합합니다:

- **Conductor 스타일 대시보드** — 사이드바로 워크스페이스를 시각적으로 관리
- **cmux 스타일 분할 패인** — 터미널을 가로/세로 자유롭게 분할
- **Git worktree 통합** — 각 브랜치가 독립된 작업 디렉토리를 가짐

## 스크린샷

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

## 주요 기능

- **워크스페이스** — 여러 git 저장소를 추가하고 전환
- **브랜치 관리** — git worktree를 아코디언 목록으로 표시, 새 브랜치 생성 시 worktree 자동 생성
- **터미널 분할** — 단축키로 터미널을 자유롭게 분할
- **네이티브 앱** — Tauri 기반, 가벼운 데스크톱 앱 (~10MB)
- **크로스 플랫폼** — macOS, Windows, Linux 지원

## 단축키

| 단축키 | 동작 |
|--------|------|
| `Cmd+D` | 가로 분할 (상/하) |
| `Cmd+Shift+D` | 세로 분할 (좌/우) |
| `Cmd+W` | 현재 패인 닫기 |
| `Cmd+T` | 새 터미널 |

## 기술 스택

- **프론트엔드**: React + TypeScript + xterm.js
- **백엔드**: Rust (Tauri)
- **터미널**: `portable-pty` 기반 PTY
- **UI**: 커스텀 CSS (다크 테마)

## 시작하기

### 필수 요건

- [Rust](https://rustup.rs/) (1.77+)
- [Node.js](https://nodejs.org/) (18+)
- Git

### 개발 모드

```bash
cd frontend
npm install
cargo tauri dev
```

### 빌드

```bash
cd frontend
cargo tauri build
```

빌드 결과물:
- **macOS 앱**: `src-tauri/target/release/bundle/macos/dmux.app`
- **DMG 설치파일**: `src-tauri/target/release/bundle/dmg/dmux_*.dmg`

## 프로젝트 구조

```
dmux/
├── frontend/
│   ├── src/
│   │   ├── components/       # React 컴포넌트
│   │   │   ├── WorkspaceSidebar.tsx  # 워크스페이스 사이드바
│   │   │   ├── BranchPanel.tsx       # 브랜치 아코디언 패널
│   │   │   ├── PaneContainer.tsx     # 분할 패인 컨테이너
│   │   │   └── TerminalPane.tsx      # 터미널 패인
│   │   ├── hooks/            # React 훅
│   │   │   ├── useWorkspaces.ts      # 워크스페이스 관리
│   │   │   └── usePaneLayout.ts      # 패인 레이아웃 관리
│   │   ├── types.ts          # TypeScript 타입 정의
│   │   └── App.tsx           # 메인 앱
│   └── src-tauri/
│       └── src/lib.rs        # Rust 백엔드 (PTY, git)
└── README.md
```

## 라이선스

MIT
