use std::{
  collections::HashSet,
  ffi::{CStr, c_char},
  ptr,
  sync::{
    Arc, Mutex, TryLockError,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender},
  },
  thread::{self, JoinHandle},
  time::{Duration, Instant},
};

use block2::{Block, RcBlock};
use chrono::{DateTime, SecondsFormat, Utc};
use napi::{
  Error, Result, Status,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use objc2::{
  msg_send,
  rc::autoreleasepool,
  runtime::{AnyClass, AnyObject, Bool},
};

#[link(name = "EventKit", kind = "framework")]
unsafe extern "C" {}

const EK_ENTITY_TYPE_EVENT: isize = 0;
const WORKER_RESPONSE_TIMEOUT: Duration = Duration::from_secs(3);

type AppleCalendarAccessCallback = ThreadsafeFunction<AppleCalendarStatus, (), AppleCalendarStatus, Status, true, true>;
type AppleCalendarAccessBlock = RcBlock<dyn Fn(Bool, *mut AnyObject)>;
type WorkerResponse<T> = SyncSender<Result<T>>;

struct CommandControl {
  acceptance: Receiver<()>,
  cancelled: Arc<AtomicBool>,
  deadline: Instant,
}

impl CommandControl {
  fn is_cancelled_or_expired(&self) -> bool {
    self.cancelled.load(Ordering::Acquire) || Instant::now() >= self.deadline
  }

  fn wait_for_acceptance(&self) -> bool {
    self.acceptance.recv_timeout(WORKER_RESPONSE_TIMEOUT).is_ok() && !self.cancelled.load(Ordering::Acquire)
  }
}

struct AccessRequestCommand {
  callback: AppleCalendarAccessCallback,
  control: CommandControl,
  response: WorkerResponse<()>,
  worker_sender: Sender<EventStoreCommand>,
}

enum EventStoreCommand {
  AccessCompleted {
    granted: bool,
    reason: Option<String>,
    request_id: u64,
  },
  GetStatus {
    control: CommandControl,
    reason: Option<String>,
    response: WorkerResponse<AppleCalendarStatus>,
  },
  ListCalendars {
    control: CommandControl,
    response: WorkerResponse<Vec<AppleCalendar>>,
  },
  ListEvents {
    control: CommandControl,
    input: AppleCalendarEventsInput,
    response: WorkerResponse<Vec<AppleCalendarEvent>>,
  },
  RequestAccess(AccessRequestCommand),
}

impl EventStoreCommand {
  fn is_cancelled_or_expired(&self) -> bool {
    match self {
      Self::AccessCompleted { .. } => false,
      Self::GetStatus { control, .. } | Self::ListCalendars { control, .. } | Self::ListEvents { control, .. } => {
        control.is_cancelled_or_expired()
      }
      Self::RequestAccess(request) => request.control.is_cancelled_or_expired(),
    }
  }

  fn reject_cancelled(self) {
    match self {
      Self::AccessCompleted { .. } => {}
      Self::GetStatus { response, .. } => {
        let _ = response.send(Err(worker_response_timeout_error()));
      }
      Self::ListCalendars { response, .. } => {
        let _ = response.send(Err(worker_response_timeout_error()));
      }
      Self::ListEvents { response, .. } => {
        let _ = response.send(Err(worker_response_timeout_error()));
      }
      Self::RequestAccess(request) => {
        let _ = request.response.send(Err(worker_response_timeout_error()));
      }
    }
  }
}

struct EventStoreWorker {
  sender: Sender<EventStoreCommand>,
  thread: JoinHandle<()>,
  startup: Mutex<WorkerStartup>,
}

enum WorkerStartup {
  Pending(Receiver<std::result::Result<(), String>>),
  Complete(std::result::Result<(), String>),
}

struct PendingAccessRequest<C = AppleCalendarAccessCallback, B = AppleCalendarAccessBlock> {
  callback: C,
  completion: B,
  request_id: u64,
}

impl<C, B> PendingAccessRequest<C, B> {
  fn take_completed(pending: &mut Option<Self>, request_id: u64) -> Option<Self> {
    if pending.as_ref().map(|request| request.request_id) == Some(request_id) {
      pending.take()
    } else {
      None
    }
  }
}

static EVENT_STORE_WORKER: Mutex<Option<Arc<EventStoreWorker>>> = Mutex::new(None);
// The OS prompt outlives a worker failure. Only its completion may release this
// guard; neither a caller timeout nor restarting the worker cancels consent.
static ACCESS_REQUEST_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[napi(object)]
pub struct AppleCalendarStatus {
  pub available: bool,
  pub authorized: bool,
  pub calendars_count: Option<u32>,
  pub events_count: Option<u32>,
  pub platform: Option<String>,
  pub reason: Option<String>,
  pub request_pending: bool,
  pub status: String,
  pub supported: bool,
}

#[napi(object)]
pub struct AppleCalendar {
  pub allows_content_modifications: Option<bool>,
  pub color: Option<String>,
  pub id: String,
  pub title: String,
}

#[napi(object)]
pub struct AppleCalendarParticipant {
  pub email: Option<String>,
  pub name: Option<String>,
  pub role: Option<String>,
  pub status: Option<String>,
  pub type_: Option<String>,
  pub url: Option<String>,
}

#[napi(object)]
pub struct AppleCalendarEvent {
  pub all_day: bool,
  pub attendees: Option<Vec<AppleCalendarParticipant>>,
  pub availability: Option<String>,
  pub calendar_color: Option<String>,
  pub calendar_id: String,
  pub calendar_name: Option<String>,
  pub end_at: String,
  pub external_event_id: Option<String>,
  pub id: String,
  pub location: Option<String>,
  pub meeting_url: Option<String>,
  pub notes: Option<String>,
  pub organizer: Option<AppleCalendarParticipant>,
  pub start_at: String,
  pub status: Option<String>,
  pub title: String,
  pub url: Option<String>,
}

#[napi(object)]
pub struct AppleCalendarEventsInput {
  pub calendar_ids: Option<Vec<String>>,
  pub from: String,
  pub to: String,
}

fn worker_response_timeout_error() -> Error {
  Error::new(
    Status::GenericFailure,
    "Apple calendar worker response timed out after 3 seconds.",
  )
}

impl EventStoreWorker {
  fn start() -> std::result::Result<Self, String> {
    Self::spawn(run_event_store_worker)
  }

  fn spawn(
    run: impl FnOnce(Receiver<EventStoreCommand>, SyncSender<std::result::Result<(), String>>) + Send + 'static,
  ) -> std::result::Result<Self, String> {
    let (sender, receiver) = mpsc::channel();
    let (ready_sender, ready_receiver) = mpsc::sync_channel(1);

    let thread = thread::Builder::new()
      .name("nota-eventkit".to_string())
      .spawn(move || run(receiver, ready_sender))
      .map_err(|error| format!("Failed to start Apple calendar worker: {error}"))?;

    Ok(Self {
      sender,
      thread,
      startup: Mutex::new(WorkerStartup::Pending(ready_receiver)),
    })
  }

  fn wait_until_ready(&self, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let mut startup = self.startup.try_lock().map_err(|error| {
      Error::new(
        Status::GenericFailure,
        match error {
          TryLockError::WouldBlock => "Apple calendar worker initialization is still in progress.",
          TryLockError::Poisoned(_) => "Apple calendar worker startup state is unavailable.",
        },
      )
    })?;
    if let WorkerStartup::Pending(receiver) = &*startup {
      match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(result) => *startup = WorkerStartup::Complete(result),
        // Keep the receiver and worker alive: the wait ended, not initialization.
        Err(RecvTimeoutError::Timeout) => {
          return Err(Error::new(
            Status::GenericFailure,
            "Apple calendar worker startup timed out; initialization is still in progress.",
          ));
        }
        Err(RecvTimeoutError::Disconnected) => {
          *startup = WorkerStartup::Complete(Err("Apple calendar worker disconnected during startup.".to_string()));
        }
      }
    }
    match &*startup {
      WorkerStartup::Complete(result) => result
        .as_ref()
        .map(|_| ())
        .map_err(|reason| Error::new(Status::GenericFailure, reason.clone())),
      WorkerStartup::Pending(_) => unreachable!("startup wait returned without a result"),
    }
  }

  fn request<T>(&self, command: impl FnOnce(WorkerResponse<T>, CommandControl) -> EventStoreCommand) -> Result<T> {
    let (response_sender, response_receiver) = mpsc::sync_channel(1);
    let (acceptance_sender, acceptance_receiver) = mpsc::sync_channel(1);
    let cancelled = Arc::new(AtomicBool::new(false));
    let control = CommandControl {
      acceptance: acceptance_receiver,
      cancelled: Arc::clone(&cancelled),
      deadline: Instant::now() + WORKER_RESPONSE_TIMEOUT,
    };
    self
      .sender
      .send(command(response_sender, control))
      .map_err(|_| Error::new(Status::GenericFailure, "Apple calendar worker is unavailable."))?;
    match response_receiver.recv_timeout(WORKER_RESPONSE_TIMEOUT) {
      Ok(result) => {
        if result.is_ok() {
          let _ = acceptance_sender.send(());
        }
        result
      }
      Err(RecvTimeoutError::Timeout) => {
        cancelled.store(true, Ordering::Release);
        Err(worker_response_timeout_error())
      }
      Err(RecvTimeoutError::Disconnected) => {
        cancelled.store(true, Ordering::Release);
        Err(Error::new(
          Status::GenericFailure,
          "Apple calendar worker disconnected before returning a response.",
        ))
      }
    }
  }

  fn get_status(&self, reason: Option<String>) -> Result<AppleCalendarStatus> {
    self.request(|response, control| EventStoreCommand::GetStatus {
      control,
      reason,
      response,
    })
  }

  fn list_calendars(&self) -> Result<Vec<AppleCalendar>> {
    self.request(|response, control| EventStoreCommand::ListCalendars { control, response })
  }

  fn list_events(&self, input: AppleCalendarEventsInput) -> Result<Vec<AppleCalendarEvent>> {
    self.request(|response, control| EventStoreCommand::ListEvents {
      control,
      input,
      response,
    })
  }

  fn request_access(&self, callback: AppleCalendarAccessCallback) -> Result<()> {
    let worker_sender = self.sender.clone();
    self.request(move |response, control| {
      EventStoreCommand::RequestAccess(AccessRequestCommand {
        callback,
        control,
        response,
        worker_sender,
      })
    })
  }
}

