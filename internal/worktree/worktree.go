package worktree

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Worktree represents a git worktree.
type Worktree struct {
	Path   string
	Branch string
	HEAD   string
	Bare   bool
}

// Manager handles git worktree operations.
type Manager struct {
	RepoRoot string
}

// NewManager creates a worktree manager. repoRoot is the main git repo path.
func NewManager(repoRoot string) (*Manager, error) {
	// Verify it's a git repo
	cmd := exec.Command("git", "-C", repoRoot, "rev-parse", "--git-dir")
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s is not a git repository", repoRoot)
	}
	return &Manager{RepoRoot: repoRoot}, nil
}

// List returns all worktrees for the repository.
func (m *Manager) List() ([]Worktree, error) {
	cmd := exec.Command("git", "-C", m.RepoRoot, "worktree", "list", "--porcelain")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git worktree list: %w", err)
	}
	return parseWorktreeList(string(out)), nil
}

func parseWorktreeList(output string) []Worktree {
	var worktrees []Worktree
	var current Worktree

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "worktree "):
			if current.Path != "" {
				worktrees = append(worktrees, current)
			}
			current = Worktree{Path: strings.TrimPrefix(line, "worktree ")}
		case strings.HasPrefix(line, "HEAD "):
			current.HEAD = strings.TrimPrefix(line, "HEAD ")
		case strings.HasPrefix(line, "branch "):
			branch := strings.TrimPrefix(line, "branch ")
			// Strip refs/heads/ prefix
			current.Branch = strings.TrimPrefix(branch, "refs/heads/")
		case line == "bare":
			current.Bare = true
		}
	}
	if current.Path != "" {
		worktrees = append(worktrees, current)
	}
	return worktrees
}

// Add creates a new worktree. If branch is empty, it creates a new branch from the current HEAD.
func (m *Manager) Add(path, branch string) error {
	absPath := path
	if !filepath.IsAbs(path) {
		absPath = filepath.Join(filepath.Dir(m.RepoRoot), path)
	}

	args := []string{"-C", m.RepoRoot, "worktree", "add"}
	if branch != "" {
		args = append(args, "-b", branch, absPath)
	} else {
		args = append(args, absPath)
	}

	cmd := exec.Command("git", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git worktree add: %s (%w)", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// Remove removes a worktree.
func (m *Manager) Remove(path string, force bool) error {
	args := []string{"-C", m.RepoRoot, "worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, path)

	cmd := exec.Command("git", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git worktree remove: %s (%w)", strings.TrimSpace(string(out)), err)
	}
	return nil
}

// GetStatus returns the git status summary for a worktree path.
func (m *Manager) GetStatus(wtPath string) (string, error) {
	cmd := exec.Command("git", "-C", wtPath, "status", "--short")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	result := strings.TrimSpace(string(out))
	if result == "" {
		return "clean", nil
	}
	lines := strings.Split(result, "\n")
	return fmt.Sprintf("%d changed", len(lines)), nil
}

// GetBranches returns local branches in the repository.
func (m *Manager) GetBranches() ([]string, error) {
	cmd := exec.Command("git", "-C", m.RepoRoot, "branch", "--format=%(refname:short)")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" {
		return nil, nil
	}
	return strings.Split(trimmed, "\n"), nil
}

// DetectRepoRoot finds the git repository root from the given directory.
func DetectRepoRoot(dir string) (string, error) {
	if dir == "" {
		var err error
		dir, err = os.Getwd()
		if err != nil {
			return "", err
		}
	}
	cmd := exec.Command("git", "-C", dir, "rev-parse", "--show-toplevel")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("not a git repository: %s", dir)
	}
	return strings.TrimSpace(string(out)), nil
}
