import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspaces } from './hooks/useWorkspaces';
import { usePaneLayout } from './hooks/usePaneLayout';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { BranchPanel } from './components/BranchPanel';
import { PaneContainer } from './components/PaneContainer';
import type { Worktree } from './types';
import './App.css';

let termCounter = 0;

function App() {
  const {
    workspaces, activeWorkspace, activeWorkspaceId,
    setActiveWorkspaceId, addWorkspace,
  } = useWorkspaces();

  const {
    layout, activePaneId, addPane, splitPane,
    closePane, setActivePaneId, updateSizes,
    loaded: paneLoaded,
  } = usePaneLayout();

  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [error, setError] = useState('');
  const initialSpawned = useRef(false);

  // Spawn a default terminal only if no saved layout
  useEffect(() => {
    if (initialSpawned.current) return;
    if (!paneLoaded) return;
    initialSpawned.current = true;
    if (!layout) {
      const home = '/Users/yoon';
      termCounter++;
      addPane(`shell-${termCounter}`, home);
    }
  }, [paneLoaded]);

  const fetchWorktrees = useCallback(async () => {
    if (!activeWorkspace) { setWorktrees([]); return; }
    try {
      const result = await invoke<Worktree[]>('list_worktrees', { repoPath: activeWorkspace.repoPath });
      setWorktrees(result);
    } catch {
      setWorktrees([]);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    fetchWorktrees();
    const interval = setInterval(fetchWorktrees, 5000);
    return () => clearInterval(interval);
  }, [fetchWorktrees]);

  // Open new default terminal
  const openNewTerminal = useCallback(() => {
    termCounter++;
    const cwd = activeWorkspace?.repoPath || '/Users/yoon';
    addPane(`shell-${termCounter}`, cwd);
  }, [addPane, activeWorkspace]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.metaKey && key === 'd' && !e.shiftKey) {
        e.preventDefault();
        if (activePaneId) splitPane(activePaneId, 'horizontal');
      }
      if (e.metaKey && key === 'd' && e.shiftKey) {
        e.preventDefault();
        if (activePaneId) splitPane(activePaneId, 'vertical');
      }
      if (e.metaKey && key === 'w') {
        e.preventDefault();
        if (activePaneId) closePane(activePaneId);
      }
      if (e.metaKey && key === 't') {
        e.preventDefault();
        openNewTerminal();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activePaneId, splitPane, closePane, openNewTerminal]);

  const handleAddWorkspace = async () => {
    try {
      const selected = await open({ directory: true, title: 'Select a git repository' });
      if (!selected) return;
      await addWorkspace(selected as string);
    } catch (e: any) {
      setError(e.message || e.toString());
    }
  };

  const handleOpenBranch = (wt: Worktree) => {
    const wsName = activeWorkspace?.name || 'ws';
    const sessionName = `dmux-${wsName}-${wt.branch}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    addPane(sessionName, wt.path);
  };

  const handleAddBranch = async (branchName: string) => {
    if (!activeWorkspace) return;
    try {
      const name = branchName.replace(/\//g, '-');
      await invoke('add_worktree', {
        repoPath: activeWorkspace.repoPath,
        name,
        branch: branchName,
      });
      await fetchWorktrees();
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleRemoveBranch = async (path: string) => {
    if (!activeWorkspace) return;
    try {
      await invoke('remove_worktree', { repoPath: activeWorkspace.repoPath, wtPath: path });
      await fetchWorktrees();
    } catch (e: any) {
      setError(e.toString());
    }
  };

  return (
    <div className="app">
      <WorkspaceSidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={setActiveWorkspaceId}
        onAddWorkspace={handleAddWorkspace}
      />

      {activeWorkspace ? (
        <BranchPanel
          workspaceName={activeWorkspace.name}
          worktrees={worktrees}
          onOpenBranch={handleOpenBranch}
          onAddBranch={handleAddBranch}
          onRemoveBranch={handleRemoveBranch}
        />
      ) : (
        <div className="no-workspace">
          <p>Add a workspace to get started</p>
          <p className="no-workspace-hint">or use the terminal on the right</p>
        </div>
      )}

      <main className="main-content">
        {error && (
          <div className="error-bar" onClick={() => setError('')}>{error}</div>
        )}
        <PaneContainer
          layout={layout}
          activePaneId={activePaneId}
          onFocusPane={setActivePaneId}
          onClosePane={closePane}
          onUpdateSizes={updateSizes}
        />
      </main>
    </div>
  );
}

export default App;
