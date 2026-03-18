import { useRef, useCallback } from 'react';
import type { LayoutNode } from '../types';
import { TerminalPane } from './TerminalPane';
import './PaneContainer.css';

interface Props {
  layout: LayoutNode | null;
  activePaneId: string | null;
  onFocusPane: (id: string) => void;
  onClosePane: (id: string) => void;
  onUpdateSizes: (splitId: string, sizes: number[]) => void;
}

function RenderNode({
  node,
  activePaneId,
  onFocusPane,
  onClosePane,
  onUpdateSizes,
}: {
  node: LayoutNode;
  activePaneId: string | null;
  onFocusPane: (id: string) => void;
  onClosePane: (id: string) => void;
  onUpdateSizes: (splitId: string, sizes: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = useCallback(
    (index: number, splitId: string, direction: string, sizes: number[], _childCount: number) =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const isHorizontal = direction === 'horizontal';
        const totalSize = isHorizontal ? rect.width : rect.height;
        const startPos = isHorizontal ? e.clientX : e.clientY;
        const startSizes = [...sizes];

        const onMouseMove = (moveEvent: MouseEvent) => {
          const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
          const delta = ((currentPos - startPos) / totalSize) * 100;
          const newSizes = [...startSizes];
          newSizes[index] = Math.max(10, startSizes[index] + delta);
          newSizes[index + 1] = Math.max(10, startSizes[index + 1] - delta);
          onUpdateSizes(splitId, newSizes);
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      },
    [onUpdateSizes]
  );

  if (node.type === 'terminal') {
    return (
      <TerminalPane
        paneId={node.id}
        sessionName={node.sessionName}
        worktreePath={node.worktreePath}
        isActive={node.id === activePaneId}
        onFocus={onFocusPane}
        onClose={onClosePane}
      />
    );
  }

  const isHorizontal = node.direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`split-container ${isHorizontal ? 'split-horizontal' : 'split-vertical'}`}
    >
      {node.children.map((child, i) => (
        <div key={child.id} style={{ display: 'contents' }}>
          <div
            className="split-child"
            style={{ flexBasis: `${node.sizes[i]}%`, flexGrow: 0, flexShrink: 0 }}
          >
            <RenderNode
              node={child}
              activePaneId={activePaneId}
              onFocusPane={onFocusPane}
              onClosePane={onClosePane}
              onUpdateSizes={onUpdateSizes}
            />
          </div>
          {i < node.children.length - 1 && (
            <div
              className={`split-divider ${isHorizontal ? 'divider-h' : 'divider-v'}`}
              onMouseDown={handleDividerMouseDown(i, node.id, node.direction, node.sizes, node.children.length)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function PaneContainer({ layout, activePaneId, onFocusPane, onClosePane, onUpdateSizes }: Props) {
  if (!layout) {
    return (
      <div className="pane-empty">
        <div className="pane-empty-icon">⎇</div>
        <p>Select a branch to open a terminal</p>
        <p className="pane-empty-hint">Click on a branch in the panel to start</p>
      </div>
    );
  }

  return (
    <div className="pane-container">
      <RenderNode
        node={layout}
        activePaneId={activePaneId}
        onFocusPane={onFocusPane}
        onClosePane={onClosePane}
        onUpdateSizes={onUpdateSizes}
      />
    </div>
  );
}
