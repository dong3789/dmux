import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Workspace } from '../types';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load from file on mount
  useEffect(() => {
    (async () => {
      try {
        const json = await invoke<string>('load_workspaces');
        const parsed = JSON.parse(json) as Workspace[];
        setWorkspaces(parsed);
        if (parsed.length > 0) {
          setActiveWorkspaceId(parsed[0].id);
        }
      } catch {
        setWorkspaces([]);
      }
      setLoaded(true);
    })();
  }, []);

  const save = useCallback(async (ws: Workspace[]) => {
    try {
      await invoke('save_workspaces', { data: JSON.stringify(ws) });
    } catch (e) {
      console.error('Failed to save workspaces:', e);
    }
  }, []);

  const addWorkspace = useCallback(async (repoPath: string) => {
    const validPath = await invoke<string>('validate_repo_path', { path: repoPath });
    const name = validPath.split('/').filter(Boolean).pop() || 'repo';
    const ws: Workspace = { id: generateId(), name, repoPath: validPath };
    setWorkspaces(prev => {
      const next = [...prev, ws];
      save(next);
      return next;
    });
    setActiveWorkspaceId(ws.id);
    return ws;
  }, [save]);

  const removeWorkspace = useCallback((id: string) => {
    setWorkspaces(prev => {
      const next = prev.filter(w => w.id !== id);
      save(next);
      return next;
    });
    setActiveWorkspaceId(prev => prev === id ? null : prev);
  }, [save]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) ?? null;

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    removeWorkspace,
    loaded,
  };
}
