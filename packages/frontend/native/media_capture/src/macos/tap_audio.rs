use std::{
  ffi::c_void,
  ptr,
  sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
  },
  time::Duration,
};

use block2::{Block, RcBlock};
use core_foundation::{
  base::{CFType, ItemRef, TCFType},
  dictionary::CFDictionary,
  string::CFString,
  uuid::CFUUID,
};
use coreaudio::sys::{
  AudioDeviceCreateIOProcIDWithBlock, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart,
  AudioDeviceStop, AudioHardwareCreateAggregateDevice, AudioHardwareDestroyAggregateDevice,
  AudioObjectAddPropertyListenerBlock, AudioObjectGetPropertyData, AudioObjectID, AudioObjectPropertyAddress,
  AudioObjectRemovePropertyListenerBlock, AudioTimeStamp, OSStatus, kAudioAggregateDeviceClockDeviceKey,
  kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceIsStackedKey, kAudioAggregateDeviceMainSubDeviceKey,
  kAudioAggregateDeviceNameKey, kAudioAggregateDeviceSubDeviceListKey, kAudioAggregateDeviceTapAutoStartKey,
  kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioDevicePropertyNominalSampleRate,
  kAudioHardwareBadDeviceError, kAudioHardwareBadObjectError, kAudioHardwareBadStreamError, kAudioHardwareNoError,
  kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyClass,
  kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioSubDeviceUIDKey,
  kAudioSubTapUIDKey,
};
use napi::{
  bindgen_prelude::{Float32Array, Result, Status},
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use objc2::runtime::AnyObject;

use crate::{
  audio_buffer::InputAndOutputAudioBufferList,
  ca_tap_description::CATapDescription,
  cf_types::CFDictionaryBuilder,
  device::get_device_uid,
  error::CoreAudioError,
  queue::create_audio_tap_queue,
  screen_capture_kit::{ApplicationInfo, ShareableContent},
  utils::{cfstring_from_bytes_with_nul, get_global_main_property},
};

unsafe extern "C" {
  fn AudioHardwareCreateProcessTap(inDescription: *mut AnyObject, outTapID: *mut AudioObjectID) -> OSStatus;

  fn AudioHardwareDestroyProcessTap(tapID: AudioObjectID) -> OSStatus;
}

// Audio statistics structure to track audio format information
#[derive(Clone, Copy, Debug)]
pub struct AudioStats {
  pub sample_rate: f64,
  pub channels: u32,
}

const CLEANUP_ATTEMPTS: usize = 3;
const DEVICE_SWITCH_ATTEMPTS: usize = 3;
const DEVICE_SWITCH_RETRY_DELAY: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug)]
enum CleanupAction {
  StopIO(AudioObjectID, AudioDeviceIOProcID),
  DestroyIO(AudioObjectID, AudioDeviceIOProcID),
  DestroyAggregate(AudioObjectID),
  DestroyTap(AudioObjectID),
}

fn cleanup_audio_resource(action: CleanupAction) -> OSStatus {
  unsafe {
    match action {
      CleanupAction::StopIO(device, proc_id) => AudioDeviceStop(device, proc_id),
      CleanupAction::DestroyIO(device, proc_id) => AudioDeviceDestroyIOProcID(device, proc_id),
      CleanupAction::DestroyAggregate(device) => AudioHardwareDestroyAggregateDevice(device),
      CleanupAction::DestroyTap(tap) => AudioHardwareDestroyProcessTap(tap),
    }
  }
}

fn invalid_audio_object(status: OSStatus) -> bool {
  status == kAudioHardwareBadObjectError as OSStatus || status == kAudioHardwareBadDeviceError as OSStatus
}

fn audio_object_is_gone(id: AudioObjectID) -> bool {
  // An IO-proc error alone does not prove the device disappeared. In
  // particular, a stopped/not-ready device still owns resources that need
  // releasing.
  let mut class: u32 = 0;
  let mut size = std::mem::size_of_val(&class) as u32;
  let status = unsafe {
    AudioObjectGetPropertyData(
      id,
      &device_property_address(kAudioObjectPropertyClass),
      0,
      ptr::null(),
      &mut size,
      (&mut class as *mut u32).cast(),
    )
  };
  invalid_audio_object(status)
}

// Acquire each handle before the next fallible call. This owner moves from
// construction into the stream; neither the manager nor stream copies handles.
struct TapResources {
  tap_id: Option<AudioObjectID>,
  aggregate_id: Option<AudioObjectID>,
  io_procs: Vec<(AudioObjectID, AudioDeviceIOProcID, bool)>,
  cleanup: fn(CleanupAction) -> OSStatus,
  is_gone: fn(AudioObjectID) -> bool,
}

impl Default for TapResources {
  fn default() -> Self {
    Self {
      tap_id: None,
      aggregate_id: None,
      io_procs: Vec::new(),
      cleanup: cleanup_audio_resource,
      is_gone: audio_object_is_gone,
    }
  }
}

impl TapResources {
  fn start_io_proc(
    &mut self,
    device: AudioObjectID,
    proc_id: AudioDeviceIOProcID,
    start: impl FnOnce(AudioObjectID, AudioDeviceIOProcID) -> OSStatus,
  ) -> Result<()> {
    self.io_procs.push((device, proc_id, false));
    let status = start(device, proc_id);
    if status != 0 {
      return Err(CoreAudioError::AudioDeviceStartFailed(status).into());
    }
    self.io_procs.last_mut().unwrap().2 = true;
    Ok(())
  }

  fn release(&self, action: CleanupAction) -> Result<()> {
    let status = (self.cleanup)(action);
    let id = match action {
      CleanupAction::StopIO(id, _)
      | CleanupAction::DestroyIO(id, _)
      | CleanupAction::DestroyAggregate(id)
      | CleanupAction::DestroyTap(id) => id,
    };
    if status == 0 || (invalid_audio_object(status) && (self.is_gone)(id)) {
      return Ok(());
    }
    Err(
      match action {
        CleanupAction::StopIO(..) => CoreAudioError::AudioDeviceStopFailed(status),
        CleanupAction::DestroyIO(..) => CoreAudioError::AudioDeviceDestroyIOProcIDFailed(status),
        CleanupAction::DestroyAggregate(..) => CoreAudioError::AudioHardwareDestroyAggregateDeviceFailed(status),
        CleanupAction::DestroyTap(..) => CoreAudioError::AudioHardwareDestroyProcessTapFailed(status),
      }
      .into(),
    )
  }

  fn is_empty(&self) -> bool {
    self.io_procs.is_empty() && self.aggregate_id.is_none() && self.tap_id.is_none()
  }

  fn cleanup_pass(&mut self) -> Result<()> {
    let mut first_error = None;
    for index in (0..self.io_procs.len()).rev() {
      let (device, proc_id, started) = self.io_procs[index];
      let mut stop_error = None;
      if started {
        match self.release(CleanupAction::StopIO(device, proc_id)) {
          Ok(()) => self.io_procs[index].2 = false,
          Err(error) => stop_error = Some(error),
        }
      }
      match self.release(CleanupAction::DestroyIO(device, proc_id)) {
        Ok(()) => {
          self.io_procs.remove(index);
        }
        Err(error) => {
          first_error.get_or_insert(stop_error.unwrap_or(error));
        }
      }
    }
    // Keep dependency order on failure too: an unresolved aggregate IO proc
    // owns its device, and an unresolved aggregate still references its tap.
    if let Some(device) = self.aggregate_id
      && !self.io_procs.iter().any(|(id, _, _)| *id == device)
    {
      match self.release(CleanupAction::DestroyAggregate(device)) {
        Ok(()) => self.aggregate_id = None,
        Err(error) => {
          first_error.get_or_insert(error);
        }
      }
    }
    if self.aggregate_id.is_none()
      && let Some(tap) = self.tap_id
    {
      match self.release(CleanupAction::DestroyTap(tap)) {
        Ok(()) => self.tap_id = None,
        Err(error) => {
          first_error.get_or_insert(error);
        }
      }
    }
    first_error.map_or(Ok(()), Err)
  }