fn event_store_worker() -> Result<Arc<EventStoreWorker>> {
  let worker = cached_event_store_worker(&EVENT_STORE_WORKER, EventStoreWorker::start)?;
  worker.wait_until_ready(WORKER_RESPONSE_TIMEOUT)?;
  Ok(worker)
}

fn cached_event_store_worker(
  cache: &Mutex<Option<Arc<EventStoreWorker>>>,
  start: impl FnOnce() -> std::result::Result<EventStoreWorker, String>,
) -> Result<Arc<EventStoreWorker>> {
  let mut worker = cache
    .lock()
    .map_err(|_| Error::new(Status::GenericFailure, "Apple calendar worker cache is unavailable."))?;
  if worker.as_ref().is_none_or(|worker| worker.thread.is_finished()) {
    *worker = Some(Arc::new(
      start().map_err(|reason| Error::new(Status::GenericFailure, reason))?,
    ));
  }
  Ok(Arc::clone(worker.as_ref().expect("worker was initialized")))
}

fn run_event_store_worker(
  receiver: Receiver<EventStoreCommand>,
  ready_sender: SyncSender<std::result::Result<(), String>>,
) {
  // Create and retain the store inside its owner thread. The raw pointer never
  // crosses the worker command boundary.
  let event_store = match unsafe { new_object(c"EKEventStore") } {
    Ok(event_store) => event_store,
    Err(error) => {
      let _ = ready_sender.send(Err(error.to_string()));
      return;
    }
  };
  let mut last_authorization_status = match unsafe { authorization_status_raw() } {
    Ok(status) => status,
    Err(error) => {
      let _ = ready_sender.send(Err(error.to_string()));
      return;
    }
  };
  if ready_sender.send(Ok(())).is_err() {
    return;
  }

  let mut pending_request: Option<PendingAccessRequest> = None;
  let mut next_request_id = 0_u64;

  loop {
    let command = match receiver.recv() {
      Ok(command) => command,
      Err(_) => break,
    };
    if command.is_cancelled_or_expired() {
      command.reject_cancelled();
      continue;
    }

    autoreleasepool(|_| match command {
      EventStoreCommand::AccessCompleted {
        granted,
        reason,
        request_id,
      } => complete_access_request(
        event_store,
        &mut pending_request,
        &mut last_authorization_status,
        request_id,
        granted,
        reason,
      ),
      EventStoreCommand::GetStatus { reason, response, .. } => {
        let _ = response.send(status_payload(
          event_store,
          reason,
          &mut last_authorization_status,
          &mut pending_request,
        ));
      }
      EventStoreCommand::ListCalendars { response, .. } => {
        let _ = response.send(list_calendars(
          event_store,
          &mut last_authorization_status,
          &mut pending_request,
        ));
      }
      EventStoreCommand::ListEvents { input, response, .. } => {
        let _ = response.send(list_events(
          event_store,
          input,
          &mut last_authorization_status,
          &mut pending_request,
        ));
      }
      EventStoreCommand::RequestAccess(request) => {
        start_access_request(
          event_store,
          &mut pending_request,
          &mut last_authorization_status,
          &mut next_request_id,
          request,
        );
      }
    });
  }
}

