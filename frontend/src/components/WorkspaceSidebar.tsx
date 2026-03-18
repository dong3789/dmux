import { useState } from 'react';
import type { Workspace } from '../types';
import './WorkspaceSidebar.css';

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
}

export function WorkspaceSidebar({ workspaces, activeWorkspaceId, onSelectWorkspace, onAddWorkspace }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="ws-sidebar">
      <div className="ws-logo">◇</div>

      <div className="ws-list">
        {workspaces.map(ws => (
          <div
            key={ws.id}
            className={`ws-item ${ws.id === activeWorkspaceId ? 'active' : ''}`}
            onClick={() => onSelectWorkspace(ws.id)}
            onMouseEnter={() => setHoveredId(ws.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div className="ws-icon">{ws.name.charAt(0).toUpperCase()}</div>
            {hoveredId === ws.id && (
              <div className="ws-tooltip">{ws.name}</div>
            )}
          </div>
        ))}
      </div>

      <button className="ws-add" onClick={onAddWorkspace}>+</button>
    </div>
  );
}
