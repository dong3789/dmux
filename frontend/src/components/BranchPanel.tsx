import { useState } from 'react';
import type { Worktree } from '../types';
import './BranchPanel.css';

interface Props {
  workspaceName: string;
  worktrees: Worktree[];
  onOpenBranch: (wt: Worktree) => void;
  onAddBranch: (branchName: string) => void;
  onRemoveBranch: (path: string) => void;
}

export function BranchPanel({ workspaceName, worktrees, onOpenBranch, onAddBranch, onRemoveBranch }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [branchName, setBranchName] = useState('');

  const handleAdd = () => {
    if (branchName.trim()) {
      onAddBranch(branchName.trim());
      setBranchName('');
      setShowInput(false);
    }
  };

  return (
    <div className="branch-panel">
      <div className="branch-panel-header">
        <h2 className="branch-panel-title">{workspaceName}</h2>
        <button className="bp-btn-new" onClick={() => setShowInput(true)}>+ Branch</button>
      </div>

      {showInput && (
        <div className="bp-input-row">
          <input
            autoFocus
            className="bp-input"
            placeholder="feature/my-branch"
            value={branchName}
            onChange={e => setBranchName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setShowInput(false); setBranchName(''); }
            }}
          />
          <button className="bp-btn-open" onClick={handleAdd}>Create</button>
        </div>
      )}

      <div className="branch-list">
        {worktrees.map(wt => {
          const isExpanded = expandedId === wt.path;
          return (
            <div key={wt.path} className="accordion-item">
              <div
                className="accordion-header"
                onClick={() => setExpandedId(isExpanded ? null : wt.path)}
              >
                <span className={`accordion-arrow ${isExpanded ? 'open' : ''}`}>▶</span>
                <span className={`branch-icon ${wt.is_main ? 'main' : ''}`}>⎇</span>
                <span className="branch-name">{wt.branch || 'detached'}</span>
                {wt.is_main && <span className="tag-main">main</span>}
                <span className="branch-status-spacer" />
                {wt.changed_files === 0 ? (
                  <span className="tag-clean">✓</span>
                ) : (
                  <span className="tag-changed">●{wt.changed_files}</span>
                )}
              </div>

              {isExpanded && (
                <div className="accordion-body">
                  <div className="accordion-detail">
                    <span className="detail-label">HEAD</span>
                    <code className="detail-hash">{wt.head.substring(0, 7)}</code>
                  </div>
                  <div className="accordion-detail">
                    <span className="detail-label">Path</span>
                    <span className="detail-path">{wt.path.split('/').slice(-2).join('/')}</span>
                  </div>
                  <div className="accordion-actions">
                    <button className="bp-btn-open" onClick={() => onOpenBranch(wt)}>
                      Open Terminal
                    </button>
                    {!wt.is_main && (
                      <button className="bp-btn-delete" onClick={() => onRemoveBranch(wt.path)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
