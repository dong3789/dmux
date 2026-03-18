package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/dong3789/dmux/internal/tmux"
	"github.com/dong3789/dmux/internal/worktree"
)

// Tab represents a dashboard tab.
type Tab int

const (
	TabSessions Tab = iota
	TabWorktrees
)

// Model is the main TUI model.
type Model struct {
	tmux      *tmux.Client
	wt        *worktree.Manager
	tab       Tab
	width     int
	height    int
	cursor    int
	sessions  []tmux.Session
	worktrees []worktree.Worktree
	err       error
	quitting  bool
	message   string // status message
	input     string // for prompts
	inputMode bool
	inputPrompt string
	inputAction func(string) tea.Cmd
}

// NewModel creates the initial dashboard model.
func NewModel(tc *tmux.Client, wm *worktree.Manager) Model {
	return Model{
		tmux: tc,
		wt:   wm,
		tab:  TabSessions,
	}
}

// --- Messages ---

type sessionsMsg []tmux.Session
type worktreesMsg []worktree.Worktree
type errMsg struct{ err error }
type statusMsg string

func (e errMsg) Error() string { return e.err.Error() }

// --- Commands ---

func (m Model) fetchSessions() tea.Msg {
	sessions, err := m.tmux.ListSessions()
	if err != nil {
		return errMsg{err}
	}
	return sessionsMsg(sessions)
}

func (m Model) fetchWorktrees() tea.Msg {
	if m.wt == nil {
		return worktreesMsg(nil)
	}
	wts, err := m.wt.List()
	if err != nil {
		return errMsg{err}
	}
	return worktreesMsg(wts)
}

// Init starts by fetching data.
func (m Model) Init() tea.Cmd {
	return tea.Batch(m.fetchSessions, m.fetchWorktrees)
}

// Update handles messages.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case sessionsMsg:
		m.sessions = msg
		m.err = nil
		return m, nil
	case worktreesMsg:
		m.worktrees = msg
		m.err = nil
		return m, nil
	case errMsg:
		m.err = msg.err
		return m, nil
	case statusMsg:
		m.message = string(msg)
		return m, nil
	}
	return m, nil
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Input mode: capture text
	if m.inputMode {
		switch msg.String() {
		case "enter":
			m.inputMode = false
			action := m.inputAction
			val := m.input
			m.input = ""
			m.inputAction = nil
			m.inputPrompt = ""
			if action != nil {
				return m, action(val)
			}
			return m, nil
		case "esc":
			m.inputMode = false
			m.input = ""
			m.inputPrompt = ""
			m.inputAction = nil
			return m, nil
		case "backspace":
			if len(m.input) > 0 {
				m.input = m.input[:len(m.input)-1]
			}
			return m, nil
		default:
			if len(msg.String()) == 1 || msg.String() == " " {
				m.input += msg.String()
			}
			return m, nil
		}
	}

	switch {
	case key.Matches(msg, keys.Quit):
		m.quitting = true
		return m, tea.Quit
	case key.Matches(msg, keys.Tab):
		m.tab = (m.tab + 1) % 2
		m.cursor = 0
		return m, nil
	case key.Matches(msg, keys.Up):
		if m.cursor > 0 {
			m.cursor--
		}
		return m, nil
	case key.Matches(msg, keys.Down):
		m.cursor++
		m.cursor = min(m.cursor, m.listLen()-1)
		if m.cursor < 0 {
			m.cursor = 0
		}
		return m, nil
	case key.Matches(msg, keys.Enter):
		return m.handleEnter()
	case key.Matches(msg, keys.New):
		return m.handleNew()
	case key.Matches(msg, keys.Delete):
		return m.handleDelete()
	case key.Matches(msg, keys.Split):
		return m.handleSplit()
	case key.Matches(msg, keys.Refresh):
		return m, tea.Batch(m.fetchSessions, m.fetchWorktrees)
	}
	return m, nil
}