fn objective_c_class(name: &'static CStr) -> Result<&'static AnyClass> {
  AnyClass::get(name).ok_or_else(|| Error::new(Status::GenericFailure, format!("Missing Objective-C class {name:?}.")))
}

unsafe fn new_object(name: &'static CStr) -> Result<*mut AnyObject> {
  let class = objective_c_class(name)?;
  let object: *mut AnyObject = unsafe { msg_send![class, new] };
  if object.is_null() {
    Err(Error::new(
      Status::GenericFailure,
      format!("Failed to create Objective-C object {name:?}."),
    ))
  } else {
    Ok(object)
  }
}

unsafe fn ns_string_to_string(value: *mut AnyObject) -> Option<String> {
  if value.is_null() {
    return None;
  }
  let utf8_ptr: *const c_char = unsafe { msg_send![value, UTF8String] };
  if utf8_ptr.is_null() {
    return None;
  }
  unsafe { CStr::from_ptr(utf8_ptr) }
    .to_str()
    .ok()
    .map(ToString::to_string)
    .filter(|value| !value.is_empty())
}

unsafe fn string_property(object: *mut AnyObject, property: &str) -> Option<String> {
  match property {
    "calendarIdentifier" => {
      let value: *mut AnyObject = unsafe { msg_send![object, calendarIdentifier] };
      unsafe { ns_string_to_string(value) }
    }
    "calendarItemIdentifier" => {
      let value: *mut AnyObject = unsafe { msg_send![object, calendarItemIdentifier] };
      unsafe { ns_string_to_string(value) }
    }
    "eventIdentifier" => {
      let value: *mut AnyObject = unsafe { msg_send![object, eventIdentifier] };
      unsafe { ns_string_to_string(value) }
    }
    "location" => {
      let value: *mut AnyObject = unsafe { msg_send![object, location] };
      unsafe { trimmed_string(value) }
    }
    "name" => {
      let value: *mut AnyObject = unsafe { msg_send![object, name] };
      unsafe { ns_string_to_string(value) }
    }
    "notes" => {
      let value: *mut AnyObject = unsafe { msg_send![object, notes] };
      unsafe { trimmed_string(value) }
    }
    "title" => {
      let value: *mut AnyObject = unsafe { msg_send![object, title] };
      unsafe { ns_string_to_string(value) }
    }
    _ => None,
  }
}

unsafe fn trimmed_string(value: *mut AnyObject) -> Option<String> {
  unsafe { ns_string_to_string(value) }
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

unsafe fn url_to_string(url: *mut AnyObject) -> Option<String> {
  if url.is_null() {
    return None;
  }
  let value: *mut AnyObject = unsafe { msg_send![url, absoluteString] };
  unsafe { ns_string_to_string(value) }
}

unsafe fn url_property(object: *mut AnyObject) -> Option<String> {
  let url: *mut AnyObject = unsafe { msg_send![object, URL] };
  unsafe { url_to_string(url) }
}

unsafe fn authorization_status_raw() -> Result<isize> {
  let event_store_class = objective_c_class(c"EKEventStore")?;
  Ok(unsafe { msg_send![event_store_class, authorizationStatusForEntityType: EK_ENTITY_TYPE_EVENT] })
}

fn authorization_status_text(status: isize) -> String {
  match status {
    0 => "not-determined",
    1 => "restricted",
    2 => "denied",
    3 => "authorized",
    4 => "write-only",
    _ => "unknown",
  }
  .to_string()
}

fn is_authorized(status: isize) -> bool {
  status == 3
}

#[napi]
pub fn get_apple_calendar_status() -> Result<AppleCalendarStatus> {
  event_store_worker()?.get_status(None)
}

fn refresh_authorization_status(
  event_store: *mut AnyObject,
  last_status: &mut isize,
  _pending_request: &mut Option<PendingAccessRequest>,
) -> Result<isize> {
  let current_status = unsafe { authorization_status_raw()? };
  if !is_authorized(*last_status) && is_authorized(current_status) {
    reset_event_store(event_store);
  }
  *last_status = current_status;
  Ok(current_status)
}

fn reset_event_store(event_store: *mut AnyObject) {
  unsafe {
    let _: () = msg_send![event_store, reset];
  }
}

fn status_payload(
  event_store: *mut AnyObject,
  reason: Option<String>,
  last_authorization_status: &mut isize,
  pending_request: &mut Option<PendingAccessRequest>,
) -> Result<AppleCalendarStatus> {
  let raw_status = refresh_authorization_status(event_store, last_authorization_status, pending_request)?;
  status_payload_for_authorization(event_store, reason, raw_status).map(|mut status| {
    status.request_pending |= pending_request.is_some();
    status
  })
}

fn status_payload_for_authorization(
  event_store: *mut AnyObject,
  reason: Option<String>,
  raw_status: isize,
) -> Result<AppleCalendarStatus> {
  let authorized = is_authorized(raw_status);
  let calendars_count = if authorized {
    calendar_count(event_store).ok()
  } else {
    None
  };

  Ok(AppleCalendarStatus {
    available: true,
    authorized,
    calendars_count,
    events_count: None,
    platform: Some("darwin".to_string()),
    reason,
    request_pending: ACCESS_REQUEST_IN_FLIGHT.load(Ordering::Acquire),
    status: authorization_status_text(raw_status),
    supported: true,
  })
}

#[napi]
pub fn request_apple_calendar_access(callback: AppleCalendarAccessCallback) -> Result<()> {
  event_store_worker()?.request_access(callback)
}

fn start_access_request(
  event_store: *mut AnyObject,
  pending_request: &mut Option<PendingAccessRequest>,
  last_authorization_status: &mut isize,
  next_request_id: &mut u64,
  request: AccessRequestCommand,
) {
  let AccessRequestCommand {
    callback,
    control,
    response,
    worker_sender,
  } = request;
  let raw_status = match refresh_authorization_status(event_store, last_authorization_status, pending_request) {
    Ok(raw_status) => raw_status,
    Err(error) => {
      let _ = response.send(Err(error));
      return;
    }
  };
  if control.is_cancelled_or_expired() {
    let _ = response.send(Err(worker_response_timeout_error()));
    return;
  }
  if pending_request.is_some() || ACCESS_REQUEST_IN_FLIGHT.load(Ordering::Acquire) {
    let _ = response.send(Err(Error::new(
      Status::GenericFailure,
      "An Apple calendar access request is already in progress.",
    )));
    return;
  }

  if !matches!(raw_status, 0 | 4) {
    let status = status_payload_for_authorization(event_store, None, raw_status);
    if control.is_cancelled_or_expired() {
      let _ = response.send(Err(worker_response_timeout_error()));
    } else if response.send(Ok(())).is_ok() && control.wait_for_acceptance() {
      callback.call(status, ThreadsafeFunctionCallMode::NonBlocking);
    }
    return;
  }

  let request_id = *next_request_id;
  *next_request_id = (*next_request_id).wrapping_add(1);

  let completion_sender = worker_sender;
  let completion: AppleCalendarAccessBlock = RcBlock::new(move |granted: Bool, error: *mut AnyObject| {
    // EventKit invokes this block on an arbitrary queue. Convert the error while
    // it is valid, then return all EventKit status/store work to the owner.
    let reason = unsafe {
      if error.is_null() {
        None
      } else {
        let description: *mut AnyObject = msg_send![error, localizedDescription];
        ns_string_to_string(description)
      }
    };
    ACCESS_REQUEST_IN_FLIGHT.store(false, Ordering::Release);
    let _ = completion_sender.send(EventStoreCommand::AccessCompleted {
      granted: granted.as_bool(),
      reason,
      request_id,
    });
  });

  if control.is_cancelled_or_expired() {
    let _ = response.send(Err(worker_response_timeout_error()));
    return;
  }
  if response.send(Ok(())).is_err() {
    return;
  }
  if !control.wait_for_acceptance() {
    return;
  }

  ACCESS_REQUEST_IN_FLIGHT.store(true, Ordering::Release);
  *pending_request = Some(PendingAccessRequest {
    callback,
    completion,
    request_id,
  });
  let completion = &pending_request
    .as_ref()
    .expect("pending request was just initialized")
    .completion;
  unsafe {
    let _: () = msg_send![
      event_store,
      requestFullAccessToEventsWithCompletion: (RcBlock::as_ptr(completion) as *const Block<dyn Fn(Bool, *mut AnyObject)>)
    ];
  }
}

fn complete_access_request(
  event_store: *mut AnyObject,
  pending_request: &mut Option<PendingAccessRequest>,
  last_authorization_status: &mut isize,
  request_id: u64,
  granted: bool,
  reason: Option<String>,
) {
  let Some(PendingAccessRequest {
    callback, completion, ..
  }) = PendingAccessRequest::take_completed(pending_request, request_id)
  else {
    return;
  };
  drop(completion);

  let status = (|| {
    if granted {
      reset_event_store(event_store);
    }
    let current_status = unsafe { authorization_status_raw()? };
    if !granted && !is_authorized(*last_authorization_status) && is_authorized(current_status) {
      reset_event_store(event_store);
    }
    *last_authorization_status = current_status;

    status_payload_for_authorization(event_store, reason, current_status).map(|mut status| {
      if !granted && status.reason.is_none() && !status.authorized {
        status.reason = Some("Calendar access was not granted.".to_string());
      }
      status
    })
  })();
  callback.call(status, ThreadsafeFunctionCallMode::NonBlocking);
}

fn require_authorized(raw_status: isize) -> Result<()> {
  if is_authorized(raw_status) {
    Ok(())
  } else {
    Err(Error::new(
      Status::GenericFailure,
      format!(
        "Calendar access is not granted: {}.",
        authorization_status_text(raw_status)
      ),
    ))
  }
}

fn calendar_count(event_store: *mut AnyObject) -> Result<u32> {
  let calendars: *mut AnyObject = unsafe { msg_send![event_store, calendarsForEntityType: EK_ENTITY_TYPE_EVENT] };
  Ok(unsafe { array_len(calendars) } as u32)
}

unsafe fn array_len(array: *mut AnyObject) -> usize {
  if array.is_null() {
    0
  } else {
    unsafe { msg_send![array, count] }
  }
}

unsafe fn array_object(array: *mut AnyObject, index: usize) -> *mut AnyObject {
  if array.is_null() {
    ptr::null_mut()
  } else {
    unsafe { msg_send![array, objectAtIndex: index] }
  }
}

#[napi]
pub fn list_apple_calendars() -> Result<Vec<AppleCalendar>> {
  event_store_worker()?.list_calendars()
}

fn list_calendars(
  event_store: *mut AnyObject,
  last_authorization_status: &mut isize,
  pending_request: &mut Option<PendingAccessRequest>,
) -> Result<Vec<AppleCalendar>> {
  let raw_status = refresh_authorization_status(event_store, last_authorization_status, pending_request)?;
  require_authorized(raw_status)?;
  let calendars: *mut AnyObject = unsafe { msg_send![event_store, calendarsForEntityType: EK_ENTITY_TYPE_EVENT] };
  let count = unsafe { array_len(calendars) };
  let mut output = Vec::with_capacity(count);

  for index in 0..count {
    let calendar = unsafe { array_object(calendars, index) };
    if calendar.is_null() {
      continue;
    }
    output.push(calendar_payload(calendar));
  }

  Ok(output)
}

fn calendar_payload(calendar: *mut AnyObject) -> AppleCalendar {
  let allows_content_modifications: Bool = unsafe { msg_send![calendar, allowsContentModifications] };

  AppleCalendar {
    allows_content_modifications: Some(allows_content_modifications.as_bool()),
    color: None,
    id: unsafe { string_property(calendar, "calendarIdentifier") }.unwrap_or_default(),
    title: unsafe { string_property(calendar, "title") }.unwrap_or_else(|| "Calendar".to_string()),
  }
}

#[napi]
pub fn list_apple_calendar_events(input: AppleCalendarEventsInput) -> Result<Vec<AppleCalendarEvent>> {
  event_store_worker()?.list_events(input)
}

fn list_events(
  event_store: *mut AnyObject,
  input: AppleCalendarEventsInput,
  last_authorization_status: &mut isize,
  pending_request: &mut Option<PendingAccessRequest>,
) -> Result<Vec<AppleCalendarEvent>> {
  let raw_status = refresh_authorization_status(event_store, last_authorization_status, pending_request)?;
  require_authorized(raw_status)?;
  let from = ns_date_from_iso(&input.from)?;
  let to = ns_date_from_iso(&input.to)?;
  let selected_ids = input
    .calendar_ids
    .unwrap_or_default()
    .into_iter()
    .filter(|id| !id.is_empty())
    .collect::<HashSet<_>>();

  let calendars: *mut AnyObject = unsafe { msg_send![event_store, calendarsForEntityType: EK_ENTITY_TYPE_EVENT] };
  let selected_calendars = if selected_ids.is_empty() {
    calendars
  } else {
    selected_calendar_array(calendars, &selected_ids)?
  };
  let predicate: *mut AnyObject = unsafe {
    msg_send![
      event_store,
      predicateForEventsWithStartDate: from,
      endDate: to,
      calendars: selected_calendars
    ]
  };
  let events: *mut AnyObject = unsafe { msg_send![event_store, eventsMatchingPredicate: predicate] };
  let count = unsafe { array_len(events) };
  let mut output = Vec::with_capacity(count);

  for index in 0..count {
    let event = unsafe { array_object(events, index) };
    if event.is_null() {
      continue;
    }
    output.push(event_payload(event));
  }

  output.sort_by(|left, right| {
    left
      .start_at
      .cmp(&right.start_at)
      .then_with(|| left.title.cmp(&right.title))
  });

  Ok(output)
}

fn selected_calendar_array(calendars: *mut AnyObject, selected_ids: &HashSet<String>) -> Result<*mut AnyObject> {
  let array_class = objective_c_class(c"NSMutableArray")?;
  let selected: *mut AnyObject = unsafe { msg_send![array_class, array] };
  let count = unsafe { array_len(calendars) };

  for index in 0..count {
    let calendar = unsafe { array_object(calendars, index) };
    let id = unsafe { string_property(calendar, "calendarIdentifier") };
    if id.as_ref().is_some_and(|id| selected_ids.contains(id)) {
      unsafe {
        let _: () = msg_send![selected, addObject: calendar];
      }
    }
  }

  Ok(selected)
}

fn ns_date_from_iso(value: &str) -> Result<*mut AnyObject> {
  let parsed = DateTime::parse_from_rfc3339(value)
    .map_err(|_| Error::new(Status::InvalidArg, format!("Invalid ISO date: {value}")))?;
  let seconds = parsed.timestamp_millis() as f64 / 1000.0;
  let date_class = objective_c_class(c"NSDate")?;
  let date: *mut AnyObject = unsafe { msg_send![date_class, dateWithTimeIntervalSince1970: seconds] };
  if date.is_null() {
    Err(Error::new(Status::GenericFailure, "Failed to create NSDate."))
  } else {
    Ok(date)
  }
}

unsafe fn date_to_iso(date: *mut AnyObject) -> Option<String> {
  if date.is_null() {
    return None;
  }
  let seconds: f64 = unsafe { msg_send![date, timeIntervalSince1970] };
  let millis = (seconds * 1000.0).round() as i64;
  DateTime::<Utc>::from_timestamp_millis(millis).map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn event_payload(event: *mut AnyObject) -> AppleCalendarEvent {
  let calendar: *mut AnyObject = unsafe { msg_send![event, calendar] };
  let event_id =
    unsafe { string_property(event, "eventIdentifier").or_else(|| string_property(event, "calendarItemIdentifier")) }
      .unwrap_or_default();
  let url = unsafe { url_property(event) };
  let location = unsafe { string_property(event, "location") };
  let notes = unsafe { string_property(event, "notes") };
  let start_date: *mut AnyObject = unsafe { msg_send![event, startDate] };
  let end_date: *mut AnyObject = unsafe { msg_send![event, endDate] };
  let start_at = unsafe { date_to_iso(start_date) }.unwrap_or_default();
  let end_at = unsafe { date_to_iso(end_date) }.unwrap_or_else(|| start_at.clone());
  let all_day: Bool = unsafe { msg_send![event, isAllDay] };
  let availability: isize = unsafe { msg_send![event, availability] };
  let status: isize = unsafe { msg_send![event, status] };
  let organizer = unsafe {
    let organizer: *mut AnyObject = msg_send![event, organizer];
    participant_payload(organizer)
  };
  let attendees = attendees_payload(event);
  let title = unsafe { string_property(event, "title") }.unwrap_or_default();

  AppleCalendarEvent {
    all_day: all_day.as_bool(),
    attendees,
    availability: availability_text(availability),
    calendar_color: None,
    calendar_id: unsafe { string_property(calendar, "calendarIdentifier") }.unwrap_or_default(),
    calendar_name: unsafe { string_property(calendar, "title") },
    end_at,
    external_event_id: Some(event_id.clone()).filter(|value| !value.is_empty()),
    id: event_id,
    location: location.clone(),
    meeting_url: first_meeting_link([url.as_deref(), location.as_deref(), notes.as_deref()]),
    notes,
    organizer,
    start_at,
    status: event_status_text(status),
    title,
    url,
  }
}

fn attendees_payload(event: *mut AnyObject) -> Option<Vec<AppleCalendarParticipant>> {
  let attendees: *mut AnyObject = unsafe { msg_send![event, attendees] };
  let count = unsafe { array_len(attendees) };
  if count == 0 {
    return None;
  }

  let mut output = Vec::with_capacity(count);
  for index in 0..count {
    let attendee = unsafe { array_object(attendees, index) };
    if let Some(payload) = unsafe { participant_payload(attendee) } {
      output.push(payload);
    }
  }

  if output.is_empty() { None } else { Some(output) }
}

unsafe fn participant_payload(participant: *mut AnyObject) -> Option<AppleCalendarParticipant> {
  if participant.is_null() {
    return None;
  }
  let status: isize = unsafe { msg_send![participant, participantStatus] };
  let role: isize = unsafe { msg_send![participant, participantRole] };
  let participant_type: isize = unsafe { msg_send![participant, participantType] };
  let url: *mut AnyObject = unsafe { msg_send![participant, URL] };
  let url = unsafe { url_to_string(url) };
  let email = url
    .as_deref()
    .and_then(|url| url.strip_prefix("mailto:").or_else(|| url.strip_prefix("MAILTO:")))
    .map(percent_decode_mailto);

  Some(AppleCalendarParticipant {
    email,
    name: unsafe { string_property(participant, "name") },
    role: Some(participant_role_text(role).to_string()),
    status: Some(participant_status_text(status).to_string()),
    type_: Some(participant_type_text(participant_type).to_string()),
    url,
  })
}

fn percent_decode_mailto(value: &str) -> String {
  let mut output = Vec::with_capacity(value.len());
  let bytes = value.as_bytes();
  let mut index = 0;
  while index < bytes.len() {
    if bytes[index] == b'%'
      && index + 2 < bytes.len()
      && let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16)
    {
      output.push(hex);
      index += 3;
      continue;
    }
    output.push(bytes[index]);
    index += 1;
  }
  String::from_utf8_lossy(&output).to_string()
}

fn availability_text(value: isize) -> Option<String> {
  match value {
    0 => None,
    1 => Some("busy"),
    2 => Some("free"),
    3 => Some("tentative"),
    4 => Some("unavailable"),
    _ => Some("unknown"),
  }
  .map(ToString::to_string)
}

fn event_status_text(value: isize) -> Option<String> {
  match value {
    0 => None,
    1 => Some("confirmed"),
    2 => Some("tentative"),
    3 => Some("canceled"),
    _ => Some("unknown"),
  }
  .map(ToString::to_string)
}

fn participant_status_text(value: isize) -> &'static str {
  match value {
    1 => "pending",
    2 => "accepted",
    3 => "declined",
    4 => "tentative",
    5 => "delegated",
    6 => "completed",
    7 => "in-process",
    _ => "unknown",
  }
}

fn participant_role_text(value: isize) -> &'static str {
  match value {
    1 => "required",
    2 => "optional",
    3 => "chair",
    4 => "non-participant",
    _ => "unknown",
  }
}

