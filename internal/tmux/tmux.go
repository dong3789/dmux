package tmux

import (
	"fmt"
	"os/exec"
	"strings"
)

// Client wraps tmux commands for session, window, and pane management.
type Client struct {
	Binary string // path to tmux binary
}

// NewClient creates a new tmux client.
func NewClient() (*Client, error) {
	bin, err := exec.LookPath("tmux")
	if err != nil {
		return nil, fmt.Errorf("tmux not found: %w", err)
	}
	return &Client{Binary: bin}, nil
}

// run executes a tmux command and returns trimmed stdout.
func (c *Client) run(args ...string) (string, error) {
	cmd := exec.Command(c.Binary, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("tmux %s: %s (%w)", strings.Join(args, " "), strings.TrimSpace(string(out)), err)
	}
	return strings.TrimSpace(string(out)), nil
}

// Session represents a tmux session.
type Session struct {
	Name    string
	Windows int
	Created string
}

// Window represents a tmux window.
type Window struct {
	Index  int
	Name   string
	Active bool
	Panes  int
}

// Pane represents a tmux pane.
type Pane struct {
	ID     string
	Index  int
	Active bool
	Width  int
	Height int
	CWD    string
	Cmd    string
}

// ListSessions returns all tmux sessions.
func (c *Client) ListSessions() ([]Session, error) {
	out, err := c.run("list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_created_string}")
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "no sessions") {
			return nil, nil
		}
		return nil, err
	}
	if out == "" {
		return nil, nil
	}
	var sessions []Session
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		wins := 0
		fmt.Sscanf(parts[1], "%d", &wins)
		sessions = append(sessions, Session{
			Name:    parts[0],
			Windows: wins,
			Created: parts[2],
		})
	}
	return sessions, nil
}

// NewSession creates a new tmux session. If startDir is non-empty, the session starts there.
func (c *Client) NewSession(name, startDir string) error {
	args := []string{"new-session", "-d", "-s", name}
	if startDir != "" {
		args = append(args, "-c", startDir)
	}
	_, err := c.run(args...)
	return err
}

// KillSession kills a tmux session by name.
func (c *Client) KillSession(name string) error {
	_, err := c.run("kill-session", "-t", name)
	return err
}

// AttachSession attaches to a tmux session (replaces current process).
func (c *Client) AttachSession(name string) error {
	cmd := exec.Command(c.Binary, "attach-session", "-t", name)
	cmd.Stdin = nil // will be set by caller
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

// ListWindows returns windows in a session.
func (c *Client) ListWindows(session string) ([]Window, error) {
	out, err := c.run("list-windows", "-t", session, "-F", "#{window_index}\t#{window_name}\t#{window_active}\t#{window_panes}")
	if err != nil {
		return nil, err
	}
	if out == "" {
		return nil, nil
	}
	var windows []Window
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		idx := 0
		fmt.Sscanf(parts[0], "%d", &idx)
		panes := 0
		fmt.Sscanf(parts[3], "%d", &panes)
		windows = append(windows, Window{
			Index:  idx,
			Name:   parts[1],
			Active: parts[2] == "1",
			Panes:  panes,
		})
	}
	return windows, nil
}

// NewWindow creates a new window in the given session.
func (c *Client) NewWindow(session, name, startDir string) error {
	args := []string{"new-window", "-t", session, "-n", name}
	if startDir != "" {
		args = append(args, "-c", startDir)
	}
	_, err := c.run(args...)
	return err
}

// ListPanes returns panes in a given target (session:window).
func (c *Client) ListPanes(target string) ([]Pane, error) {
	out, err := c.run("list-panes", "-t", target, "-F",
		"#{pane_id}\t#{pane_index}\t#{pane_active}\t#{pane_width}\t#{pane_height}\t#{pane_current_path}\t#{pane_current_command}")
	if err != nil {
		return nil, err
	}
	if out == "" {
		return nil, nil
	}
	var panes []Pane
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(line, "\t", 7)
		if len(parts) < 7 {
			continue
		}
		idx := 0
		fmt.Sscanf(parts[1], "%d", &idx)
		w, h := 0, 0
		fmt.Sscanf(parts[3], "%d", &w)
		fmt.Sscanf(parts[4], "%d", &h)
		panes = append(panes, Pane{
			ID:     parts[0],
			Index:  idx,
			Active: parts[2] == "1",
			Width:  w,
			Height: h,
			CWD:    parts[5],
			Cmd:    parts[6],
		})
	}
	return panes, nil
}

// SplitWindow splits a pane. horizontal=true for side-by-side, false for top-bottom.
func (c *Client) SplitWindow(target string, horizontal bool, startDir string) error {
	args := []string{"split-window", "-t", target}
	if horizontal {
		args = append(args, "-h")
	}
	if startDir != "" {
		args = append(args, "-c", startDir)
	}
	_, err := c.run(args...)
	return err
}

// SendKeys sends keystrokes to a pane.
func (c *Client) SendKeys(target, keys string) error {
	_, err := c.run("send-keys", "-t", target, keys, "Enter")
	return err
}

// RenameSession renames a tmux session.
func (c *Client) RenameSession(oldName, newName string) error {
	_, err := c.run("rename-session", "-t", oldName, newName)
	return err
}

// RenameWindow renames a window.
func (c *Client) RenameWindow(target, newName string) error {
	_, err := c.run("rename-window", "-t", target, newName)
	return err
}

// KillPane kills a specific pane.
func (c *Client) KillPane(target string) error {
	_, err := c.run("kill-pane", "-t", target)
	return err
}

// HasSession checks if a session exists.
func (c *Client) HasSession(name string) bool {
	_, err := c.run("has-session", "-t", name)
	return err == nil
}