func (m Model) listLen() int {
	switch m.tab {
	case TabSessions:
		return len(m.sessions)
	case TabWorktrees:
		return len(m.worktrees)
	}
	return 0
}

func (m Model) handleEnter() (tea.Model, tea.Cmd) {
	switch m.tab {
	case TabSessions:
		if m.cursor < len(m.sessions) {
			s := m.sessions[m.cursor]
			// Attach to session — exit TUI and attach
			return m, tea.Sequence(
				tea.ExitAltScreen,
				func() tea.Msg {
					_ = m.tmux.AttachSession(s.Name)
					return statusMsg("detached from " + s.Name)
				},
				tea.EnterAltScreen,
				m.fetchSessions,
			)
		}
	case TabWorktrees:
		if m.cursor < len(m.worktrees) {
			wt := m.worktrees[m.cursor]
			// Create a session for the worktree and attach
			sessionName := sanitizeSessionName(wt.Branch)
			if !m.tmux.HasSession(sessionName) {
				_ = m.tmux.NewSession(sessionName, wt.Path)
			}
			return m, tea.Sequence(
				tea.ExitAltScreen,
				func() tea.Msg {
					_ = m.tmux.AttachSession(sessionName)
					return statusMsg("detached from " + sessionName)
				},
				tea.EnterAltScreen,
				m.fetchSessions,
			)
		}
	}
	return m, nil
}

func (m Model) handleNew() (tea.Model, tea.Cmd) {
	switch m.tab {
	case TabSessions:
		m.inputMode = true
		m.inputPrompt = "New session name: "
		m.inputAction = func(name string) tea.Cmd {
			return func() tea.Msg {
				if name == "" {
					return statusMsg("cancelled")
				}
				if err := m.tmux.NewSession(name, ""); err != nil {
					return errMsg{err}
				}
				sessions, _ := m.tmux.ListSessions()
				return sessionsMsg(sessions)
			}
		}
	case TabWorktrees:
		m.inputMode = true
		m.inputPrompt = "New branch name: "
		m.inputAction = func(branch string) tea.Cmd {
			return func() tea.Msg {
				if branch == "" || m.wt == nil {
					return statusMsg("cancelled")
				}
				path := branch // use branch name as directory name
				if err := m.wt.Add(path, branch); err != nil {
					return errMsg{err}
				}
				wts, _ := m.wt.List()
				return worktreesMsg(wts)
			}
		}
	}
	return m, nil
}

func (m Model) handleDelete() (tea.Model, tea.Cmd) {
	switch m.tab {
	case TabSessions:
		if m.cursor < len(m.sessions) {
			s := m.sessions[m.cursor]
			return m, func() tea.Msg {
				if err := m.tmux.KillSession(s.Name); err != nil {
					return errMsg{err}
				}
				sessions, _ := m.tmux.ListSessions()
				return sessionsMsg(sessions)
			}
		}
	case TabWorktrees:
		if m.cursor < len(m.worktrees) && m.cursor > 0 { // can't remove main worktree
			wt := m.worktrees[m.cursor]
			return m, func() tea.Msg {
				if m.wt == nil {
					return statusMsg("no git repo")
				}
				if err := m.wt.Remove(wt.Path, false); err != nil {
					return errMsg{err}
				}
				wts, _ := m.wt.List()
				return worktreesMsg(wts)
			}
		}
	}
	return m, nil
}

func (m Model) handleSplit() (tea.Model, tea.Cmd) {
	if m.tab == TabSessions && m.cursor < len(m.sessions) {
		s := m.sessions[m.cursor]
		return m, func() tea.Msg {
			if err := m.tmux.SplitWindow(s.Name, true, ""); err != nil {
				return errMsg{err}
			}
			return statusMsg(fmt.Sprintf("split pane in %s", s.Name))
		}
	}
	return m, nil
}