  fn stop(&mut self) -> Result<()> {
    let mut result = Ok(());
    for _ in 0..CLEANUP_ATTEMPTS {
      result = self.cleanup_pass();
      if self.is_empty() {
        return Ok(());
      }
    }
    result
  }
}

impl Drop for TapResources {
  fn drop(&mut self) {
    // Final bounded best effort for construction failures/GC; no detached
    // worker or process-global collection retaining callbacks indefinitely.
    if let Err(error) = self.stop() {
      eprintln!("CoreAudio cleanup exhausted during drop: {error}");
    }
  }
}

fn system_only_aggregate_description(tap_uuid: &CFString) -> CFDictionary<CFType, CFType> {
  let tap = CFDictionary::from_CFType_pairs(&[(
    cfstring_from_bytes_with_nul(kAudioSubTapUIDKey).as_CFType(),
    tap_uuid.as_CFType(),
  )]);
  let mut description = CFDictionaryBuilder::new();
  description
    .add(
      kAudioAggregateDeviceNameKey.as_slice(),
      CFString::new("Nota System Audio Probe"),
    )
    .add(kAudioAggregateDeviceUIDKey.as_slice(), uuid::Uuid::new_v4().to_string())
    .add(kAudioAggregateDeviceIsPrivateKey.as_slice(), true)
    .add(kAudioAggregateDeviceIsStackedKey.as_slice(), false)
    .add(kAudioAggregateDeviceTapAutoStartKey.as_slice(), true)
    .add(kAudioAggregateDeviceTapListKey.as_slice(), vec![tap]);
  // No physical subdevice or input clock: the tap is the sole input.
  description.build()
}

#[napi]
impl ShareableContent {
  /// Explicit, potentially prompting macOS system-audio check. No microphone,
  /// device-change listeners, sample delivery, or recording files are involved.
  #[napi]
  pub fn probe_system_audio_access() -> Result<()> {
    let tap_description = CATapDescription::init_stereo_global_tap_but_exclude_processes(&[])?;
    unsafe {
      let _: () = objc2::msg_send![tap_description.inner, setPrivate: true];
      let _: () = objc2::msg_send![tap_description.inner, setMuteBehavior: 0_i64];
    }
    let mut tap_id = 0;
    let status = unsafe { AudioHardwareCreateProcessTap(tap_description.inner, &mut tap_id) };
    if status != 0 {
      return Err(CoreAudioError::CreateProcessTapFailed(status).into());
    }
    let mut resources = TapResources::default();
    resources.tap_id = Some(tap_id);

    let tap_uuid = tap_description.get_uuid()?;
    let description = system_only_aggregate_description(&tap_uuid);
    let mut aggregate_id = 0;
    let status =
      unsafe { AudioHardwareCreateAggregateDevice(description.as_concrete_TypeRef().cast(), &mut aggregate_id) };
    if status != 0 {
      return Err(CoreAudioError::CreateAggregateDeviceFailed(status).into());
    }
    resources.aggregate_id = Some(aggregate_id);

    let block = RcBlock::new(
      |_: *mut c_void, _: *mut c_void, _: *mut c_void, _: *mut c_void, _: *mut c_void| kAudioHardwareNoError as i32,
    );
    let mut proc_id = None;
    let status = unsafe {
      AudioDeviceCreateIOProcIDWithBlock(
        &mut proc_id,
        aggregate_id,
        ptr::null_mut(),
        (&*block as *const Block<dyn Fn(_, _, _, _, _) -> i32>)
          .cast_mut()
          .cast(),
      )
    };
    if status != 0 {
      return Err(CoreAudioError::CreateIOProcIDWithBlockFailed(status).into());
    }
    resources.start_io_proc(aggregate_id, proc_id, |device, proc_id| unsafe {
      AudioDeviceStart(device, proc_id)
    })?;
    resources.stop()
  }
}

pub struct AggregateDevice {
  resources: TapResources,
  pub id: AudioObjectID,
  pub audio_stats: Option<AudioStats>,
  pub input_device_id: AudioObjectID,
  pub output_device_id: AudioObjectID,
}

impl AggregateDevice {
  pub fn new(app: &ApplicationInfo) -> Result<Self> {
    let object_id = app.object_id;

    let tap_description = CATapDescription::init_stereo_mixdown_of_processes(object_id)?;
    let mut tap_id: AudioObjectID = 0;

    let status = unsafe { AudioHardwareCreateProcessTap(tap_description.inner, &mut tap_id) };

    if status != 0 {
      return Err(CoreAudioError::CreateProcessTapFailed(status).into());
    }
    let mut resources = TapResources::default();
    resources.tap_id = Some(tap_id);

    let (input_device_id, default_input_uid) = get_device_uid(kAudioHardwarePropertyDefaultInputDevice)?;

    // Get the default output device ID
    let (output_device_id, output_device_uid) = get_device_uid(kAudioHardwarePropertyDefaultOutputDevice)?;
    let description_dict = Self::create_aggregate_description(
      tap_id,
      tap_description.get_uuid()?,
      default_input_uid,
      output_device_uid,
    )?;

    let mut aggregate_device_id: AudioObjectID = 0;

    let status = unsafe {
      AudioHardwareCreateAggregateDevice(description_dict.as_concrete_TypeRef().cast(), &mut aggregate_device_id)
    };

    if status != 0 {
      return Err(CoreAudioError::CreateAggregateDeviceFailed(status).into());
    }
    resources.aggregate_id = Some(aggregate_device_id);

    Ok(Self {
      resources,
      id: aggregate_device_id,
      audio_stats: None,
      input_device_id,
      output_device_id,
    })
  }

  pub fn create_global_tap_but_exclude_processes(processes: &[AudioObjectID]) -> Result<Self> {
    let mut tap_id: AudioObjectID = 0;
    let tap_description = CATapDescription::init_stereo_global_tap_but_exclude_processes(processes)?;
    let status = unsafe { AudioHardwareCreateProcessTap(tap_description.inner, &mut tap_id) };

    if status != 0 {
      return Err(CoreAudioError::CreateProcessTapFailed(status).into());
    }
    let mut resources = TapResources::default();
    resources.tap_id = Some(tap_id);

    // Get the default input device (microphone) UID and ID
    let (input_device_id, default_input_uid) = get_device_uid(kAudioHardwarePropertyDefaultInputDevice)?;

    // Get the default output device ID
    let (output_device_id, output_device_uid) = get_device_uid(kAudioHardwarePropertyDefaultOutputDevice)?;

    let description_dict = Self::create_aggregate_description(
      tap_id,
      tap_description.get_uuid()?,
      default_input_uid,
      output_device_uid,
    )?;

    let mut aggregate_device_id: AudioObjectID = 0;

    let status = unsafe {
      AudioHardwareCreateAggregateDevice(description_dict.as_concrete_TypeRef().cast(), &mut aggregate_device_id)
    };

    // Check the status and return the appropriate result
    if status != 0 {
      return Err(CoreAudioError::CreateAggregateDeviceFailed(status).into());
    }
    resources.aggregate_id = Some(aggregate_device_id);

    // Create a device with stored device IDs
    let mut device = Self {
      resources,
      id: aggregate_device_id,
      audio_stats: None,
      input_device_id,
      output_device_id,
    };

    // Restore the activation logic as it seems necessary for audio flow
    // Configure the aggregate device to ensure proper handling of both input
    // and output
    device.get_aggregate_device_stats()?;

    // Activate both the input and output devices and store their proc IDs
    device.activate_audio_device(input_device_id)?;
    device.activate_audio_device(output_device_id)?;

    Ok(device)
  }

