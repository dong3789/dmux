mod platform;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
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
        let ptys = state.ptys.lock().map_err(|e| format!("Lock failed: {}", e))?;
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

    // Check if tmux session already exists
    let session_exists = platform::tmux_command(&["has-session", "-t", &session_name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !session_exists {
        let shell_cwd = cwd.as_deref().map(|p| platform::to_shell_path(p));
        let mut args = vec!["new-session", "-d", "-s", &session_name];
        let cwd_str;
        if let Some(ref dir) = shell_cwd {
            cwd_str = dir.clone();
            args.push("-c");
            args.push(&cwd_str);
        }
        let create_output = platform::tmux_command(&args)
            .output()
            .map_err(|e| format!("Failed to create tmux session: {}", e))?;
        if !create_output.status.success() {
            return Err(format!("tmux new-session failed: {}", String::from_utf8_lossy(&create_output.stderr)));
        }
    }

    // Suppress tmux UI on this session
    let _ = platform::tmux_command(&["set-option", "-t", &session_name, "status", "off"]).output();
    let _ = platform::tmux_command(&["set-option", "-t", &session_name, "prefix", "None"]).output();

    // Attach to the session via PTY
    let (program, base_args) = platform::tmux_pty_program();
    let mut cmd = CommandBuilder::new(&program);
    for arg in &base_args {
        cmd.arg(arg);
    }
    cmd.arg("attach-session");
    cmd.arg("-t");
    cmd.arg(&session_name);
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("TERM", "xterm-256color");
    if !cfg!(target_os = "windows") {
        cmd.env("PATH", std::env::var("PATH")
            .unwrap_or_else(|_| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string()));
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
        let mut ptys = state.ptys.lock().map_err(|e| format!("Lock failed: {}", e))?;
        ptys.insert(
            id.clone(),
            PtyInstance { writer, master: pair.master },
        );
    }

    let event_name = format!("pty-output-{}", id);
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let valid_up_to = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    if valid_up_to > 0 {
                        let data = match String::from_utf8(pending[..valid_up_to].to_vec()) {
                            Ok(s) => s,
                            Err(_) => { pending.drain(..valid_up_to); continue; }
                        };
                        let _ = app.emit(&event_name, data);
                        pending.drain(..valid_up_to);
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(id)
}

#[tauri::command]
fn write_terminal(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().map_err(|e| format!("Lock failed: {}", e))?;
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
    let ptys = state.ptys.lock().map_err(|e| format!("Lock failed: {}", e))?;
    if let Some(pty) = ptys.get(&id) {
        pty.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Resize failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().map_err(|e| format!("Lock failed: {}", e))?;
    ptys.remove(&id);
    drop(ptys);

    // Kill the tmux session
    let _ = platform::tmux_command(&["kill-session", "-t", &id]).output();
    Ok(())
}

fn config_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|path| path.join("dmux"))
        .ok_or_else(|| "Could not find config directory".to_string())
}

#[tauri::command]
fn save_workspaces(data: String) -> Result<(), String> {
    let dir = config_path()?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    fs::write(dir.join("workspaces.json"), data)
        .map_err(|e| format!("Failed to write: {}", e))
}

#[tauri::command]
fn load_workspaces() -> Result<String, String> {
    let path = config_path()?.join("workspaces.json");
    if !path.exists() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(path).map_err(|e| format!("Failed to read: {}", e))
}

#[tauri::command]
fn save_layout(data: String) -> Result<(), String> {
    let dir = config_path()?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    fs::write(dir.join("layout.json"), data).map_err(|e| format!("Failed to write layout: {}", e))
}

#[tauri::command]
fn load_layout() -> Result<String, String> {
    let path = config_path()?.join("layout.json");
    if !path.exists() {
        return Ok("null".to_string());
    }
    fs::read_to_string(path).map_err(|e| format!("Failed: {}", e))
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    platform::home_dir()
        .ok_or_else(|| "Could not find home directory".to_string())
}

#[tauri::command]
fn validate_repo_path(path: String) -> Result<String, String> {
    let output = platform::git_command(&["rev-parse", "--show-toplevel"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err("Not a valid git repository".to_string());
    }
    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // On Windows, convert WSL path back to native
    Ok(if cfg!(target_os = "windows") { platform::from_shell_path(&result) } else { result })
}

#[tauri::command]
fn list_sessions() -> Result<Vec<TmuxSession>, String> {
    let output = platform::tmux_command(&[
        "list-sessions", "-F",
        "#{session_name}\t#{session_windows}\t#{session_created_string}\t#{session_attached}"
    ]).output().map_err(|e| format!("Failed to run tmux: {}", e))?;

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
    let shell_path = path.as_deref().map(|p| platform::to_shell_path(p));
    let mut args = vec!["new-session", "-d", "-s", &name];
    let cwd_str;
    if let Some(ref p) = shell_path {
        cwd_str = p.clone();
        args.push("-c");
        args.push(&cwd_str);
    }
    let output = platform::tmux_command(&args)
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
fn kill_session(name: String) -> Result<(), String> {
    let output = platform::tmux_command(&["kill-session", "-t", &name])
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>, String> {
    let mut cmd = platform::git_command(&["worktree", "list", "--porcelain"]);
    cmd.current_dir(&repo_path);
    let output = cmd.output().map_err(|e| format!("Failed to run git: {}", e))?;

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
            let raw_path = line.strip_prefix("worktree ").unwrap_or("").to_string();
            current = Worktree {
                path: if cfg!(target_os = "windows") { platform::from_shell_path(&raw_path) } else { raw_path },
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
    let mut cmd = platform::git_command(&["status", "--short"]);
    cmd.current_dir(path);
    let output = cmd.output().map_err(|e| format!("Failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().filter(|l| !l.is_empty()).count() as u32)
}

fn worktree_meta_path() -> Result<PathBuf, String> {
    Ok(config_path()?.join("worktree-meta.json"))
}

fn load_worktree_meta_map() -> HashMap<String, serde_json::Value> {
    let path = match worktree_meta_path() {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    if !path.exists() { return HashMap::new(); }
    let data = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_worktree_meta_map(map: &HashMap<String, serde_json::Value>) {
    if let Ok(dir) = config_path() {
        let _ = fs::create_dir_all(&dir);
        if let Ok(path) = worktree_meta_path() {
            let _ = fs::write(path, serde_json::to_string(map).unwrap_or_default());
        }
    }
}

#[tauri::command]
fn get_worktree_meta(wt_path: String) -> Result<String, String> {
    let map = load_worktree_meta_map();
    if let Some(v) = map.get(&wt_path) {
        return Ok(v.to_string());
    }

    // No saved metadata — infer base branch via git merge-base
    // Compare this branch against common base branches (main, master, develop)
    let candidates = ["main", "master", "develop"];
    let mut cmd = platform::git_command(&["rev-parse", "--abbrev-ref", "HEAD"]);
    cmd.current_dir(&wt_path);
    let head_output = cmd.output().ok();
    let current_branch = head_output
        .as_ref()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    if current_branch.is_empty() {
        return Ok("null".to_string());
    }

    // Don't infer for main/master themselves
    if candidates.contains(&current_branch.as_str()) {
        return Ok("null".to_string());
    }

    let mut best_base: Option<(String, usize)> = None;
    for candidate in &candidates {
        // Check if candidate branch exists
        let mut check = platform::git_command(&["rev-parse", "--verify", candidate]);
        check.current_dir(&wt_path);
        if !check.output().map(|o| o.status.success()).unwrap_or(false) {
            continue;
        }

        // Count commits since merge-base (fewer = closer parent)
        let mut mb_cmd = platform::git_command(&["rev-list", "--count", &format!("{}..HEAD", candidate)]);
        mb_cmd.current_dir(&wt_path);
        if let Ok(output) = mb_cmd.output() {
            if output.status.success() {
                let count: usize = String::from_utf8_lossy(&output.stdout).trim().parse().unwrap_or(usize::MAX);
                if best_base.as_ref().map_or(true, |(_, c)| count < *c) {
                    best_base = Some((candidate.to_string(), count));
                }
            }
        }
    }

    match best_base {
        Some((base, _)) => Ok(serde_json::json!({
            "baseBranch": base,
            "branch": current_branch,
            "inferred": true,
        }).to_string()),
        None => Ok("null".to_string()),
    }
}

#[tauri::command]
fn rebase_worktree(wt_path: String, new_base: String) -> Result<(), String> {
    // Get current base via merge-base
    let mut head_cmd = platform::git_command(&["rev-parse", "--abbrev-ref", "HEAD"]);
    head_cmd.current_dir(&wt_path);
    let head_out = head_cmd.output().map_err(|e| format!("Failed: {}", e))?;
    let current_branch = String::from_utf8_lossy(&head_out.stdout).trim().to_string();

    // Find old merge-base
    let mut mb_cmd = platform::git_command(&["merge-base", &new_base, "HEAD"]);
    mb_cmd.current_dir(&wt_path);
    let _mb_out = mb_cmd.output().map_err(|e| format!("Failed: {}", e))?;

    // Rebase onto new base
    let mut rebase_cmd = platform::git_command(&["rebase", "--onto", &new_base, &format!("{}@{{upstream}}", current_branch)]);
    rebase_cmd.current_dir(&wt_path);
    let rebase_out = rebase_cmd.output();

    // If upstream rebase fails, try simple rebase
    if rebase_out.is_err() || !rebase_out.as_ref().unwrap().status.success() {
        let mut simple_cmd = platform::git_command(&["rebase", &new_base]);
        simple_cmd.current_dir(&wt_path);
        let simple_out = simple_cmd.output().map_err(|e| format!("Failed: {}", e))?;
        if !simple_out.status.success() {
            // Abort failed rebase
            let mut abort = platform::git_command(&["rebase", "--abort"]);
            abort.current_dir(&wt_path);
            let _ = abort.output();
            return Err(format!("Rebase failed: {}", String::from_utf8_lossy(&simple_out.stderr)));
        }
    }

    // Update metadata
    let mut map = load_worktree_meta_map();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    map.insert(wt_path.clone(), serde_json::json!({
        "baseBranch": new_base,
        "branch": current_branch,
        "createdAt": timestamp,
    }));
    save_worktree_meta_map(&map);

    Ok(())
}

#[tauri::command]
fn update_worktree_meta(wt_path: String, base_branch: String) -> Result<(), String> {
    // Update metadata only (no rebase)
    let mut head_cmd = platform::git_command(&["rev-parse", "--abbrev-ref", "HEAD"]);
    head_cmd.current_dir(&wt_path);
    let head_out = head_cmd.output().map_err(|e| format!("Failed: {}", e))?;
    let current_branch = String::from_utf8_lossy(&head_out.stdout).trim().to_string();

    let mut map = load_worktree_meta_map();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    map.insert(wt_path, serde_json::json!({
        "baseBranch": base_branch,
        "branch": current_branch,
        "createdAt": timestamp,
    }));
    save_worktree_meta_map(&map);
    Ok(())
}

#[tauri::command]
fn add_worktree(repo_path: String, name: String, branch: String, base_branch: Option<String>) -> Result<String, String> {
    let repo = PathBuf::from(&repo_path);
    let wt_path = repo.parent()
        .ok_or_else(|| "Cannot determine parent directory of repo".to_string())?
        .join(&name);
    let wt_path_str = platform::to_shell_path(&wt_path.to_string_lossy());
    let effective_base = base_branch.clone().unwrap_or_else(|| "HEAD".to_string());

    let mut args = vec!["worktree", "add", "-b", &branch, &wt_path_str];
    let base_ref;
    if let Some(ref base) = base_branch {
        base_ref = base.clone();
        args.push(&base_ref);
    }

    let mut cmd = platform::git_command(&args);
    cmd.current_dir(&repo_path);
    let output = cmd.output().map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let canonical = wt_path.canonicalize().unwrap_or(wt_path);
    let canonical_str = canonical.to_string_lossy().to_string();

    // Save metadata
    let mut map = load_worktree_meta_map();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    map.insert(canonical_str.clone(), serde_json::json!({
        "baseBranch": effective_base,
        "branch": branch,
        "createdAt": timestamp,
    }));
    save_worktree_meta_map(&map);

    Ok(canonical_str)
}

#[tauri::command]
fn remove_worktree(repo_path: String, wt_path: String) -> Result<(), String> {
    let shell_wt = platform::to_shell_path(&wt_path);
    let mut cmd = platform::git_command(&["worktree", "remove", &shell_wt]);
    cmd.current_dir(&repo_path);
    let output = cmd.output().map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let mut map = load_worktree_meta_map();
    map.remove(&wt_path);
    save_worktree_meta_map(&map);
    Ok(())
}

#[tauri::command]
fn get_repo_root() -> Result<String, String> {
    let mut cmd = platform::git_command(&["rev-parse", "--show-toplevel"]);
    let output = cmd.output().map_err(|e| format!("Failed: {}", e))?;
    if !output.status.success() {
        return Err("Not in a git repository".to_string());
    }
    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if cfg!(target_os = "windows") { platform::from_shell_path(&result) } else { result })
}

#[tauri::command]
fn check_dependencies() -> Result<(), String> {
    platform::check_deps()
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
            get_home_dir,
            validate_repo_path,
            save_workspaces,
            load_workspaces,
            save_layout,
            load_layout,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            check_dependencies,
            get_worktree_meta,
            rebase_worktree,
            update_worktree_meta,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
