package main

import (
	"fmt"
	"os"
	"os/exec"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/dong3789/dmux/internal/tmux"
	"github.com/dong3789/dmux/internal/tui"
	"github.com/dong3789/dmux/internal/worktree"
)

const version = "0.1.0"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "--version", "-v":
			fmt.Printf("dmux %s\n", version)
			return
		case "help", "--help", "-h":
			printHelp()
			return
		case "new":
			handleNew()
			return
		case "ls", "list":
			handleList()
			return
		case "attach", "a":
			handleAttach()
			return
		case "kill":
			handleKill()
			return
		case "wt", "worktree":
			handleWorktree()
			return
		}
	}

	// Default: launch dashboard
	launchDashboard()
}

func printHelp() {
	fmt.Println(`dmux — terminal workspace manager

Usage:
  dmux              Launch interactive dashboard
  dmux new [name]   Create a new session
  dmux ls           List sessions
  dmux a [name]     Attach to session
  dmux kill [name]  Kill session
  dmux wt           Manage git worktrees
    wt ls           List worktrees
    wt add <branch> Create worktree for branch
    wt rm <path>    Remove worktree

Flags:
  -v, --version     Show version
  -h, --help        Show this help`)
}

func launchDashboard() {
	tc, err := tmux.NewClient()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		fmt.Fprintln(os.Stderr, "hint: install tmux first (brew install tmux / apt install tmux)")
		os.Exit(1)
	}

	var wm *worktree.Manager
	if root, err := worktree.DetectRepoRoot(""); err == nil {
		wm, _ = worktree.NewManager(root)
	}

	m := tui.NewModel(tc, wm)
	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func handleNew() {
	tc, err := tmux.NewClient()
	if err != nil {
		fatal(err)
	}
	name := "dmux"
	if len(os.Args) > 2 {
		name = os.Args[2]
	}
	if err := tc.NewSession(name, ""); err != nil {
		fatal(err)
	}
	fmt.Printf("Created session: %s\n", name)

	// Auto-attach
	cmd := exec.Command("tmux", "attach-session", "-t", name)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run()
}

func handleList() {
	tc, err := tmux.NewClient()
	if err != nil {
		fatal(err)
	}
	sessions, err := tc.ListSessions()
	if err != nil {
		fatal(err)
	}
	if len(sessions) == 0 {
		fmt.Println("No active sessions.")
		return
	}
	for _, s := range sessions {
		fmt.Printf("  %s  (%d windows)  %s\n", s.Name, s.Windows, s.Created)
	}
}

func handleAttach() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: dmux attach <session-name>")
		os.Exit(1)
	}
	name := os.Args[2]
	cmd := exec.Command("tmux", "attach-session", "-t", name)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fatal(fmt.Errorf("failed to attach to %s: %w", name, err))
	}
}

func handleKill() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: dmux kill <session-name>")
		os.Exit(1)
	}
	tc, err := tmux.NewClient()
	if err != nil {
		fatal(err)
	}
	name := os.Args[2]
	if err := tc.KillSession(name); err != nil {
		fatal(err)
	}
	fmt.Printf("Killed session: %s\n", name)
}

func handleWorktree() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: dmux wt <ls|add|rm> [args...]")
		os.Exit(1)
	}

	root, err := worktree.DetectRepoRoot("")
	if err != nil {
		fatal(err)
	}
	wm, err := worktree.NewManager(root)
	if err != nil {
		fatal(err)
	}

	switch os.Args[2] {
	case "ls", "list":
		wts, err := wm.List()
		if err != nil {
			fatal(err)
		}
		for _, wt := range wts {
			branch := wt.Branch
			if branch == "" {
				branch = "(detached)"
			}
			head := wt.HEAD
		if len(head) > 8 {
			head = head[:8]
		}
		fmt.Printf("  %s  %s  %s\n", branch, wt.Path, head)
		}
	case "add":
		if len(os.Args) < 4 {
			fmt.Fprintln(os.Stderr, "usage: dmux wt add <branch-name>")
			os.Exit(1)
		}
		branch := os.Args[3]
		if err := wm.Add(branch, branch); err != nil {
			fatal(err)
		}
		fmt.Printf("Created worktree: %s\n", branch)
	case "rm", "remove":
		if len(os.Args) < 4 {
			fmt.Fprintln(os.Stderr, "usage: dmux wt rm <path>")
			os.Exit(1)
		}
		path := os.Args[3]
		if err := wm.Remove(path, false); err != nil {
			fatal(err)
		}
		fmt.Printf("Removed worktree: %s\n", path)
	default:
		fmt.Fprintf(os.Stderr, "unknown worktree command: %s\n", os.Args[2])
		os.Exit(1)
	}
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "error: %v\n", err)
	os.Exit(1)
}