  fn get_aggregate_device_stats(&self) -> Result<AudioStats> {
    let mut sample_rate: f64 = 0.0;
    get_global_main_property(self.id, kAudioDevicePropertyNominalSampleRate, &mut sample_rate)?;

    let audio_stats = AudioStats {
      sample_rate,
      channels: 2,
    };

    Ok(audio_stats)
  }

  // Activates an audio device by creating a dummy IO proc
  fn activate_audio_device(&mut self, device_id: AudioObjectID) -> Result<()> {
    // Create a simple no-op dummy proc
    let dummy_block = RcBlock::new(
      |_: *mut c_void, _: *mut c_void, _: *mut c_void, _: *mut c_void, _: *mut c_void| {
        // No-op function that just returns success
        kAudioHardwareNoError as i32
      },
    );

    let mut dummy_proc_id: AudioDeviceIOProcID = None;

    // Create the IO proc with our dummy block
    let status = unsafe {
      AudioDeviceCreateIOProcIDWithBlock(
        &mut dummy_proc_id,
        device_id,
        ptr::null_mut(),
        (&*dummy_block as *const Block<dyn Fn(_, _, _, _, _) -> i32>)
          .cast_mut()
          .cast(),
      )
    };

    if status != 0 {
      return Err(CoreAudioError::CreateIOProcIDWithBlockFailed(status).into());
    }

    self
      .resources
      .start_io_proc(device_id, dummy_proc_id, |device, proc_id| unsafe {
        AudioDeviceStart(device, proc_id)
      })
  }

  /// Implementation for the AggregateDevice to start processing audio
  pub fn start(
    mut self,
    audio_stream_callback: Arc<ThreadsafeFunction<Float32Array, (), Float32Array, Status, true>>,
    // Add original_audio_stats to ensure consistent target rate
    original_audio_stats: AudioStats,
  ) -> Result<AudioTapStream> {
    let mut current_audio_stats = self.get_aggregate_device_stats()?;

    let queue = create_audio_tap_queue();
    let mut in_proc_id: AudioDeviceIOProcID = None;

    let output_sample_rate = current_audio_stats.sample_rate;
    // Use the consistent original sample rate as the target for the IO block
    let target_sample_rate = original_audio_stats.sample_rate;

    // Update the device's reported stats to the consistent one
    current_audio_stats.sample_rate = target_sample_rate;
    current_audio_stats.channels = original_audio_stats.channels;
    self.audio_stats = Some(current_audio_stats);

    // Use the consistent stats for the stream object returned
    let audio_stats_for_stream = current_audio_stats;
    let delivering = Arc::new(AtomicBool::new(true));
    let io_delivering = delivering.clone();
    let audio_stream_callback = Arc::downgrade(&audio_stream_callback);

    let in_io_block: RcBlock<dyn Fn(*mut c_void, *mut c_void, *mut c_void, *mut c_void, *mut c_void) -> i32>;
    {
      in_io_block = RcBlock::new(
        move |_in_now: *mut c_void,
              in_input_data: *mut c_void,
              in_input_time: *mut c_void,
              _in_output_data: *mut c_void,
              _in_output_time: *mut c_void| {
          if !io_delivering.load(Ordering::Acquire) {
            return kAudioHardwareNoError as i32;
          }
          let Some(audio_stream_callback) = audio_stream_callback.upgrade() else {
            return kAudioHardwareNoError as i32;
          };
          let AudioTimeStamp { mSampleTime, .. } = unsafe { &*in_input_time.cast() };

          // ignore pre-roll
          if *mSampleTime < 0.0 {
            return kAudioHardwareNoError as i32;
          }
          let Ok(dua_audio_buffer_list) = (unsafe { InputAndOutputAudioBufferList::from_raw(in_input_data) }) else {
            return kAudioHardwareBadDeviceError as i32;
          };

          let Ok(system_samples) = dua_audio_buffer_list.output_only(target_sample_rate, output_sample_rate) else {
            return kAudioHardwareBadStreamError as i32;
          };

          // Send the processed audio data to JavaScript
          if io_delivering.load(Ordering::Acquire) {
            audio_stream_callback.call(Ok(system_samples.into()), ThreadsafeFunctionCallMode::NonBlocking);
          }

          kAudioHardwareNoError as i32
        },
      );
    }

    let status = unsafe {
      AudioDeviceCreateIOProcIDWithBlock(
        &mut in_proc_id,
        self.id,
        dispatch2::DispatchRetained::as_ptr(&queue).as_ptr().cast(),
        (&*in_io_block as *const Block<dyn Fn(*mut c_void, *mut c_void, *mut c_void, *mut c_void, *mut c_void) -> i32>)
          .cast_mut()
          .cast(),
      )
    };
    if status != 0 {
      return Err(CoreAudioError::CreateIOProcIDWithBlockFailed(status).into());
    }

    if let Err(error) = self
      .resources
      .start_io_proc(self.id, in_proc_id, |device, proc_id| unsafe {
        AudioDeviceStart(device, proc_id)
      })
    {
      delivering.store(false, Ordering::Release);
      return Err(error);
    }

    Ok(AudioTapStream {
      resources: self.resources,
      audio_stats: audio_stats_for_stream,
      output_device_id: self.output_device_id,
      queue: Some(queue),
      delivering,
    })
  }

  fn create_aggregate_description(
    tap_id: AudioObjectID,
    tap_uuid_string: ItemRef<CFString>,
    input_device_id: CFString,
    output_device_id: CFString,
  ) -> Result<CFDictionary<CFType, CFType>> {
    let aggregate_device_name = CFString::new(&format!("Tap-{tap_id}"));
    let aggregate_device_uid: uuid::Uuid = CFUUID::new().into();
    let aggregate_device_uid_string = aggregate_device_uid.to_string();

    let mut sub_device_input_dict = CFDictionaryBuilder::new();
    sub_device_input_dict.add(kAudioSubDeviceUIDKey.as_slice(), &input_device_id);

    let tap_device_dict = CFDictionary::from_CFType_pairs(&[(
      cfstring_from_bytes_with_nul(kAudioSubTapUIDKey).as_CFType(),
      tap_uuid_string.as_CFType(),
    )]);

    let capture_device_list = vec![sub_device_input_dict.build()];

    // Create the aggregate device description dictionary with a balanced
    // configuration

    let mut cf_dict_builder = CFDictionaryBuilder::new();

    cf_dict_builder
      .add(kAudioAggregateDeviceNameKey.as_slice(), aggregate_device_name)
      .add(kAudioAggregateDeviceUIDKey.as_slice(), aggregate_device_uid_string)
      .add(kAudioAggregateDeviceMainSubDeviceKey.as_slice(), &output_device_id)
      .add(kAudioAggregateDeviceIsPrivateKey.as_slice(), true)
      // can't be stacked because we're using a tap
      .add(kAudioAggregateDeviceIsStackedKey.as_slice(), false)
      .add(kAudioAggregateDeviceTapAutoStartKey.as_slice(), true)
      .add(kAudioAggregateDeviceSubDeviceListKey.as_slice(), capture_device_list)
      .add(kAudioAggregateDeviceClockDeviceKey.as_slice(), input_device_id)
      .add(kAudioAggregateDeviceTapListKey.as_slice(), vec![tap_device_dict]);

    Ok(cf_dict_builder.build())
  }
}

