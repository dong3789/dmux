import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LayoutNode, PaneNode, SplitNode, SplitDirection } from '../types';
import { destroyPty } from '../components/TerminalPane';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function findAndReplace(
  node: LayoutNode,
  targetId: string,
  replacer: (node: PaneNode) => LayoutNode
): LayoutNode | null {
  if (node.type === 'terminal') {
    return node.id === targetId ? replacer(node) : null;
  }
  const children = node.children.map(child => {
    const replaced = findAndReplace(child, targetId, replacer);
    return replaced ?? child;
  });
  const changed = children.some((c, i) => c !== node.children[i]);
  return changed ? { ...node, children } : null;
}

function removeNode(node: LayoutNode, targetId: string): LayoutNode | null | 'removed' {
  if (node.type === 'terminal') {
    return node.id === targetId ? 'removed' : null;
  }
  const newChildren: LayoutNode[] = [];
  let changed = false;
  for (const child of node.children) {
    const result = removeNode(child, targetId);
    if (result === 'removed') {
      changed = true;
    } else if (result !== null) {
      newChildren.push(result);
      changed = true;
    } else {
      newChildren.push(child);
    }
  }
  if (!changed) return null;
  if (newChildren.length === 0) return 'removed';
  if (newChildren.length === 1) return newChildren[0];
  const newSizes = newChildren.map(() => 100 / newChildren.length);
  return { ...node, children: newChildren, sizes: newSizes };
}

function updateSizesInTree(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode | null {
  if (node.type === 'terminal') return null;
  if (node.id === splitId) return { ...node, sizes };
  const children = node.children.map(child => {
    const updated = updateSizesInTree(child, splitId, sizes);
    return updated ?? child;
  });
  const changed = children.some((c, i) => c !== node.children[i]);
  return changed ? { ...node, children } : null;
}

export function usePaneLayout() {
  const [layout, setLayout] = useState<LayoutNode | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Load layout on mount
  useEffect(() => {
    (async () => {
      try {
        const json = await invoke<string>('load_layout');
        const parsed = JSON.parse(json);
        if (parsed) {
          setLayout(parsed);
          // Find first terminal pane to set as active
          const findFirst = (node: LayoutNode): string | null => {
            if (node.type === 'terminal') return node.id;
            for (const child of node.children) {
              const found = findFirst(child);
              if (found) return found;
            }
            return null;
          };
          setActivePaneId(findFirst(parsed));
        }
      } catch (e) { console.error('Failed to load layout:', e); }
      setLoaded(true);
    })();
  }, []);

  // Save layout on change (debounced)
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      invoke('save_layout', { data: JSON.stringify(layout) }).catch(console.error);
    }, 500);
  }, [layout, loaded]);

  const addPane = useCallback((sessionName: string, worktreePath: string) => {
    const newPane: PaneNode = {
      id: generateId(),
      type: 'terminal',
      sessionName,
      worktreePath,
    };

    setLayout(prev => {
      if (!prev) {
        setActivePaneId(newPane.id);
        return newPane;
      }
      const splitNode: SplitNode = {
        id: generateId(),
        type: 'split',
        direction: 'horizontal',
        children: [prev, newPane],
        sizes: [50, 50],
      };
      setActivePaneId(newPane.id);
      return splitNode;
    });
  }, []);

  const splitPane = useCallback((paneId: string, direction: SplitDirection) => {
    setLayout(prev => {
      if (!prev) return prev;
      const newId = generateId();
      const newSessionName = `shell-${newId}`;

      const replacer = (node: PaneNode): LayoutNode => {
        const newPane: PaneNode = {
          id: newId,
          type: 'terminal',
          sessionName: newSessionName,
          worktreePath: node.worktreePath,
        };
        const splitNode: SplitNode = {
          id: generateId(),
          type: 'split',
          direction,
          children: [node, newPane],
          sizes: [50, 50],
        };
        return splitNode;
      };

      if (prev.type === 'terminal' && prev.id === paneId) {
        const result = replacer(prev);
        setActivePaneId(newId);
        return result;
      }

      const result = findAndReplace(prev, paneId, replacer);
      if (result) {
        setActivePaneId(newId);
        return result;
      }
      return prev;
    });
  }, []);

  const closePane = useCallback((paneId: string) => {
    setLayout(prev => {
      if (!prev) return prev;

      // Find the pane's sessionName before removing, to destroy its PTY
      const findPane = (node: LayoutNode): PaneNode | null => {
        if (node.type === 'terminal') return node.id === paneId ? node : null;
        for (const child of node.children) {
          const found = findPane(child);
          if (found) return found;
        }
        return null;
      };
      const pane = findPane(prev);
      if (pane) destroyPty(pane.sessionName);

      if (prev.type === 'terminal' && prev.id === paneId) {
        setActivePaneId(null);
        return null;
      }
      const result = removeNode(prev, paneId);
      if (result === 'removed') {
        setActivePaneId(null);
        return null;
      }
      if (result !== null) {
        const findFirst = (node: LayoutNode): string | null => {
          if (node.type === 'terminal') return node.id;
          for (const child of node.children) {
            const found = findFirst(child);
            if (found) return found;
          }
          return null;
        };
        setActivePaneId(findFirst(result));
        return result;
      }
      return prev;
    });
  }, []);

  const updateSizes = useCallback((splitId: string, sizes: number[]) => {
    setLayout(prev => {
      if (!prev) return prev;
      const result = updateSizesInTree(prev, splitId, sizes);
      return result ?? prev;
    });
  }, []);

  return {
    layout,
    activePaneId,
    addPane,
    splitPane,
    closePane,
    setActivePaneId,
    updateSizes,
    loaded,
  };
}