fn participant_type_text(value: isize) -> &'static str {
  match value {
    1 => "person",
    2 => "room",
    3 => "resource",
    4 => "group",
    _ => "unknown",
  }
}

fn first_meeting_link<const N: usize>(values: [Option<&str>; N]) -> Option<String> {
  let links = values.into_iter().flatten().flat_map(extract_links).collect::<Vec<_>>();
  links
    .iter()
    .find(|link| is_meeting_link(link))
    .cloned()
    .or_else(|| links.into_iter().next())
}

fn extract_links(value: &str) -> Vec<String> {
  value
    .split_whitespace()
    .filter_map(|part| {
      let trimmed = part.trim_matches(|character: char| character.is_whitespace() || "<>\"'(),.;]".contains(character));
      if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Some(trimmed.to_string())
      } else {
        None
      }
    })
    .collect()
}

fn is_meeting_link(link: &str) -> bool {
  let normalized = link.to_lowercase();
  [
    "zoom.us/",
    "meet.google.com/",
    "teams.microsoft.com/",
    "microsoft.com/l/meetup-join/",
    "webex.com/",
    "gotomeeting.com/",
    "bluejeans.com/",
    "whereby.com/",
    "chime.aws/",
    "ringcentral.com/",
    "around.co/",
    "slack.com/huddle",
  ]
  .iter()
  .any(|host| normalized.contains(host))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn fake_worker() -> EventStoreWorker {
    EventStoreWorker::spawn(|receiver, ready| {
      ready.send(Ok(())).unwrap();
      while receiver.recv().is_ok() {}
    })
    .unwrap()
  }

  fn wait_for_exit(worker: &EventStoreWorker) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !worker.thread.is_finished() {
      assert!(Instant::now() < deadline, "fake worker did not exit");
      thread::yield_now();
    }
  }

  #[test]
  fn worker_start_failure_is_retryable() {
    let cache = Mutex::new(None);
    assert!(cached_event_store_worker(&cache, || Err("thread spawn failed".to_string())).is_err());
    assert!(cache.lock().unwrap().is_none());
    let worker = cached_event_store_worker(&cache, || Ok(fake_worker())).unwrap();
    worker.wait_until_ready(Duration::from_secs(2)).unwrap();
    let reused = cached_event_store_worker(&cache, || panic!("live worker must be reused")).unwrap();
    assert!(Arc::ptr_eq(&worker, &reused));
  }

  #[test]
  fn exited_worker_is_replaced() {
    let old = Arc::new(EventStoreWorker::spawn(|_, _| {}).unwrap());
    wait_for_exit(&old);
    let cache = Mutex::new(Some(Arc::clone(&old)));
    let replacement = cached_event_store_worker(&cache, || Ok(fake_worker())).unwrap();
    assert!(!Arc::ptr_eq(&old, &replacement));
  }

  #[test]
  fn startup_timeouts_retain_one_initializer_and_accept_late_readiness() {
    let cache = Mutex::new(None);
    let (release, initialize) = mpsc::sync_channel(1);
    let worker = cached_event_store_worker(&cache, || {
      EventStoreWorker::spawn(move |receiver, ready| {
        initialize.recv().unwrap();
        ready.send(Ok(())).unwrap();
        while receiver.recv().is_ok() {}
      })
    })
    .unwrap();
    for _ in 0..3 {
      let reused = cached_event_store_worker(&cache, || panic!("initializer must stay single-flight")).unwrap();
      assert!(Arc::ptr_eq(&worker, &reused));
      let error = reused.wait_until_ready(Duration::ZERO).unwrap_err();
      assert!(error.reason.contains("initialization is still in progress"));
      assert!(!reused.thread.is_finished());
    }
    thread::scope(|scope| {
      let calls = (0..8)
        .map(|_| {
          scope.spawn(|| {
            let reused =
              cached_event_store_worker(&cache, || panic!("concurrent retry started another worker")).unwrap();
            assert!(Arc::ptr_eq(&worker, &reused));
            assert!(reused.wait_until_ready(Duration::ZERO).is_err());
          })
        })
        .collect::<Vec<_>>();
      for call in calls {
        call.join().unwrap();
      }
    });
    release.send(()).unwrap();
    worker.wait_until_ready(Duration::from_secs(2)).unwrap();
    worker.wait_until_ready(Duration::ZERO).unwrap();
    let reused = cached_event_store_worker(&cache, || panic!("ready worker must be reused")).unwrap();
    assert!(Arc::ptr_eq(&worker, &reused));
  }

  #[test]
  fn concurrent_startup_waits_do_not_queue_behind_another_waiter() {
    let worker = fake_worker();
    let waiting = worker.startup.lock().unwrap();
    assert_eq!(
      worker.wait_until_ready(Duration::ZERO).unwrap_err().reason,
      "Apple calendar worker initialization is still in progress."
    );
    drop(waiting);
    worker.wait_until_ready(Duration::from_secs(2)).unwrap();
  }

  #[test]
  fn failed_initializer_is_retained_until_exit_then_retried() {
    let cache = Mutex::new(None);
    let (release, exit) = mpsc::sync_channel(1);
    let worker = cached_event_store_worker(&cache, || {
      EventStoreWorker::spawn(move |_, ready| {
        ready.send(Err("synthetic initialization failure".to_string())).unwrap();
        exit.recv().unwrap();
      })
    })
    .unwrap();
    for _ in 0..3 {
      assert_eq!(
        worker.wait_until_ready(Duration::from_secs(2)).unwrap_err().reason,
        "synthetic initialization failure"
      );
      let reused = cached_event_store_worker(&cache, || panic!("initializer has not exited")).unwrap();
      assert!(Arc::ptr_eq(&worker, &reused));
    }
    release.send(()).unwrap();
    wait_for_exit(&worker);
    let replacement = cached_event_store_worker(&cache, || Ok(fake_worker())).unwrap();
    replacement.wait_until_ready(Duration::from_secs(2)).unwrap();
    assert!(!Arc::ptr_eq(&worker, &replacement));
  }

  #[test]
  fn disconnected_initializer_is_retained_until_exit() {
    let cache = Mutex::new(None);
    let (release, exit) = mpsc::sync_channel(1);
    let worker = cached_event_store_worker(&cache, || {
      EventStoreWorker::spawn(move |receiver, ready| {
        drop(receiver);
        drop(ready);
        exit.recv().unwrap();
      })
    })
    .unwrap();
    assert_eq!(
      worker.wait_until_ready(Duration::from_secs(2)).unwrap_err().reason,
      "Apple calendar worker disconnected during startup."
    );
    let reused = cached_event_store_worker(&cache, || panic!("disconnected initializer has not exited")).unwrap();
    assert!(Arc::ptr_eq(&worker, &reused));
    release.send(()).unwrap();
    wait_for_exit(&worker);
    let replacement = cached_event_store_worker(&cache, || Ok(fake_worker())).unwrap();
    replacement.wait_until_ready(Duration::from_secs(2)).unwrap();
    assert!(!Arc::ptr_eq(&worker, &replacement));
  }

  #[test]
  fn panicked_initializer_is_replaced_without_poisoning_cache() {
    let cache = Mutex::new(None);
    let worker = cached_event_store_worker(&cache, || {
      EventStoreWorker::spawn(|_, _| panic!("synthetic startup panic"))
    })
    .unwrap();
    wait_for_exit(&worker);
    assert!(worker.wait_until_ready(Duration::ZERO).is_err());
    let replacement = cached_event_store_worker(&cache, || Ok(fake_worker())).unwrap();
    replacement.wait_until_ready(Duration::from_secs(2)).unwrap();
    assert!(!Arc::ptr_eq(&worker, &replacement));
  }

  #[test]
  fn panicked_ready_worker_is_replaced() {
    let cache = Mutex::new(None);
    let (release, fail) = mpsc::sync_channel(1);
    let worker = cached_event_store_worker(&cache, || {
      EventStoreWorker::spawn(move |_, ready| {
        ready.send(Ok(())).unwrap();
        fail.recv().unwrap();
        panic!("synthetic worker panic");
      })
    })
    .unwrap();
    worker.wait_until_ready(Duration::from_secs(2)).unwrap();
    release.send(()).unwrap();
    wait_for_exit(&worker);
    let replacement = cached_event_store_worker(&cache, || Ok(fake_worker())).unwrap();
    replacement.wait_until_ready(Duration::from_secs(2)).unwrap();
    assert!(!Arc::ptr_eq(&worker, &replacement));
  }

  #[test]
  fn concurrent_initialization_shares_one_worker() {
    let cache = Arc::new(Mutex::new(None));
    let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let calls = (0..8)
      .map(|_| {
        let cache = Arc::clone(&cache);
        let starts = Arc::clone(&starts);
        thread::spawn(move || {
          cached_event_store_worker(&cache, || {
            starts.fetch_add(1, Ordering::SeqCst);
            Ok(fake_worker())
          })
          .unwrap()
        })
      })
      .collect::<Vec<_>>();
    let workers = calls.into_iter().map(|call| call.join().unwrap()).collect::<Vec<_>>();
    assert_eq!(starts.load(Ordering::SeqCst), 1);
    assert!(workers.iter().all(|worker| Arc::ptr_eq(worker, &workers[0])));
  }

  #[test]
  fn late_completion_retains_callback_and_ignores_stale_request_ids() {
    let completion = Arc::new(());
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let callback_calls = Arc::clone(&calls);
    let mut pending = Some(PendingAccessRequest {
      callback: move || {
        callback_calls.fetch_add(1, Ordering::SeqCst);
      },
      completion: Arc::clone(&completion),
      request_id: 8,
    });
    // No elapsed-time transition can drop the request. Only its matching OS
    // completion takes ownership, even after the JS wait has ended.
    assert!(PendingAccessRequest::take_completed(&mut pending, 7).is_none());
    assert!(pending.is_some());
    assert_eq!(Arc::strong_count(&completion), 2);
    let completed = PendingAccessRequest::take_completed(&mut pending, 8).unwrap();
    (completed.callback)();
    drop(completed);
    assert!(pending.is_none());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(Arc::strong_count(&completion), 1);
    assert!(PendingAccessRequest::take_completed(&mut pending, 8).is_none());
  }

  #[test]
  fn unaccepted_request_cannot_start_an_os_prompt() {
    let (acceptance, receiver) = mpsc::sync_channel(1);
    let control = CommandControl {
      acceptance: receiver,
      cancelled: Arc::new(AtomicBool::new(false)),
      deadline: Instant::now() + WORKER_RESPONSE_TIMEOUT,
    };
    drop(acceptance);
    assert!(!control.wait_for_acceptance());
  }

  #[test]
  fn cancellation_wins_even_if_acceptance_was_queued() {
    let (acceptance, receiver) = mpsc::sync_channel(1);
    acceptance.send(()).unwrap();
    let control = CommandControl {
      acceptance: receiver,
      cancelled: Arc::new(AtomicBool::new(true)),
      deadline: Instant::now() + WORKER_RESPONSE_TIMEOUT,
    };
    assert!(control.is_cancelled_or_expired());
    assert!(!control.wait_for_acceptance());
  }

  #[test]
  fn expired_commands_are_rejected_but_late_completions_are_not() {
    let (_acceptance, receiver) = mpsc::sync_channel(1);
    let (response, result) = mpsc::sync_channel(1);
    let command = EventStoreCommand::GetStatus {
      control: CommandControl {
        acceptance: receiver,
        cancelled: Arc::new(AtomicBool::new(false)),
        deadline: Instant::now() - Duration::from_secs(1),
      },
      reason: None,
      response,
    };
    assert!(command.is_cancelled_or_expired());
    command.reject_cancelled();
    assert!(result.recv().unwrap().is_err());
    assert!(
      !EventStoreCommand::AccessCompleted {
        granted: true,
        reason: None,
        request_id: 1,
      }
      .is_cancelled_or_expired()
    );
  }
}