pub struct AudioTapStream {
  resources: TapResources,
  audio_stats: AudioStats,
  output_device_id: AudioObjectID,
  queue: Option<dispatch2::DispatchRetained<dispatch2::DispatchQueue>>,
  delivering: Arc<AtomicBool>,
}

impl AudioTapStream {
  pub fn stop(&mut self) -> Result<()> {
    self.delivering.store(false, Ordering::Release);
    let result = self.resources.stop();
    if self.resources.is_empty() {
      drop(self.queue.take());
    }
    result
  }

  fn replace(active: &mut Option<Self>, start: impl FnOnce() -> Result<Self>) -> Result<()> {
    // Never deliver old and new samples concurrently during a device switch.
    if let Some(old_stream) = active.as_mut() {
      old_stream.stop()?;
    }
    // A failed cleanup keeps the old owner above for another bounded attempt.
    // A failed start leaves an empty slot, not a stopped capture.
    active.take();
    *active = Some(start()?);
    Ok(())
  }

  pub fn get_sample_rate(&self) -> f64 {
    self.audio_stats.sample_rate
  }

  /// Gets the actual sample rate of the current device
  ///
  /// This can be different from the original sample rate if the default device
  /// has changed. The original sample rate is maintained for consistency in
  /// audio processing, but applications might need to know the actual device
  /// sample rate for certain operations.
  pub fn get_actual_sample_rate(&self) -> Result<f64> {
    let device_id = self.output_device_id;
    let mut actual_sample_rate: f64 = 0.0;
    let status = unsafe {
      let address = AudioObjectPropertyAddress {
        mSelector: kAudioDevicePropertyNominalSampleRate,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
      };

      let mut size = std::mem::size_of::<f64>() as u32;
      coreaudio::sys::AudioObjectGetPropertyData(
        device_id,
        &address,
        0,
        ptr::null(),
        &mut size,
        &mut actual_sample_rate as *mut f64 as *mut c_void,
      )
    };

    if status != 0 {
      return Err(CoreAudioError::GetPropertyDataFailed(status).into());
    }

    Ok(actual_sample_rate)
  }

  pub fn get_channels(&self) -> u32 {
    self.audio_stats.channels
  }
}

impl Drop for AudioTapStream {
  fn drop(&mut self) {
    self.delivering.store(false, Ordering::Release);
    // TapResources performs the final bounded cleanup before queue is dropped.
  }
}

struct CaptureState {
  stream: Option<AudioTapStream>,
  stopped: bool,
}

fn reconfigure_capture(
  state: &std::sync::Mutex<CaptureState>,
  mut attempt: impl FnMut(&mut Option<AudioTapStream>) -> Result<()>,
  mut wait: impl FnMut(),
  report_error: impl FnOnce(napi::Error),
) {
  for index in 0..DEVICE_SWITCH_ATTEMPTS {
    let mut state = state.lock().unwrap_or_else(|error| error.into_inner());
    if state.stopped {
      return;
    }
    match attempt(&mut state.stream) {
      Ok(()) => return,
      Err(error) if index + 1 == DEVICE_SWITCH_ATTEMPTS => {
        // Terminal failure is distinct from an empty slot awaiting retry.
        // Keep unresolved teardown ownership available to session.stop().
        state.stopped = true;
        if let Some(stream) = state.stream.as_mut()
          && let Err(cleanup_error) = stream.stop()
        {
          report_error(napi::Error::from_reason(format!(
            "Audio device switch failed after {DEVICE_SWITCH_ATTEMPTS} attempts: {error}; cleanup: {cleanup_error}"
          )));
          return;
        }
        state.stream.take();
        report_error(napi::Error::from_reason(format!(
          "Audio device switch failed after {DEVICE_SWITCH_ATTEMPTS} attempts: {error}"
        )));
        return;
      }
      Err(_) => {}
    }
    drop(state);
    wait();
  }
}

fn device_property_address(selector: u32) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress {
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain,
  }
}

fn remove_device_listener(selector: u32, queue: *mut c_void, block: *mut c_void) -> OSStatus {
  unsafe {
    AudioObjectRemovePropertyListenerBlock(
      kAudioObjectSystemObject,
      &device_property_address(selector),
      queue.cast(),
      block,
    )
  }
}

struct DeviceListeners {
  block: RcBlock<dyn Fn(u32, *mut c_void)>,
  selectors: Vec<u32>,
  queue: Option<dispatch2::DispatchRetained<dispatch2::DispatchQueue>>,
  remove: fn(u32, *mut c_void, *mut c_void) -> OSStatus,
}

impl DeviceListeners {
  fn register(&mut self, selector: u32, add: impl FnOnce(u32, *mut c_void, *mut c_void) -> OSStatus) -> Result<()> {
    let status = add(selector, self.queue_ptr(), self.block_ptr());
    if status != 0 {
      return Err(CoreAudioError::AddPropertyListenerBlockFailed(status).into());
    }
    self.selectors.push(selector);
    Ok(())
  }

  fn block_ptr(&self) -> *mut c_void {
    (&*self.block as *const Block<dyn Fn(u32, *mut c_void)>)
      .cast_mut()
      .cast()
  }

  fn queue_ptr(&self) -> *mut c_void {
    self.queue.as_ref().map_or(ptr::null_mut(), |queue| {
      dispatch2::DispatchRetained::as_ptr(queue).as_ptr().cast()
    })
  }
}

impl Drop for DeviceListeners {
  fn drop(&mut self) {
    for selector in &self.selectors {
      let mut status = 0;
      for _ in 0..CLEANUP_ATTEMPTS {
        status = (self.remove)(*selector, self.queue_ptr(), self.block_ptr());
        if status == 0 {
          break;
        }
      }
      if status != 0 {
        eprintln!("CoreAudio listener removal exhausted for {selector}: {status}");
      }
    }
  }
}

/// A manager for audio device handling that automatically adapts to device
/// changes
pub struct AggregateDeviceManager {
  device: Option<AggregateDevice>,
  default_devices_listener: Option<DeviceListeners>,
  is_app_specific: bool,
  app_id: Option<AudioObjectID>,
  excluded_processes: Vec<AudioObjectID>,
  active_stream: Option<Arc<std::sync::Mutex<CaptureState>>>,
  audio_callback: Option<Arc<ThreadsafeFunction<Float32Array, (), Float32Array, Status, true>>>,
  original_audio_stats: Option<AudioStats>,
}

impl AggregateDeviceManager {
  /// Creates a new AggregateDeviceManager for a specific application
  pub fn new(app: &ApplicationInfo) -> Result<Self> {
    let device = AggregateDevice::new(app)?;

    Ok(Self {
      device: Some(device),
      default_devices_listener: None,
      is_app_specific: true,
      app_id: Some(app.object_id),
      excluded_processes: Vec::new(),
      active_stream: None,
      audio_callback: None,
      original_audio_stats: None,
    })
  }

  /// Creates a new AggregateDeviceManager for global audio with option to
  /// exclude processes
  pub fn new_global(excluded_processes: &[AudioObjectID]) -> Result<Self> {
    let device = AggregateDevice::create_global_tap_but_exclude_processes(excluded_processes)?;
    Ok(Self {
      device: Some(device),
      default_devices_listener: None,
      is_app_specific: false,
      app_id: None,
      excluded_processes: excluded_processes.to_vec(),
      active_stream: None,
      audio_callback: None,
      original_audio_stats: None,
    })
  }

