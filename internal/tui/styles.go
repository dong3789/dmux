package tui

import "github.com/charmbracelet/lipgloss"

var (
	// Colors
	colorPrimary   = lipgloss.Color("#7C3AED") // purple
	colorSecondary = lipgloss.Color("#06B6D4") // cyan
	colorSuccess   = lipgloss.Color("#10B981") // green
	colorWarning   = lipgloss.Color("#F59E0B") // amber
	colorDanger    = lipgloss.Color("#EF4444") // red
	colorMuted     = lipgloss.Color("#6B7280") // gray

	// Styles
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorPrimary).
			PaddingLeft(1)

	tabActiveStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#FFFFFF")).
			Background(colorPrimary).
			Padding(0, 2)

	tabInactiveStyle = lipgloss.NewStyle().
				Foreground(colorMuted).
				Padding(0, 2)

	listItemStyle = lipgloss.NewStyle().
			PaddingLeft(2)

	listSelectedStyle = lipgloss.NewStyle().
				Bold(true).
				Foreground(colorSecondary).
				PaddingLeft(1).
				SetString("▸ ")

	statusCleanStyle = lipgloss.NewStyle().
				Foreground(colorSuccess)

	statusDirtyStyle = lipgloss.NewStyle().
				Foreground(colorWarning)

	helpStyle = lipgloss.NewStyle().
			Foreground(colorMuted).
			PaddingLeft(1)

	errorStyle = lipgloss.NewStyle().
			Foreground(colorDanger).
			Bold(true)
)