// View renders the TUI.
func (m Model) View() string {
	if m.quitting {
		return ""
	}

	var b strings.Builder

	// Header
	header := titleStyle.Render("  dmux — terminal workspace manager")
	b.WriteString(header)
	b.WriteString("\n\n")

	// Tabs
	tabs := m.renderTabs()
	b.WriteString(tabs)
	b.WriteString("\n\n")

	// Content
	content := m.renderContent()
	b.WriteString(content)
	b.WriteString("\n")

	// Status / Error
	if m.err != nil {
		b.WriteString(errorStyle.Render("  error: " + m.err.Error()))
		b.WriteString("\n")
	}
	if m.message != "" {
		b.WriteString(helpStyle.Render("  " + m.message))
		b.WriteString("\n")
	}

	// Input mode
	if m.inputMode {
		b.WriteString("\n")
		b.WriteString(fmt.Sprintf("  %s%s█", m.inputPrompt, m.input))
		b.WriteString("\n")
	}

	// Help bar
	b.WriteString("\n")
	b.WriteString(m.renderHelp())

	return b.String()
}

func (m Model) renderTabs() string {
	sessTab := tabInactiveStyle.Render("[1] Sessions")
	wtTab := tabInactiveStyle.Render("[2] Worktrees")
	if m.tab == TabSessions {
		sessTab = tabActiveStyle.Render("[1] Sessions")
	} else {
		wtTab = tabActiveStyle.Render("[2] Worktrees")
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, "  ", sessTab, " ", wtTab)
}

func (m Model) renderContent() string {
	switch m.tab {
	case TabSessions:
		return m.renderSessions()
	case TabWorktrees:
		return m.renderWorktrees()
	}
	return ""
}

func (m Model) renderSessions() string {
	if len(m.sessions) == 0 {
		return helpStyle.Render("  No sessions. Press 'n' to create one.")
	}
	var lines []string
	for i, s := range m.sessions {
		prefix := "  "
		style := listItemStyle
		if i == m.cursor {
			prefix = listSelectedStyle.Render("")
			style = lipgloss.NewStyle().Bold(true).Foreground(colorSecondary)
		}
		line := fmt.Sprintf("%s%s  %d windows  %s",
			prefix,
			style.Render(s.Name),
			s.Windows,
			lipgloss.NewStyle().Foreground(colorMuted).Render(s.Created),
		)
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderWorktrees() string {
	if len(m.worktrees) == 0 {
		return helpStyle.Render("  No git repository detected, or no worktrees.")
	}
	var lines []string
	for i, wt := range m.worktrees {
		prefix := "  "
		style := listItemStyle
		if i == m.cursor {
			prefix = listSelectedStyle.Render("")
			style = lipgloss.NewStyle().Bold(true).Foreground(colorSecondary)
		}
		branch := wt.Branch
		if branch == "" {
			branch = "(detached)"
		}

		status := ""
		if m.wt != nil {
			if s, err := m.wt.GetStatus(wt.Path); err == nil {
				if s == "clean" {
					status = statusCleanStyle.Render(" ✓ clean")
				} else {
					status = statusDirtyStyle.Render(" ● " + s)
				}
			}
		}

		shortPath := wt.Path
		indicator := ""
		if i == 0 {
			indicator = lipgloss.NewStyle().Foreground(colorMuted).Render(" (main)")
		}

		line := fmt.Sprintf("%s%s  %s%s  %s",
			prefix,
			style.Render(branch),
			lipgloss.NewStyle().Foreground(colorMuted).Render(shortPath),
			indicator,
			status,
		)
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func (m Model) renderHelp() string {
	base := "  ↑/↓ navigate • tab switch • enter select • n new • d delete • r refresh • q quit"
	if m.tab == TabSessions {
		base += " • s split"
	}
	return helpStyle.Render(base)
}

func sanitizeSessionName(name string) string {
	r := strings.NewReplacer("/", "-", ".", "-", ":", "-")
	return r.Replace(name)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