  /// This sets up the initial stream and listeners.
  pub fn start_capture(
    &mut self,
    audio_stream_callback: Arc<ThreadsafeFunction<Float32Array, (), Float32Array, Status, true>>,
  ) -> Result<()> {
    let device = self
      .device
      .take()
      .ok_or_else(|| napi::Error::from_reason("Audio capture already started or stopped"))?;
    let original_audio_stats = device.get_aggregate_device_stats()?;
    let initial_stream = device.start(audio_stream_callback.clone(), original_audio_stats)?;

    // Store the callback for potential device switch later
    self.audio_callback = Some(audio_stream_callback.clone());
    self.original_audio_stats = Some(original_audio_stats);
    self.install_stream(initial_stream, Self::setup_device_change_listeners)
  }

  fn install_stream(
    &mut self,
    stream: AudioTapStream,
    setup_listeners: impl FnOnce(&mut Self) -> Result<()>,
  ) -> Result<()> {
    // Own the stream before registration, which can fail or immediately notify.
    self.active_stream = Some(Arc::new(std::sync::Mutex::new(CaptureState {
      stream: Some(stream),
      stopped: false,
    })));
    if let Err(error) = setup_listeners(self) {
      let _ = self.stop_capture();
      return Err(error);
    }
    Ok(())
  }

  /// Sets up listeners for default device changes
  fn setup_device_change_listeners(&mut self) -> Result<()> {
    // We need to clean up any existing listeners first
    self.cleanup_device_listeners();

    // A failed removal must not keep capture or the JS callback alive.
    let stream_arc = self.active_stream.as_ref().map(Arc::downgrade);
    let callback_arc = self.audio_callback.as_ref().map(Arc::downgrade);
    let is_app_specific = self.is_app_specific;
    let app_id = self.app_id;
    let excluded_processes = self.excluded_processes.clone();

    // Retrieve the stored original audio stats
    let Some(original_audio_stats) = self.original_audio_stats else {
      return Err(napi::Error::from_reason(
        "Internal error: Original audio stats not available for listener.",
      ));
    };

    // Create a block that will handle device changes
    let device_changed_block = RcBlock::new(move |_in_number_addresses: u32, _in_addresses: *mut c_void| {
      // Skip if we don't have all required information
      let Some(stream_mutex) = stream_arc.as_ref().and_then(std::sync::Weak::upgrade) else {
        return;
      };
      let Some(callback) = callback_arc.as_ref().and_then(std::sync::Weak::upgrade) else {
        return;
      };

      reconfigure_capture(
        &stream_mutex,
        |stream| {
          let new_device = if is_app_specific {
            if let Some(id) = app_id {
              let app = ApplicationInfo::new(id as i32, String::new(), id);
              AggregateDevice::new(&app)
            } else {
              Err(CoreAudioError::CreateProcessTapFailed(0).into())
            }
          } else {
            AggregateDevice::create_global_tap_but_exclude_processes(&excluded_processes)
          }?;
          AudioTapStream::replace(stream, || new_device.start(callback.clone(), original_audio_stats))
        },
        || std::thread::sleep(DEVICE_SWITCH_RETRY_DELAY),
        |error| {
          callback.call(Err(error), ThreadsafeFunctionCallMode::NonBlocking);
        },
      );
    });

    let mut listeners = DeviceListeners {
      block: device_changed_block,
      selectors: Vec::new(),
      // Never sleep or rebuild devices on CoreAudio's notification thread.
      // CoreAudio retains this serial queue through listener removal.
      queue: Some(dispatch2::DispatchQueue::new("NotaAudioDeviceChanges", None)),
      remove: remove_device_listener,
    };
    for selector in [
      kAudioHardwarePropertyDefaultInputDevice,
      kAudioHardwarePropertyDefaultOutputDevice,
    ] {
      listeners.register(selector, |selector, queue, block| unsafe {
        AudioObjectAddPropertyListenerBlock(
          kAudioObjectSystemObject,
          &device_property_address(selector),
          queue.cast(),
          block,
        )
      })?;
    }
    self.default_devices_listener = Some(listeners);

    Ok(())
  }

  /// Cleans up device change listeners
  fn cleanup_device_listeners(&mut self) {
    drop(self.default_devices_listener.take());
  }

  /// Stops the active stream and cleans up listeners.
  pub fn stop_capture(&mut self) -> Result<()> {
    let mut result = Ok(());
    if let Some(state) = &self.active_stream {
      let mut state = state.lock().unwrap_or_else(|error| error.into_inner());
      state.stopped = true;
      if let Some(stream) = state.stream.as_mut() {
        result = stream.stop();
      }
      if result.is_ok() {
        state.stream.take();
      }
    }
    if result.is_ok() {
      self.active_stream.take();
    }
    self.cleanup_device_listeners();
    // Also release a device whose capture was never started.
    if let Some(device) = self.device.as_mut() {
      match device.resources.stop() {
        Ok(()) => {
          self.device.take();
        }
        Err(error) => result = Err(error),
      }
    }
    self.audio_callback = None;
    result
  }

  /// Gets the stats of the currently active stream, if any.
  pub fn get_current_stats(&self) -> Option<AudioStats> {
    if let Some(stream_mutex) = &self.active_stream {
      if let Ok(stream_guard) = stream_mutex.lock() {
        // Borrow the stream Option, then map to get stats
        stream_guard
          .stream
          .as_ref()
          .map(|stream| stream.audio_stats)
          .or(self.original_audio_stats)
      } else {
        println!("DEBUG: Failed to lock stream mutex for get_current_stats");
        None
      }
    } else {
      self.original_audio_stats
    }
  }

  /// Gets the actual sample rate of the currently active stream's output
  /// device.
  pub fn get_current_actual_sample_rate(&self) -> Result<Option<f64>> {
    let maybe_stream_ref = if let Some(stream_mutex) = &self.active_stream {
      match stream_mutex.lock() {
        Ok(guard) => guard,
        Err(_) => {
          println!("DEBUG: Failed to lock stream mutex for get_current_actual_sample_rate");
          // Return Ok(None) or an error? Let's return None.
          return Ok(None);
        }
      }
    } else {
      return Ok(None); // No active stream manager
    };

    if let Some(stream) = maybe_stream_ref.stream.as_ref() {
      // Call the existing non-napi method on AudioTapStream
      match stream.get_actual_sample_rate() {
        Ok(rate) => Ok(Some(rate)),
        Err(e) => {
          println!("DEBUG: Error getting actual sample rate from stream: {e}");
          // Propagate the error
          Err(e)
        }
      }
    } else {
      Ok(None) // No active stream
    }
  }
}

impl Drop for AggregateDeviceManager {
  fn drop(&mut self) {
    // Call stop_capture which handles listener cleanup and stream stopping
    match self.stop_capture() {
      Ok(_) => {}
      Err(e) => println!("DEBUG: Error during stop_capture in Drop (ignored): {e}"),
    }
  }
}

// NEW NAPI Struct: AudioCaptureSession
#[napi]
pub struct AudioCaptureSession {
  // Use Option<Box<...>> to allow taking ownership in stop()
  manager: Option<Box<AggregateDeviceManager>>,
  sample_rate: Option<f64>,
  channels: Option<u32>,
}

#[napi]
impl AudioCaptureSession {
  // Constructor called internally, not directly via NAPI
  pub(crate) fn new(manager: Box<AggregateDeviceManager>) -> Self {
    Self {
      manager: Some(manager),
      sample_rate: None,
      channels: None,
    }
  }

