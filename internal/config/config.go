package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config holds dmux configuration.
type Config struct {
	DefaultShell string            `json:"default_shell"`
	WorktreeBase string            `json:"worktree_base"` // base directory for new worktrees
	Shortcuts    map[string]string `json:"shortcuts"`     // keybinding overrides
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() Config {
	return Config{
		DefaultShell: os.Getenv("SHELL"),
		WorktreeBase: "../",
		Shortcuts:    map[string]string{},
	}
}

// ConfigPath returns the path to the config file.
func ConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "dmux", "config.json")
}

// Load reads config from disk, falling back to defaults.
func Load() Config {
	cfg := DefaultConfig()
	data, err := os.ReadFile(ConfigPath())
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	return cfg
}

// Save writes config to disk.
func Save(cfg Config) error {
	path := ConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
