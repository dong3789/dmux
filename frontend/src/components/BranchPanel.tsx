import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Worktree } from '../types';
import './BranchPanel.css';

interface WorktreeMeta {
  baseBranch: string;
  branch: string;
  createdAt: string;
  inferred?: boolean;
}

interface Props {
  workspaceName: string;
  worktrees: Worktree[];
  onOpenBranch: (wt: Worktree) => void;
  onAddBranch: (branchName: string, baseBranch: string) => void;
  onRemoveBranch: (path: string) => void;
}

export function BranchPanel({ workspaceName, worktrees, onOpenBranch, onAddBranch, onRemoveBranch }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [metaMap, setMetaMap] = useState<Record<string, WorktreeMeta>>({});
  const [changingBasePath, setChangingBasePath] = useState<string | null>(null);
  const [newBase, setNewBase] = useState('');
  const [rebaseError, setRebaseError] = useState('');

  // Load metadata for all worktrees
  useEffect(() => {
    (async () => {
      const map: Record<string, WorktreeMeta> = {};
      for (const wt of worktrees) {
        try {
          const json = await invoke<string>('get_worktree_meta', { wtPath: wt.path });
          const parsed = JSON.parse(json);
          if (parsed) map[wt.path] = parsed;
        } catch { /* no meta */ }
      }
      setMetaMap(map);
    })();
  }, [worktrees]);

  const handleAdd = () => {
    if (branchName.trim()) {
      onAddBranch(branchName.trim(), baseBranch);
      setBranchName('');
      setBaseBranch('');
      setShowInput(false);
    }
  };

  const handleDelete = (path: string) => {
    if (confirmDeletePath === path) {
      onRemoveBranch(path);
      setConfirmDeletePath(null);
    } else {
      setConfirmDeletePath(path);
    }
  };

  const handleChangeBase = async (wtPath: string, rebase: boolean) => {
    if (!newBase) return;
    setRebaseError('');
    try {
      if (rebase) {
        await invoke('rebase_worktree', { wtPath, newBase });
      } else {
        await invoke('update_worktree_meta', { wtPath, baseBranch: newBase });
      }
      // Refresh meta
      const json = await invoke<string>('get_worktree_meta', { wtPath });
      const parsed = JSON.parse(json);
      if (parsed) setMetaMap(prev => ({ ...prev, [wtPath]: parsed }));
      setChangingBasePath(null);
      setNewBase('');
    } catch (e: any) {
      setRebaseError(e.toString());
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
              if (e.key === 'Escape') { setShowInput(false); setBranchName(''); setBaseBranch(''); }
            }}
          />
          <div className="bp-base-row">
            <span className="bp-base-label">from</span>
            <select
              className="bp-select"
              value={baseBranch}
              onChange={e => setBaseBranch(e.target.value)}
            >
              <option value="">HEAD (current)</option>
              {worktrees.filter(wt => wt.branch).map(wt => (
                <option key={wt.path} value={wt.branch}>{wt.branch}</option>
              ))}
            </select>
          </div>
          <button className="bp-btn-open" onClick={handleAdd}>Create</button>
        </div>
      )}

      <div className="branch-list">
        {worktrees.map(wt => {
          const isExpanded = expandedId === wt.path;
          const isConfirming = confirmDeletePath === wt.path;
          const isChangingBase = changingBasePath === wt.path;
          const meta = metaMap[wt.path];
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
                {meta && <span className={`tag-base ${meta.inferred ? 'inferred' : ''}`}>← {meta.baseBranch}</span>}
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
                    <span className="detail-label">Base</span>
                    {isChangingBase ? (
                      <div className="base-change-form">
                        <select
                          className="bp-select bp-select-sm"
                          value={newBase}
                          onChange={e => setNewBase(e.target.value)}
                        >
                          <option value="">Select branch</option>
                          {worktrees.filter(w => w.branch && w.branch !== wt.branch).map(w => (
                            <option key={w.path} value={w.branch}>{w.branch}</option>
                          ))}
                        </select>
                        <button
                          className="bp-btn-sm bp-btn-rebase"
                          onClick={() => handleChangeBase(wt.path, true)}
                          disabled={!newBase}
                          title="Rebase onto new base"
                        >Rebase</button>
                        <button
                          className="bp-btn-sm bp-btn-label-only"
                          onClick={() => handleChangeBase(wt.path, false)}
                          disabled={!newBase}
                          title="Change label only (no rebase)"
                        >Label</button>
                        <button
                          className="bp-btn-sm bp-btn-cancel"
                          onClick={() => { setChangingBasePath(null); setNewBase(''); setRebaseError(''); }}
                        >✕</button>
                      </div>
                    ) : (
                      <>
                        <span className="detail-base">{meta?.baseBranch || '—'}</span>
                        {!wt.is_main && (
                          <button
                            className="bp-btn-change-base"
                            onClick={() => { setChangingBasePath(wt.path); setNewBase(''); setRebaseError(''); }}
                          >Change</button>
                        )}
                      </>
                    )}
                  </div>
                  {rebaseError && isChangingBase && (
                    <div className="rebase-error">{rebaseError}</div>
                  )}
                  <div className="accordion-detail">
                    <span className="detail-label">Path</span>
                    <span className="detail-path">{wt.path.split('/').slice(-2).join('/')}</span>
                  </div>
                  <div className="accordion-actions">
                    <button className="bp-btn-open" onClick={() => onOpenBranch(wt)}>
                      Open Terminal
                    </button>
                    {!wt.is_main && (
                      isConfirming ? (
                        <div className="delete-confirm">
                          <span className="delete-confirm-text">Delete worktree?</span>
                          <button className="bp-btn-confirm-yes" onClick={() => handleDelete(wt.path)}>
                            Yes, delete
                          </button>
                          <button className="bp-btn-confirm-no" onClick={() => setConfirmDeletePath(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="bp-btn-delete" onClick={() => handleDelete(wt.path)}>
                          Delete
                        </button>
                      )
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