  #[napi]
  pub fn stop(&mut self) -> Result<()> {
    if let Some(manager) = self.manager.as_mut() {
      // Cache the stats before dropping
      if let Some(stats) = manager.get_current_stats() {
        self.sample_rate = Some(stats.sample_rate);
        self.channels = Some(stats.channels);
      }

      let result = manager.stop_capture();
      if result.is_ok() {
        self.manager.take();
      }
      result
    } else {
      println!("DEBUG: AudioCaptureSession.stop() called, but manager was already taken");
      // Return Ok even if called multiple times, idempotent behavior
      Ok(())
    }
  }

  #[napi(getter)]
  pub fn get_sample_rate(&self) -> Result<f64> {
    if let Some(cached_rate) = self.sample_rate {
      Ok(cached_rate)
    } else if let Some(manager) = &self.manager {
      manager
        .get_current_stats()
        .map(|stats| stats.sample_rate)
        .ok_or_else(|| napi::Error::from_reason("No active audio stream to get sample rate from"))
    } else {
      Err(napi::Error::from_reason(
        "Audio session is stopped and no cached sample rate available",
      ))
    }
  }

  #[napi(getter)]
  pub fn get_channels(&self) -> Result<u32> {
    if let Some(cached_channels) = self.channels {
      Ok(cached_channels)
    } else if let Some(manager) = &self.manager {
      manager
        .get_current_stats()
        .map(|stats| stats.channels)
        .ok_or_else(|| napi::Error::from_reason("No active audio stream to get channels from"))
    } else {
      Err(napi::Error::from_reason(
        "Audio session is stopped and no cached channels available",
      ))
    }
  }

  #[napi(getter)]
  pub fn get_actual_sample_rate(&self) -> Result<f64> {
    if let Some(cached_rate) = self.sample_rate {
      Ok(cached_rate)
    } else if let Some(manager) = &self.manager {
      manager
        .get_current_actual_sample_rate()? // Propagate CoreAudioError
        .ok_or_else(|| napi::Error::from_reason("No active audio stream to get actual sample rate from"))
    } else {
      Err(napi::Error::from_reason(
        "Audio session is stopped and no cached sample rate available",
      ))
    }
  }
}

// Ensure the manager is dropped if the session object is dropped without
// calling stop()
impl Drop for AudioCaptureSession {
  fn drop(&mut self) {
    // Automatically calls drop on self.manager if it's Some
    if let Some(manager) = self.manager.take() {
      drop(manager);
    }
  }
}

#[cfg(test)]
mod tests {
  use std::cell::RefCell;

  use super::*;

  thread_local! {
    static CLEANUP: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
  }

  fn mock_cleanup(action: CleanupAction) -> OSStatus {
    CLEANUP.with(|events| events.borrow_mut().push(format!("{action:?}")));
    0
  }

  fn failing_cleanup(action: CleanupAction) -> OSStatus {
    mock_cleanup(action);
    -1
  }

  fn events() -> Vec<String> {
    CLEANUP.with(|events| std::mem::take(&mut *events.borrow_mut()))
  }

  fn resources() -> TapResources {
    TapResources {
      tap_id: Some(11),
      aggregate_id: Some(22),
      io_procs: Vec::new(),
      cleanup: mock_cleanup,
      is_gone: |_| false,
    }
  }

  fn stream(resources: TapResources) -> AudioTapStream {
    AudioTapStream {
      resources,
      audio_stats: AudioStats {
        sample_rate: 48000.0,
        channels: 2,
      },
      output_device_id: 44,
      queue: None,
      delivering: Arc::new(AtomicBool::new(true)),
    }
  }

  fn manager(device: Option<AggregateDevice>) -> AggregateDeviceManager {
    AggregateDeviceManager {
      device,
      default_devices_listener: None,
      is_app_specific: false,
      app_id: None,
      excluded_processes: Vec::new(),
      active_stream: None,
      audio_callback: None,
      original_audio_stats: None,
    }
  }

