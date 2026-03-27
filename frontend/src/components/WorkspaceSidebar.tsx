import { useState } from 'react';
import type { Workspace } from '../types';
import './WorkspaceSidebar.css';

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace?: (id: string) => void;
}

export function WorkspaceSidebar({ workspaces, activeWorkspaceId, onSelectWorkspace, onAddWorkspace, onRemoveWorkspace }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleContextMenu = (e: React.MouseEvent, wsId: string) => {
    e.preventDefault();
    setConfirmDeleteId(wsId);
  };

  return (
    <div className="ws-sidebar">
      <div className="ws-logo">◇</div>

      <div className="ws-list">
        {workspaces.map(ws => (
          <div
            key={ws.id}
            className={`ws-item ${ws.id === activeWorkspaceId ? 'active' : ''}`}
            onClick={() => onSelectWorkspace(ws.id)}
            onContextMenu={(e) => handleContextMenu(e, ws.id)}
            onMouseEnter={() => setHoveredId(ws.id)}
            onMouseLeave={() => { setHoveredId(null); setConfirmDeleteId(null); }}
          >
            <div className="ws-icon">{ws.name.charAt(0).toUpperCase()}</div>
            {confirmDeleteId === ws.id && onRemoveWorkspace ? (
              <div className="ws-tooltip ws-delete-confirm">
                <span>Remove?</span>
                <button className="ws-delete-yes" onClick={(e) => { e.stopPropagation(); onRemoveWorkspace(ws.id); setConfirmDeleteId(null); }}>Yes</button>
                <button className="ws-delete-no" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>No</button>
              </div>
            ) : hoveredId === ws.id ? (
              <div className="ws-tooltip">{ws.name}</div>
            ) : null}
          </div>
        ))}
      </div>

      <button className="ws-add" onClick={onAddWorkspace}>+</button>
    </div>
  );
}
