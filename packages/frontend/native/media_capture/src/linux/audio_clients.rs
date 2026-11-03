//! Which processes are talking to the sound server right now.
//!
//! Parsed from `pactl list sink-inputs` / `source-outputs`, which works on
//! PulseAudio and on PipeWire's Pulse layer. Without `pactl`, detection is
//! simply empty; recording through the global tap still works.

use std::{
  collections::BTreeMap,
  io::Read,
  process::{Command, Stdio},
  sync::{LazyLock, Mutex},
  time::{Duration, Instant},
};

/// Names Nota gives its own capture streams; never report them as apps.
const OWN_STREAM_NAMES: [&str; 2] = ["Nota", "Nota meeting system audio"];
const CACHE_TTL: Duration = Duration::from_millis(2000);
const PACTL_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AudioClient {
  pub name: String,
  pub playing: bool,
  pub recording: bool,
}

/// pid -> client. Sorted so list comparisons are stable.
pub type AudioClients = BTreeMap<u32, AudioClient>;

static CACHE: LazyLock<Mutex<Option<(Instant, AudioClients)>>> = LazyLock::new(|| Mutex::new(None));

/// `pactl list <kind>`, or empty if it fails or the sound server stalls.
fn pactl_list(kind: &str) -> String {
  let Ok(mut child) = Command::new("pactl")
    .args(["list", kind])
    .env("LC_ALL", "C")
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()
  else {
    return String::new();
  };
  // Read on a thread so a large listing cannot fill the pipe while we wait.
  let stdout = child.stdout.take();
  let reader = std::thread::spawn(move || {
    let mut text = String::new();
    if let Some(mut stdout) = stdout {
      let _ = stdout.read_to_string(&mut text);
    }
    text
  });
  let started = Instant::now();
  let success = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status.success(),
      Ok(None) if started.elapsed() < PACTL_TIMEOUT => std::thread::sleep(Duration::from_millis(10)),
      _ => {
        let _ = child.kill();
        let _ = child.wait();
        break false;
      }
    }
  };
  let text = reader.join().unwrap_or_default();
  if success { text } else { String::new() }
}

fn property(line: &str, key: &str) -> Option<String> {
  let rest = line.trim().strip_prefix(key)?.trim_start();
  let value = rest.strip_prefix('=')?.trim();
  Some(value.trim_matches('"').to_string())
}

/// Parse `pactl list` output into (pid, name) pairs, one per stream.
pub(crate) fn parse_streams(text: &str, header: &str) -> Vec<(u32, String)> {
  let mut streams = Vec::new();
  let mut current: Option<(Option<u32>, Option<String>, Option<String>)> = None;
  let mut flush = |entry: Option<(Option<u32>, Option<String>, Option<String>)>| {
    if let Some((Some(pid), name, binary)) = entry {
      let name = name.or(binary).unwrap_or_else(|| format!("Process {pid}"));
      if !OWN_STREAM_NAMES.contains(&name.as_str()) {
        streams.push((pid, name));
      }
    }
  };
  for line in text.lines() {
    if line.starts_with(header) {
      flush(current.take());
      current = Some((None, None, None));
      continue;
    }
    let Some(entry) = current.as_mut() else { continue };
    if let Some(pid) = property(line, "application.process.id") {
      entry.0 = pid.parse().ok();
    } else if let Some(name) = property(line, "application.name") {
      entry.1 = Some(name);
    } else if let Some(binary) = property(line, "application.process.binary") {
      entry.2 = Some(binary);
    }
  }
  flush(current.take());
  streams
}

fn query() -> AudioClients {
  let mut clients = AudioClients::new();
  for (pid, name) in parse_streams(&pactl_list("sink-inputs"), "Sink Input #") {
    let client = clients.entry(pid).or_insert_with(|| AudioClient {
      name,
      ..Default::default()
    });
    client.playing = true;
  }
  for (pid, name) in parse_streams(&pactl_list("source-outputs"), "Source Output #") {
    let client = clients.entry(pid).or_insert_with(|| AudioClient {
      name,
      ..Default::default()
    });
    client.recording = true;
  }
  clients
}

/// Current audio clients, cached briefly so per-app checks share one query.
pub fn audio_clients() -> AudioClients {
  if let Some((at, clients)) = CACHE.lock().unwrap_or_else(|poison| poison.into_inner()).as_ref()
    && at.elapsed() < CACHE_TTL
  {
    return clients.clone();
  }
  // Query without the lock: the Electron main thread calls this too and must
  // not wait behind a watcher thread's pactl run.
  let clients = query();
  *CACHE.lock().unwrap_or_else(|poison| poison.into_inner()) = Some((Instant::now(), clients.clone()));
  clients
}

#[cfg(test)]
mod tests {
  use super::*;

  const SAMPLE: &str = r#"Source Output #12
	Driver: PipeWire
	Properties:
		application.name = "Firefox"
		application.process.id = "4242"
		application.process.binary = "firefox"
Source Output #13
	Properties:
		application.process.id = "77"
		application.process.binary = "zoom"
Source Output #14
	Properties:
		application.name = "Nota"
		application.process.id = "900"
Source Output #15
	Properties:
		media.name = "no pid here"
"#;

  #[test]
  fn parses_streams_and_skips_own_and_pidless() {
    assert_eq!(
      parse_streams(SAMPLE, "Source Output #"),
      vec![(4242, "Firefox".to_string()), (77, "zoom".to_string())]
    );
  }

  #[test]
  fn empty_output_has_no_streams() {
    assert!(parse_streams("", "Sink Input #").is_empty());
  }
}