  #[test]
  fn constructor_failure_releases_every_acquired_handle() {
    // Device/UUID lookup or aggregate creation failed after tap creation.
    let mut partial = resources();
    partial.aggregate_id = None;
    drop(partial);
    assert_eq!(events(), ["DestroyTap(11)"]);

    // Stats lookup failed after aggregate creation.
    drop(resources());
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn permission_probe_description_has_no_microphone_or_physical_subdevices() {
    let description = system_only_aggregate_description(&CFString::new("mock-tap"));
    assert!(description.contains_key(&cfstring_from_bytes_with_nul(kAudioAggregateDeviceTapListKey).as_CFType()));
    for key in [
      kAudioAggregateDeviceSubDeviceListKey.as_slice(),
      kAudioAggregateDeviceMainSubDeviceKey.as_slice(),
      kAudioAggregateDeviceClockDeviceKey.as_slice(),
    ] {
      assert!(!description.contains_key(&cfstring_from_bytes_with_nul(key).as_CFType()));
    }
  }

  #[test]
  fn system_only_probe_resources_never_stop_a_physical_device() {
    let mut resources = resources();
    resources.start_io_proc(22, None, |_, _| 0).unwrap();
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(
      events(),
      [
        "StopIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)"
      ]
    );
  }

  #[test]
  fn input_is_owned_when_output_start_fails() {
    let mut resources = resources();
    resources.start_io_proc(33, None, |_, _| 0).unwrap();
    assert!(resources.start_io_proc(44, None, |_, _| -1).is_err());
    drop(resources);
    assert_eq!(
      events(),
      [
        "DestroyIO(44, None)",
        "StopIO(33, None)",
        "DestroyIO(33, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)",
      ]
    );
  }

  #[test]
  fn aggregate_start_failure_releases_auxiliary_procs() {
    let mut resources = resources();
    resources.start_io_proc(33, None, |_, _| 0).unwrap();
    resources.start_io_proc(44, None, |_, _| 0).unwrap();
    assert!(resources.start_io_proc(22, None, |_, _| -1).is_err());
    drop(resources);
    assert_eq!(
      events(),
      [
        "DestroyIO(22, None)",
        "StopIO(44, None)",
        "DestroyIO(44, None)",
        "StopIO(33, None)",
        "DestroyIO(33, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)",
      ]
    );
  }

  #[test]
  fn stream_stop_then_drop_cleans_once_with_the_tap_id() {
    let mut resources = resources();
    resources.start_io_proc(22, None, |_, _| 0).unwrap();
    let mut stream = stream(resources);
    stream.stop().unwrap();
    stream.stop().unwrap();
    drop(stream);
    assert_eq!(
      events(),
      [
        "StopIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)"
      ]
    );
  }

  #[test]
  fn cleanup_errors_do_not_skip_remaining_resources() {
    let mut resources = resources();
    resources.cleanup = failing_cleanup;
    resources.start_io_proc(22, None, |_, _| 0).unwrap();
    resources.start_io_proc(33, None, |_, _| 0).unwrap();
    assert!(resources.stop().is_err());
    assert!(resources.aggregate_id.is_some());
    assert!(resources.tap_id.is_some());
    assert_eq!(resources.io_procs.len(), 2);
    assert_eq!(
      events(),
      [
        "StopIO(33, None)",
        "DestroyIO(33, None)",
        "StopIO(22, None)",
        "DestroyIO(22, None)"
      ]
      .repeat(CLEANUP_ATTEMPTS)
    );
    resources.cleanup = mock_cleanup;
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(
      events(),
      [
        "StopIO(33, None)",
        "DestroyIO(33, None)",
        "StopIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)",
      ]
    );
  }

  #[test]
  fn destruction_failure_retains_only_unresolved_handles() {
    let mut resources = resources();
    resources.start_io_proc(22, None, |_, _| 0).unwrap();
    resources.cleanup = |action| {
      mock_cleanup(action);
      if matches!(action, CleanupAction::DestroyTap(_)) {
        -1
      } else {
        0
      }
    };
    assert!(resources.stop().is_err());
    assert_eq!(resources.tap_id, Some(11));
    assert!(resources.aggregate_id.is_none());
    assert!(resources.io_procs.is_empty());
    assert_eq!(
      events(),
      [
        "StopIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)",
        "DestroyTap(11)",
        "DestroyTap(11)",
      ]
    );
    resources.cleanup = mock_cleanup;
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(events(), ["DestroyTap(11)"]);
  }

  #[test]
  fn drop_cleanup_is_bounded_on_permanent_failure() {
    let mut resources = resources();
    resources.cleanup = failing_cleanup;
    drop(resources);
    assert_eq!(events(), ["DestroyAggregate(22)"].repeat(CLEANUP_ATTEMPTS));
  }

  #[test]
  fn successful_stop_is_not_repeated_when_proc_destruction_needs_retry() {
    let mut resources = resources();
    resources.start_io_proc(22, None, |_, _| 0).unwrap();
    resources.cleanup = |action| {
      mock_cleanup(action);
      if matches!(action, CleanupAction::DestroyIO(..)) {
        -1
      } else {
        0
      }
    };
    assert!(resources.stop().is_err());
    assert!(!resources.io_procs[0].2);
    assert_eq!(
      events(),
      [
        "StopIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyIO(22, None)",
      ]
    );
    resources.cleanup = mock_cleanup;
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(
      events(),
      ["DestroyIO(22, None)", "DestroyAggregate(22)", "DestroyTap(11)"]
    );
  }

  #[test]
  fn successful_destruction_resolves_a_stop_error() {
    let mut resources = resources();
    resources.start_io_proc(22, None, |_, _| 0).unwrap();
    resources.cleanup = |action| {
      mock_cleanup(action);
      if matches!(action, CleanupAction::StopIO(..)) {
        -1
      } else {
        0
      }
    };
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(
      events(),
      [
        "StopIO(22, None)",
        "DestroyIO(22, None)",
        "DestroyAggregate(22)",
        "DestroyTap(11)"
      ]
    );
  }

  #[test]
  fn invalid_device_error_requires_confirmation_before_forgetting_ownership() {
    let mut resources = resources();
    resources.cleanup = |action| {
      mock_cleanup(action);
      kAudioHardwareBadDeviceError as OSStatus
    };
    assert!(resources.stop().is_err());
    assert_eq!(resources.aggregate_id, Some(22));
    assert_eq!(resources.tap_id, Some(11));
    assert_eq!(events(), ["DestroyAggregate(22)"].repeat(CLEANUP_ATTEMPTS));
    resources.is_gone = |_| true;
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn transient_failure_is_retried_in_the_same_stop_call() {
    let mut resources = resources();
    resources.cleanup = |action| {
      mock_cleanup(action);
      if CLEANUP.with(|events| events.borrow().len()) == 1 {
        -1
      } else {
        0
      }
    };
    resources.stop().unwrap();
    drop(resources);
    assert_eq!(
      events(),
      ["DestroyAggregate(22)", "DestroyAggregate(22)", "DestroyTap(11)"]
    );
  }

  #[test]
  fn listener_failure_stops_the_already_owned_stream() {
    let mut manager = manager(None);
    assert!(
      manager
        .install_stream(stream(resources()), |manager| {
          assert!(manager.get_current_stats().is_some());
          Err(napi::Error::from_reason("listener registration failed"))
        })
        .is_err()
    );
    assert!(manager.active_stream.is_none());
    drop(manager);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn second_listener_failure_removes_only_the_registered_listener() {
    let mut listeners = DeviceListeners {
      block: RcBlock::new(|_: u32, _: *mut c_void| {}),
      selectors: Vec::new(),
      queue: None,
      remove: |selector, _, _| {
        CLEANUP.with(|events| events.borrow_mut().push(format!("Remove({selector})")));
        0
      },
    };
    listeners.register(1, |_, _, _| 0).unwrap();
    assert!(listeners.register(2, |_, _, _| -1).is_err());
    drop(listeners);
    assert_eq!(events(), ["Remove(1)"]);
  }

  #[test]
  fn listener_removal_retries_only_the_failed_registration() {
    let mut listeners = DeviceListeners {
      block: RcBlock::new(|_: u32, _: *mut c_void| {}),
      selectors: Vec::new(),
      queue: None,
      remove: |selector, _, _| {
        CLEANUP.with(|events| {
          let mut events = events.borrow_mut();
          events.push(format!("Remove({selector})"));
          if events.len() == 1 { -1 } else { 0 }
        })
      },
    };
    listeners.register(1, |_, _, _| 0).unwrap();
    listeners.register(2, |_, _, _| 0).unwrap();
    drop(listeners);
    assert_eq!(events(), ["Remove(1)", "Remove(1)", "Remove(2)"]);
  }

  #[test]
  fn failed_listener_removal_is_bounded_and_retained_callback_cannot_restart() {
    let mut manager = manager(None);
    manager.install_stream(stream(resources()), |_| Ok(())).unwrap();
    let state = manager.active_stream.as_ref().unwrap().clone();
    let weak_state = Arc::downgrade(&state);
    let block = RcBlock::new(move |_: u32, _: *mut c_void| {
      if let Some(state) = weak_state.upgrade() {
        reconfigure_capture(
          &state,
          |_| panic!("stopped capture restarted"),
          || {},
          |_| panic!("late error"),
        );
      }
    });
    manager.default_devices_listener = Some(DeviceListeners {
      block: block.clone(),
      selectors: vec![1, 2],
      queue: None,
      remove: |selector, _, _| {
        CLEANUP.with(|events| events.borrow_mut().push(format!("Remove({selector})")));
        -1
      },
    });
    manager.stop_capture().unwrap();
    block.call((0, ptr::null_mut()));
    drop(manager);
    drop(state);
    block.call((0, ptr::null_mut()));
    assert_eq!(
      events(),
      [
        "DestroyAggregate(22)",
        "DestroyTap(11)",
        "Remove(1)",
        "Remove(1)",
        "Remove(1)",
        "Remove(2)",
        "Remove(2)",
        "Remove(2)",
      ]
    );
  }

  #[test]
  fn unstarted_manager_drop_releases_the_device() {
    drop(manager(Some(AggregateDevice {
      resources: resources(),
      id: 22,
      audio_stats: None,
      input_device_id: 33,
      output_device_id: 44,
    })));
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn replacing_stream_drops_old_resources_and_stop_clears_listener_state() {
    let mut manager = manager(None);
    manager.install_stream(stream(resources()), |_| Ok(())).unwrap();
    let listener_state = manager.active_stream.as_ref().unwrap().clone();
    let mut replacement = resources();
    replacement.tap_id = Some(55);
    replacement.aggregate_id = Some(66);
    AudioTapStream::replace(&mut listener_state.lock().unwrap().stream, || {
      assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
      Ok(stream(replacement))
    })
    .unwrap();
    manager.stop_capture().unwrap();
    assert!(listener_state.lock().unwrap().stream.is_none());
    assert!(listener_state.lock().unwrap().stopped);
    drop(manager);
    assert_eq!(events(), ["DestroyAggregate(66)", "DestroyTap(55)"]);
  }

  #[test]
  fn replacement_start_failure_drops_new_resources_after_stopping_old_stream() {
    let mut active = Some(stream(resources()));
    assert!(
      AudioTapStream::replace(&mut active, || {
        assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
        let _partial = resources();
        Err(napi::Error::from_reason("replacement start failed"))
      })
      .is_err()
    );
    assert!(active.is_none());
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn replacement_cleanup_failure_does_not_start_new_stream() {
    let mut old = resources();
    old.cleanup = failing_cleanup;
    let mut active = Some(stream(old));
    let replacement = resources();
    assert!(
      AudioTapStream::replace(&mut active, move || {
        let _owned = replacement;
        panic!("replacement must not start after failed cleanup");
      })
      .is_err()
    );
    assert!(active.is_some());
    assert!(!active.as_ref().unwrap().delivering.load(Ordering::Acquire));
    assert_eq!(
      events(),
      [
        "DestroyAggregate(22)",
        "DestroyAggregate(22)",
        "DestroyAggregate(22)",
        "DestroyAggregate(22)",
        "DestroyTap(11)",
      ]
    );
    active.as_mut().unwrap().resources.cleanup = mock_cleanup;
    AudioTapStream::replace(&mut active, || Ok(stream(resources()))).unwrap();
    drop(active);
    assert_eq!(
      events(),
      [
        "DestroyAggregate(22)",
        "DestroyTap(11)",
        "DestroyAggregate(22)",
        "DestroyTap(11)",
      ]
    );
  }

  #[test]
  fn session_drop_without_stop_releases_active_stream() {
    let mut manager = manager(None);
    manager.install_stream(stream(resources()), |_| Ok(())).unwrap();
    drop(AudioCaptureSession::new(Box::new(manager)));
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn session_stop_propagates_cleanup_failure_and_remains_idempotent() {
    let mut resources = resources();
    resources.cleanup = failing_cleanup;
    let mut manager = manager(None);
    manager.install_stream(stream(resources), |_| Ok(())).unwrap();
    let mut session = AudioCaptureSession::new(Box::new(manager));
    assert!(session.stop().is_err());
    assert_eq!(session.get_sample_rate().unwrap(), 48000.0);
    assert!(session.stop().is_err());
    assert_eq!(session.get_channels().unwrap(), 2);
    assert_eq!(session.get_actual_sample_rate().unwrap(), 48000.0);
    assert_eq!(events(), ["DestroyAggregate(22)"].repeat(CLEANUP_ATTEMPTS * 2));
    let manager = session.manager.as_ref().unwrap();
    assert!(manager.audio_callback.is_none());
    let mut state = manager.active_stream.as_ref().unwrap().lock().unwrap();
    assert!(state.stopped);
    state.stream.as_mut().unwrap().resources.cleanup = mock_cleanup;
    drop(state);
    session.stop().unwrap();
    session.stop().unwrap();
    drop(session);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn unplugged_physical_device_does_not_block_replacement() {
    let mut old = resources();
    old.start_io_proc(33, None, |_, _| 0).unwrap();
    old.cleanup = |action| {
      mock_cleanup(action);
      if matches!(action, CleanupAction::StopIO(33, _) | CleanupAction::DestroyIO(33, _)) {
        kAudioHardwareBadDeviceError as OSStatus
      } else {
        0
      }
    };
    old.is_gone = |id| id == 33;
    let mut active = Some(stream(old));
    AudioTapStream::replace(&mut active, || {
      assert_eq!(
        events(),
        [
          "StopIO(33, None)",
          "DestroyIO(33, None)",
          "DestroyAggregate(22)",
          "DestroyTap(11)"
        ]
      );
      Ok(stream(resources()))
    })
    .unwrap();
    drop(active);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn failed_replacement_start_recovers_without_another_notification() {
    let state = std::sync::Mutex::new(CaptureState {
      stream: Some(stream(resources())),
      stopped: false,
    });
    let mut attempts = 0;
    let mut waits = 0;
    reconfigure_capture(
      &state,
      |active| {
        attempts += 1;
        AudioTapStream::replace(active, || {
          if attempts == 1 {
            Err(napi::Error::from_reason("device not ready"))
          } else {
            Ok(stream(resources()))
          }
        })
      },
      || waits += 1,
      |error| panic!("Unexpected terminal error: {error}"),
    );
    assert_eq!(attempts, 2);
    assert_eq!(waits, 1);
    assert!(!state.lock().unwrap().stopped);
    assert!(state.lock().unwrap().stream.is_some());
    drop(state);
    assert_eq!(
      events(),
      [
        "DestroyAggregate(22)",
        "DestroyTap(11)",
        "DestroyAggregate(22)",
        "DestroyTap(11)"
      ]
    );
  }

  #[test]
  fn terminal_reconfiguration_reports_once_and_late_notifications_do_nothing() {
    let state = std::sync::Mutex::new(CaptureState {
      stream: Some(stream(resources())),
      stopped: false,
    });
    let mut attempts = 0;
    let mut reported = Vec::new();
    reconfigure_capture(
      &state,
      |_| {
        attempts += 1;
        Err(napi::Error::from_reason("device unavailable"))
      },
      || {},
      |error| reported.push(error.reason.clone()),
    );
    assert_eq!(attempts, DEVICE_SWITCH_ATTEMPTS);
    assert_eq!(reported.len(), 1);
    assert!(reported[0].contains("device unavailable"));
    assert!(state.lock().unwrap().stopped);
    assert!(state.lock().unwrap().stream.is_none());
    reconfigure_capture(
      &state,
      |_| panic!("late callback restarted capture"),
      || {},
      |_| panic!("duplicate error"),
    );
    drop(state);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn stop_during_retry_prevents_restart_and_terminal_callback() {
    let mut manager = manager(None);
    manager.install_stream(stream(resources()), |_| Ok(())).unwrap();
    let state = manager.active_stream.as_ref().unwrap().clone();
    let mut attempts = 0;
    reconfigure_capture(
      &state,
      |active| {
        attempts += 1;
        AudioTapStream::replace(active, || Err(napi::Error::from_reason("retry")))
      },
      || manager.stop_capture().unwrap(),
      |_| panic!("error after explicit stop"),
    );
    assert_eq!(attempts, 1);
    assert!(state.lock().unwrap().stopped);
    reconfigure_capture(
      &state,
      |_| panic!("restart after stop"),
      || {},
      |_| panic!("late error"),
    );
    drop(manager);
    drop(state);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }

  #[test]
  fn terminal_cleanup_failure_remains_owned_until_explicit_stop() {
    let mut old = resources();
    old.cleanup = failing_cleanup;
    let state = std::sync::Mutex::new(CaptureState {
      stream: Some(stream(old)),
      stopped: false,
    });
    let mut reported = Vec::new();
    reconfigure_capture(
      &state,
      |active| AudioTapStream::replace(active, || panic!("must not start while teardown unresolved")),
      || {},
      |error| reported.push(error.reason.clone()),
    );
    assert_eq!(reported.len(), 1);
    assert!(reported[0].contains("cleanup"));
    let mut state = state.into_inner().unwrap();
    assert!(state.stopped);
    assert!(state.stream.is_some());
    assert_eq!(
      events(),
      ["DestroyAggregate(22)"].repeat(CLEANUP_ATTEMPTS * (DEVICE_SWITCH_ATTEMPTS + 1))
    );
    state.stream.as_mut().unwrap().resources.cleanup = mock_cleanup;
    drop(state);
    assert_eq!(events(), ["DestroyAggregate(22)", "DestroyTap(11)"]);
  }
}
