//! `ShareableContent` for Linux, matching the Windows and macOS API.
//!
//! Applications are processes with a stream on the sound server, the Linux
//! equivalent of the macOS audio process list. System audio is captured
//! globally; per-app taps fall back to the global monitor like Windows.

use std::{
  fs,
  sync::{
    Arc, LazyLock, RwLock,
    atomic::{AtomicBool, AtomicU32, Ordering},
  },
  thread,
  time::Duration,
};

use napi::{
  bindgen_prelude::{Buffer, Float32Array, Result},
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

use super::{
  audio_capture::{AudioCaptureSession, start_recording},
  audio_clients::audio_clients,
};

static NEXT_HANDLE: AtomicU32 = AtomicU32::new(1);
type Watcher = (u32, Arc<AtomicBool>);
static WATCHERS: LazyLock<RwLock<Vec<Watcher>>> = LazyLock::new(|| RwLock::new(Vec::new()));

const APP_POLL: Duration = Duration::from_millis(1000);
const LIST_POLL: Duration = Duration::from_millis(2000);

#[napi]
#[derive(Clone)]
pub struct ApplicationInfo {
  pub process_id: i32,
  pub name: String,
  pub object_id: u32,
}

#[napi]
impl ApplicationInfo {
  #[napi(constructor)]
  pub fn new(process_id: i32, name: String, object_id: u32) -> Self {
    Self {
      process_id,
      name,
      object_id,
    }
  }

  #[napi(getter)]
  pub fn process_group_id(&self) -> i32 {
    process_group_id(self.process_id as u32).unwrap_or(self.process_id)
  }

  #[napi(getter)]
  pub fn bundle_identifier(&self) -> String {
    // The executable path is the stable identity of an app on Linux.
    fs::read_link(format!("/proc/{}/exe", self.process_id))
      .map(|path| path.to_string_lossy().into_owned())
      .unwrap_or_else(|_| self.name.clone())
  }

  #[napi(getter)]
  pub fn icon(&self) -> Buffer {
    Buffer::from(Vec::<u8>::new())
  }
}

/// Field 5 of /proc/<pid>/stat. The command name in field 2 may contain spaces
/// and parentheses, so parse from the last ')'.
fn process_group_id(pid: u32) -> Option<i32> {
  let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
  let after_name = &stat[stat.rfind(')')? + 1..];
  after_name.split_whitespace().nth(2)?.parse().ok()
}

fn is_process_running(pid: u32) -> bool {
  fs::metadata(format!("/proc/{pid}")).is_ok()
}

fn stop_watcher(handle: u32) {
  if let Ok(mut watchers) = WATCHERS.write() {
    watchers.retain(|(id, stop)| {
      if *id == handle {
        stop.store(true, Ordering::Relaxed);
        false
      } else {
        true
      }
    });
  }
}

/// Poll `state` on a background thread and call back when it changes.
fn watch<T: PartialEq + Send + 'static>(
  interval: Duration,
  callback: ThreadsafeFunction<(), ()>,
  state: impl Fn() -> T + Send + 'static,
) -> u32 {
  let handle = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed);
  let stop = Arc::new(AtomicBool::new(false));
  if let Ok(mut watchers) = WATCHERS.write() {
    watchers.push((handle, stop.clone()));
  }
  thread::spawn(move || {
    let mut last = state();
    while !stop.load(Ordering::Relaxed) {
      thread::sleep(interval);
      let current = state();
      if current != last {
        let _ = callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
        last = current;
      }
    }
  });
  handle
}

#[napi]
pub struct ApplicationListChangedSubscriber {
  handle: u32,
}

#[napi]
impl ApplicationListChangedSubscriber {
  #[napi]
  pub fn unsubscribe(&self) {
    stop_watcher(self.handle);
  }
}

#[napi]
pub struct ApplicationStateChangedSubscriber {
  handle: u32,
}

#[napi]
impl ApplicationStateChangedSubscriber {
  #[napi]
  pub fn unsubscribe(&self) {
    stop_watcher(self.handle);
  }
}

#[napi]
#[derive(Default)]
pub struct ShareableContent {}

#[napi]
impl ShareableContent {
  #[napi]
  pub fn on_application_list_changed(callback: ThreadsafeFunction<(), ()>) -> Result<ApplicationListChangedSubscriber> {
    let handle = watch(LIST_POLL, callback, || audio_clients().into_keys().collect::<Vec<_>>());
    Ok(ApplicationListChangedSubscriber { handle })
  }

  #[napi]
  pub fn on_app_state_changed(
    app: &ApplicationInfo,
    callback: ThreadsafeFunction<(), ()>,
  ) -> Result<ApplicationStateChangedSubscriber> {
    let pid = app.process_id as u32;
    let handle = watch(APP_POLL, callback, move || audio_clients().get(&pid).cloned());
    Ok(ApplicationStateChangedSubscriber { handle })
  }

  #[napi(constructor)]
  pub fn new() -> Self {
    Self {}
  }

  #[napi]
  pub fn applications() -> Result<Vec<ApplicationInfo>> {
    Ok(
      audio_clients()
        .into_iter()
        .filter(|(pid, _)| is_process_running(*pid))
        .map(|(pid, client)| ApplicationInfo::new(pid as i32, client.name, pid))
        .collect(),
    )
  }

  #[napi]
  pub fn application_with_process_id(process_id: u32) -> Option<ApplicationInfo> {
    if !is_process_running(process_id) {
      return None;
    }
    let name = audio_clients()
      .get(&process_id)
      .map(|client| client.name.clone())
      .or_else(|| {
        fs::read_to_string(format!("/proc/{process_id}/comm"))
          .ok()
          .map(|comm| comm.trim().to_string())
      })
      .unwrap_or_else(|| format!("Process {process_id}"));
    Some(ApplicationInfo::new(process_id as i32, name, process_id))
  }

  #[napi]
  pub fn tap_audio(
    _process_id: u32,
    audio_stream_callback: ThreadsafeFunction<Float32Array, ()>,
  ) -> Result<AudioCaptureSession> {
    // Per-app capture needs a PipeWire graph link; like Windows, record the
    // whole output so the meeting app's audio is always included.
    start_recording(audio_stream_callback)
  }

  #[napi]
  pub fn tap_global_audio(
    _excluded_processes: Option<Vec<&ApplicationInfo>>,
    audio_stream_callback: ThreadsafeFunction<Float32Array, ()>,
  ) -> Result<AudioCaptureSession> {
    start_recording(audio_stream_callback)
  }

  #[napi]
  pub fn is_using_microphone(process_id: u32) -> Result<bool> {
    Ok(audio_clients().get(&process_id).is_some_and(|client| client.recording))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_own_process_group() {
    let pid = std::process::id();
    assert!(process_group_id(pid).is_some_and(|pgid| pgid > 0));
    assert!(is_process_running(pid));
  }
}
