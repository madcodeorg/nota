//! System audio capture on Linux.
//!
//! Reads the default output's monitor through `parec` (PulseAudio and
//! PipeWire's Pulse layer) or `pw-record` (plain PipeWire). Both ship with
//! every mainstream desktop, so Nota does not link an audio library and the
//! storage addon keeps loading on systems without one.

use std::{
  io::Read,
  process::{Child, Command, Stdio},
  sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
  },
  thread::JoinHandle,
  time::{Duration, Instant},
};

use napi::{
  Error, Status,
  bindgen_prelude::{Float32Array, Result},
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

pub const SAMPLE_RATE: u32 = 48_000;
const FRAME_SIZE: usize = 1024; // mono samples per callback, matches Windows
const STARTUP_CHECK: Duration = Duration::from_millis(250);

/// Candidate recorders, in order. Each writes raw mono f32le at 48 kHz.
fn recorder_commands() -> Vec<(&'static str, Vec<String>)> {
  let rate = SAMPLE_RATE.to_string();
  vec![
    (
      "parec",
      vec![
        "--device=@DEFAULT_MONITOR@".into(),
        "--format=float32le".into(),
        format!("--rate={rate}"),
        "--channels=1".into(),
        "--latency-msec=20".into(),
        "--client-name=Nota".into(),
        "--stream-name=Nota meeting system audio".into(),
      ],
    ),
    (
      "pw-record",
      vec![
        "--format".into(),
        "f32".into(),
        "--rate".into(),
        rate,
        "--channels".into(),
        "1".into(),
        "-P".into(),
        "{ stream.capture.sink=true application.name=Nota node.name=\"Nota meeting system audio\" }".into(),
        "--raw".into(),
        "-".into(),
      ],
    ),
  ]
}

fn spawn_recorder() -> Result<(Child, &'static str)> {
  let mut failures = Vec::new();
  for (program, args) in recorder_commands() {
    let child = Command::new(program)
      .args(&args)
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn();
    let mut child = match child {
      Ok(child) => child,
      Err(error) => {
        failures.push(format!("{program}: {error}"));
        continue;
      }
    };
    // A recorder that cannot reach the sound server exits at once.
    let started = Instant::now();
    let mut exited = None;
    while started.elapsed() < STARTUP_CHECK {
      if let Ok(Some(status)) = child.try_wait() {
        exited = Some(status);
        break;
      }
      std::thread::sleep(Duration::from_millis(25));
    }
    match exited {
      None => return Ok((child, program)),
      Some(status) => {
        let mut stderr = String::new();
        if let Some(mut pipe) = child.stderr.take() {
          let _ = pipe.read_to_string(&mut stderr);
        }
        let reason = stderr.lines().find(|line| !line.trim().is_empty()).unwrap_or("").trim();
        failures.push(format!("{program} exited with {status}: {reason}"));
      }
    }
  }
  Err(Error::new(
    Status::GenericFailure,
    format!(
      "Could not capture system audio. Install pulseaudio-utils (parec) or pipewire-utils (pw-record) and make sure \
       PipeWire or PulseAudio is running. Details: {}",
      failures.join("; ")
    ),
  ))
}

#[napi]
pub struct AudioCaptureSession {
  child: Option<Child>,
  stopped: Arc<AtomicBool>,
  reader: Option<JoinHandle<()>>,
}

#[napi]
impl AudioCaptureSession {
  #[napi(getter)]
  pub fn get_sample_rate(&self) -> f64 {
    SAMPLE_RATE as f64
  }

  #[napi(getter)]
  pub fn get_channels(&self) -> u32 {
    1
  }

  #[napi(getter)]
  pub fn get_actual_sample_rate(&self) -> f64 {
    SAMPLE_RATE as f64
  }

  #[napi]
  pub fn stop(&mut self) -> Result<()> {
    if self.stopped.swap(true, Ordering::SeqCst) {
      return Ok(());
    }
    if let Some(mut child) = self.child.take() {
      let _ = child.kill();
      let _ = child.wait();
    }
    if let Some(reader) = self.reader.take() {
      let _ = reader.join();
    }
    Ok(())
  }
}

impl Drop for AudioCaptureSession {
  fn drop(&mut self) {
    let _ = self.stop();
  }
}

/// Turn a raw f32le byte stream into fixed-size mono frames.
pub(crate) struct FrameAssembler {
  pending_bytes: Vec<u8>,
  samples: Vec<f32>,
}

impl FrameAssembler {
  pub(crate) fn new() -> Self {
    Self {
      pending_bytes: Vec::with_capacity(4),
      samples: Vec::with_capacity(FRAME_SIZE * 2),
    }
  }

  pub(crate) fn push(&mut self, bytes: &[u8], mut emit: impl FnMut(Vec<f32>)) {
    self.pending_bytes.extend_from_slice(bytes);
    let whole = self.pending_bytes.len() / 4 * 4;
    for chunk in self.pending_bytes[..whole].chunks_exact(4) {
      let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
      self.samples.push(if sample.is_finite() {
        sample.clamp(-1.0, 1.0)
      } else {
        0.0
      });
    }
    self.pending_bytes.drain(..whole);
    while self.samples.len() >= FRAME_SIZE {
      emit(self.samples.drain(..FRAME_SIZE).collect());
    }
  }
}

pub fn start_recording(callback: ThreadsafeFunction<Float32Array, ()>) -> Result<AudioCaptureSession> {
  let (mut child, program) = spawn_recorder()?;
  let mut stdout = child
    .stdout
    .take()
    .ok_or_else(|| Error::new(Status::GenericFailure, format!("{program} has no output pipe")))?;
  // Keep draining stderr: closing it would kill the recorder with SIGPIPE on
  // its next warning, and leaving it unread could fill the pipe.
  if let Some(mut stderr) = child.stderr.take() {
    std::thread::spawn(move || {
      let _ = std::io::copy(&mut stderr, &mut std::io::sink());
    });
  }

  let stopped = Arc::new(AtomicBool::new(false));
  let stopped_reader = stopped.clone();
  let reader = std::thread::spawn(move || {
    let mut assembler = FrameAssembler::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
      match stdout.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => assembler.push(&buf[..n], |frame| {
          let _ = callback.call(Ok(frame.into()), ThreadsafeFunctionCallMode::NonBlocking);
        }),
        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
        Err(_) => break,
      }
    }
    if !stopped_reader.load(Ordering::SeqCst) {
      let _ = callback.call(
        Err(Error::new(
          Status::GenericFailure,
          format!("System audio capture stopped unexpectedly ({program} exited)."),
        )),
        ThreadsafeFunctionCallMode::NonBlocking,
      );
    }
  });

  Ok(AudioCaptureSession {
    child: Some(child),
    stopped,
    reader: Some(reader),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn assembles_frames_across_split_samples() {
    let mut assembler = FrameAssembler::new();
    let bytes: Vec<u8> = (0..FRAME_SIZE + 3)
      .flat_map(|i| (i as f32 / 4096.0).to_le_bytes())
      .collect();
    let mut frames = Vec::new();
    // Split in the middle of a sample to exercise the byte carry-over.
    assembler.push(&bytes[..1001], |f| frames.push(f));
    assembler.push(&bytes[1001..], |f| frames.push(f));
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].len(), FRAME_SIZE);
    assert_eq!(frames[0][1], 1.0 / 4096.0);
    assert_eq!(assembler.samples.len(), 3);
  }

  #[test]
  fn clamps_and_zeroes_bad_samples() {
    let mut assembler = FrameAssembler::new();
    let mut bytes = Vec::new();
    for value in [2.0f32, f32::NAN, -3.0] {
      bytes.extend_from_slice(&value.to_le_bytes());
    }
    assembler.push(&bytes, |_| {});
    assert_eq!(assembler.samples, vec![1.0, 0.0, -1.0]);
  }
}
