import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Workspace } from '../types';

const STORAGE_KEY = 'dmux-workspaces';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Workspace[];
        setWorkspaces(parsed);
        if (parsed.length > 0) {
          setActiveWorkspaceId(parsed[0].id);
        }
      } catch { /* ignore */ }
    }
  }, []);

  const save = useCallback((ws: Workspace[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  }, []);

  const addWorkspace = useCallback(async (repoPath: string) => {
    try {
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
    } catch (e) {
      throw new Error(`Invalid git repository: ${e}`);
    }
  }, [save]);

  const removeWorkspace = useCallback((id: string) => {
    setWorkspaces(prev => {
      const next = prev.filter(w => w.id !== id);
      save(next);
      return next;
    });
    setActiveWorkspaceId(prev => prev === id ? (workspaces[0]?.id ?? null) : prev);
  }, [save, workspaces]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) ?? null;

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    removeWorkspace,
  };
}
