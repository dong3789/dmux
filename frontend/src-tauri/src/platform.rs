use std::path::PathBuf;
use std::process::Command;

/// Convert a native OS path to a path usable inside the shell environment.
/// On Windows, converts `C:\Users\foo` → `/mnt/c/Users/foo` for WSL.
/// On macOS/Linux, returns as-is.
pub fn to_shell_path(path: &str) -> String {
    if cfg!(target_os = "windows") {
        // C:\Users\foo → /mnt/c/Users/foo
        let path = path.replace('\\', "/");
        if path.len() >= 2 && path.as_bytes()[1] == b':' {
            let drive = (path.as_bytes()[0] as char).to_ascii_lowercase();
            format!("/mnt/{}{}", drive, &path[2..])
        } else {
            path
        }
    } else {
        path.to_string()
    }
}

/// Convert a WSL path back to a native Windows path.
/// `/mnt/c/Users/foo` → `C:\Users\foo`
/// On macOS/Linux, returns as-is.
pub fn from_shell_path(path: &str) -> String {
    if cfg!(target_os = "windows") {
        if path.starts_with("/mnt/") && path.len() >= 6 {
            let drive = path.as_bytes()[5] as char;
            format!("{}:{}", drive.to_ascii_uppercase(), path[6..].replace('/', "\\"))
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    }
}

/// Build a Command that runs tmux with the given args.
/// On Windows: `wsl tmux <args...>`
/// On macOS/Linux: `tmux <args...>`
pub fn tmux_command(args: &[&str]) -> Command {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("wsl");
        cmd.arg("tmux");
        cmd.args(args);
        cmd
    } else {
        let path = which::which("tmux")
            .unwrap_or_else(|_| PathBuf::from("/opt/homebrew/bin/tmux"));
        let mut cmd = Command::new(path);
        cmd.args(args);
        cmd
    }
}

/// Build a Command that runs git with the given args.
/// On Windows: `wsl git <args...>` (uses WSL git for consistency with WSL paths)
/// On macOS/Linux: `git <args...>`
pub fn git_command(args: &[&str]) -> Command {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("wsl");
        cmd.arg("git");
        cmd.args(args);
        cmd
    } else {
        let mut cmd = Command::new("git");
        cmd.args(args);
        cmd
    }
}

/// Build a Command for tmux to be used with portable-pty CommandBuilder.
/// Returns (program, base_args) — on Windows: ("wsl", ["tmux"]), on macOS: ("/path/to/tmux", [])
pub fn tmux_pty_program() -> (PathBuf, Vec<String>) {
    if cfg!(target_os = "windows") {
        (PathBuf::from("wsl"), vec!["tmux".to_string()])
    } else {
        let path = which::which("tmux")
            .unwrap_or_else(|_| PathBuf::from("/opt/homebrew/bin/tmux"));
        (path, vec![])
    }
}

/// Get the user's home directory.
/// On Windows, returns the WSL home for shell operations.
pub fn home_dir() -> Option<String> {
    if cfg!(target_os = "windows") {
        // Get WSL home directory
        let output = Command::new("wsl")
            .args(["echo", "$HOME"])
            .output()
            .ok()?;
        let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if home.is_empty() { None } else { Some(home) }
    } else {
        dirs::home_dir().map(|p| p.to_string_lossy().to_string())
    }
}

/// Check if required dependencies are available.
pub fn check_deps() -> Result<(), String> {
    if cfg!(target_os = "windows") {
        // Check WSL is available
        let wsl_check = Command::new("wsl")
            .args(["--status"])
            .output()
            .map_err(|_| "WSL is not installed. Please install WSL first:\n  wsl --install".to_string())?;
        if !wsl_check.status.success() {
            return Err("WSL is not properly configured. Run: wsl --install".to_string());
        }
        // Check tmux inside WSL
        let tmux_check = Command::new("wsl")
            .args(["which", "tmux"])
            .output()
            .map_err(|e| format!("Failed to check tmux in WSL: {}", e))?;
        if !tmux_check.status.success() {
            return Err("tmux is not installed in WSL. Run:\n  wsl sudo apt install tmux".to_string());
        }
        // Check git inside WSL
        let git_check = Command::new("wsl")
            .args(["which", "git"])
            .output()
            .map_err(|e| format!("Failed to check git in WSL: {}", e))?;
        if !git_check.status.success() {
            return Err("git is not installed in WSL. Run:\n  wsl sudo apt install git".to_string());
        }
    } else {
        if which::which("tmux").is_err() {
            return Err("tmux is not installed. Please install tmux first:\n  brew install tmux (macOS)\n  apt install tmux (Ubuntu/Debian)".to_string());
        }
        if which::which("git").is_err() {
            return Err("git is not installed. Please install git first.".to_string());
        }
    }
    Ok(())
}
