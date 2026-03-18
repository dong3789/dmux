export interface Workspace {
  id: string;
  name: string;
  repoPath: string;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  is_bare: boolean;
  is_main: boolean;
  status: string;
  changed_files: number;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneNode {
  id: string;
  type: 'terminal';
  sessionName: string;
  worktreePath: string;
}

export interface SplitNode {
  id: string;
  type: 'split';
  direction: SplitDirection;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;
