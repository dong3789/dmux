use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmuxSession {
    pub name: String,
    pub windows: u32,
    pub created: String,
    pub attached: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_bare: bool,
    pub is_main: bool,
    pub status: String,
    pub changed_files: u32,
}

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

struct AppState {
    ptys: Mutex<HashMap<String, PtyInstance>>,
}

#[tauri::command]
fn spawn_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    session_name: String,
    cwd: Option<String>,
) -> Result<String, String> {
    // Check if already spawned
    {
        let ptys = state.ptys.lock().unwrap();
        if ptys.contains_key(&session_name) {
            return Ok(session_name);
        }
    }

    let pty_system = NativePtySystem::default();
    let pty_size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Always spawn a login shell (tmux doesn't work well inside embedded PTY)
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("TERM", "xterm-256color");
    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get reader: {}", e))?;

    let id = session_name.clone();

    {
        let mut ptys = state.ptys.lock().unwrap();
        ptys.insert(
            id.clone(),
            PtyInstance { writer, master: pair.master },
        );
    }

    let event_name = format!("pty-output-{}", id);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(&event_name, data);
                }
                Err(_) => break,
            }
        }
    });

    Ok(id)
}

#[tauri::command]
fn write_terminal(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(pty) = ptys.get_mut(&id) {
        pty.writer.write_all(data.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
        pty.writer.flush().map_err(|e| format!("Flush failed: {}", e))?;
    } else {
        return Err("Terminal not found".to_string());
    }
    Ok(())
}

#[tauri::command]
fn resize_terminal(state: State<'_, AppState>, id: String, rows: u16, cols: u16) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(pty) = ptys.get(&id) {
        pty.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Resize failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    ptys.remove(&id);
    Ok(())
}

#[tauri::command]
fn validate_repo_path(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err("Not a valid git repository".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn list_sessions() -> Result<Vec<TmuxSession>, String> {
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_created_string}\t#{session_attached}"])
        .output()
        .map_err(|e| format!("Failed to run tmux: {}", e))?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let sessions = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            TmuxSession {
                name: parts.first().unwrap_or(&"").to_string(),
                windows: parts.get(1).unwrap_or(&"0").parse().unwrap_or(0),
                created: parts.get(2).unwrap_or(&"").to_string(),
                attached: parts.get(3).unwrap_or(&"0") == &"1",
            }
        })
        .collect();

    Ok(sessions)
}

#[tauri::command]
fn create_session(name: String, path: Option<String>) -> Result<(), String> {
    let mut cmd = Command::new("tmux");
    cmd.args(["new-session", "-d", "-s", &name]);
    if let Some(p) = path {
        cmd.args(["-c", &p]);
    }
    let output = cmd.output().map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
fn kill_session(name: String) -> Result<(), String> {
    let output = Command::new("tmux")
        .args(["kill-session", "-t", &name])
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current = Worktree {
        path: String::new(), branch: String::new(), head: String::new(),
        is_bare: false, is_main: false, status: "clean".to_string(), changed_files: 0,
    };
    let mut is_first = true;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            if !current.path.is_empty() {
                current.is_main = is_first;
                is_first = false;
                if let Ok(status) = get_worktree_status(&current.path) {
                    current.changed_files = status;
                    current.status = if status == 0 { "clean".to_string() } else { format!("{} changed", status) };
                }
                worktrees.push(current.clone());
            }
            current = Worktree {
                path: line.strip_prefix("worktree ").unwrap_or("").to_string(),
                branch: String::new(), head: String::new(),
                is_bare: false, is_main: false, status: "clean".to_string(), changed_files: 0,
            };
        } else if line.starts_with("HEAD ") {
            current.head = line.strip_prefix("HEAD ").unwrap_or("").to_string();
        } else if line.starts_with("branch ") {
            let branch = line.strip_prefix("branch refs/heads/").unwrap_or(
                line.strip_prefix("branch ").unwrap_or(""),
            );
            current.branch = branch.to_string();
        } else if line == "bare" {
            current.is_bare = true;
        }
    }

    if !current.path.is_empty() {
        current.is_main = is_first;
        if let Ok(status) = get_worktree_status(&current.path) {
            current.changed_files = status;
            current.status = if status == 0 { "clean".to_string() } else { format!("{} changed", status) };
        }
        worktrees.push(current);
    }

    Ok(worktrees)
}

fn get_worktree_status(path: &str) -> Result<u32, String> {
    let output = Command::new("git")
        .args(["status", "--short"])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().filter(|l| !l.is_empty()).count() as u32)
}

#[tauri::command]
fn add_worktree(repo_path: String, name: String, branch: String) -> Result<String, String> {
    let wt_path = format!("{}/../{}", repo_path, name);
    let output = Command::new("git")
        .args(["worktree", "add", "-b", &branch, &wt_path])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(wt_path)
}

#[tauri::command]
fn remove_worktree(repo_path: String, wt_path: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(["worktree", "remove", &wt_path])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
fn get_repo_root() -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err("Not in a git repository".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            create_session,
            kill_session,
            list_worktrees,
            add_worktree,
            remove_worktree,
            get_repo_root,
            validate_repo_path,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
