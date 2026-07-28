use std::process::Command;

fn output(cmd: &mut Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        // some gh subcommands (e.g. `auth status`) print to stderr
        if stdout.is_empty() {
            Ok(String::from_utf8_lossy(&out.stderr).into_owned())
        } else {
            Ok(stdout)
        }
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

// ponytail: generic passthroughs instead of a command per operation.
// Frontend is our own code; args are not user-typed shell input.
#[tauri::command]
fn git(path: String, args: Vec<String>) -> Result<String, String> {
    output(Command::new("git").arg("-C").arg(&path).args(&args))
}

#[tauri::command]
fn gh(path: String, args: Vec<String>) -> Result<String, String> {
    output(Command::new("gh").current_dir(&path).args(&args))
}

// find every directory containing .git, up to 3 levels below `path`
#[tauri::command]
fn scan_repos(path: String) -> Vec<String> {
    fn walk(dir: &std::path::Path, depth: u32, out: &mut Vec<String>) {
        if dir.join(".git").exists() {
            out.push(dir.to_string_lossy().into_owned());
            return;
        }
        if depth == 0 {
            return;
        }
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if e.path().is_dir() && !name.starts_with('.') && name != "node_modules" {
                    walk(&e.path(), depth - 1, out);
                }
            }
        }
    }
    let mut out = vec![];
    walk(std::path::Path::new(&path), 3, &mut out);
    out.sort();
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![git, gh, scan_repos])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
