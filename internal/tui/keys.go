package tui

import "github.com/charmbracelet/bubbles/key"

type keyMap struct {
	Up      key.Binding
	Down    key.Binding
	Enter   key.Binding
	Tab     key.Binding
	New     key.Binding
	Delete  key.Binding
	Split   key.Binding
	Refresh key.Binding
	Quit    key.Binding
}

var keys = keyMap{
	Up:      key.NewBinding(key.WithKeys("up", "k"), key.WithHelp("↑/k", "up")),
	Down:    key.NewBinding(key.WithKeys("down", "j"), key.WithHelp("↓/j", "down")),
	Enter:   key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "select")),
	Tab:     key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "switch tab")),
	New:     key.NewBinding(key.WithKeys("n"), key.WithHelp("n", "new")),
	Delete:  key.NewBinding(key.WithKeys("d"), key.WithHelp("d", "delete")),
	Split:   key.NewBinding(key.WithKeys("s"), key.WithHelp("s", "split")),
	Refresh: key.NewBinding(key.WithKeys("r"), key.WithHelp("r", "refresh")),
	Quit:    key.NewBinding(key.WithKeys("q", "ctrl+c"), key.WithHelp("q", "quit")),
}
