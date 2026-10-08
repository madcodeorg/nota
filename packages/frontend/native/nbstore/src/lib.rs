pub mod blob;
pub mod blob_sync;
pub mod doc;
pub mod doc_sync;
pub mod error;
pub mod history;
pub mod indexer;
pub mod indexer_sync;
pub mod pool;
pub mod storage;

use chrono::NaiveDateTime;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use pool::{Ref, SqliteDocStoragePool};
use storage::SqliteDocStorage;

#[cfg(feature = "use-as-lib")]
type Result<T> = anyhow::Result<T>;

#[cfg(not(feature = "use-as-lib"))]
type Result<T> = napi::Result<T>;

#[cfg(not(feature = "use-as-lib"))]
impl From<error::Error> for napi::Error {
  fn from(err: error::Error) -> Self {
    napi::Error::new(napi::Status::GenericFailure, err.to_string())
  }
}

#[cfg(feature = "use-as-lib")]
pub type Data = Vec<u8>;

#[cfg(not(feature = "use-as-lib"))]
pub type Data = Uint8Array;

#[napi(object)]
pub struct DocUpdate {
  pub doc_id: String,
  pub timestamp: NaiveDateTime,
  #[napi(ts_type = "Uint8Array")]
  pub bin: Data,
}

#[napi(object)]
pub struct DocRecord {
  pub doc_id: String,
  #[napi(ts_type = "Uint8Array")]
  pub bin: Data,
  pub timestamp: NaiveDateTime,
}

#[napi(object)]
pub struct DocHistory {
  pub doc_id: String,
  #[napi(ts_type = "Array<Uint8Array>")]
  pub bins: Vec<Data>,
  pub timestamp: NaiveDateTime,
}

#[napi(object)]
pub struct DocHistoryStorageUsage {
  pub versions: i64,
  pub history_bytes: i64,
  pub retained_removed_blob_bytes: i64,
}

#[napi(object)]
pub struct DocHistoryCleanupProtection {
  pub expected_doc_clocks: Vec<DocClock>,
  pub protected_blob_keys: Vec<String>,
  pub preserve_all_removed_blobs: bool,
}

#[derive(Debug)]
#[napi(object)]
pub struct DocClock {
  pub doc_id: String,
  pub timestamp: NaiveDateTime,
}

#[derive(Debug)]
#[napi(object)]
pub struct DocIndexedClock {
  pub doc_id: String,
  pub timestamp: NaiveDateTime,
  pub indexer_version: i64,
}

#[napi(object)]
pub struct SetBlob {
  pub key: String,
  #[napi(ts_type = "Uint8Array")]
  pub data: Data,
  pub mime: String,
}

#[napi(object)]
pub struct Blob {
  pub key: String,
  #[napi(ts_type = "Uint8Array")]
  pub data: Data,
  pub mime: String,
  pub size: i64,
  pub created_at: NaiveDateTime,
}

#[napi(object)]
pub struct ListedBlob {
  pub key: String,
  pub size: i64,
  pub mime: String,
  pub created_at: NaiveDateTime,
}

#[napi]
pub struct DocStoragePool {
  pool: SqliteDocStoragePool,
}

#[napi]
impl DocStoragePool {
  #[napi(constructor)]
  pub fn new() -> Result<Self> {
    Ok(Self {
      pool: SqliteDocStoragePool::default(),
    })
  }

  async fn get(&self, universal_id: String) -> Result<Ref<SqliteDocStorage>> {
    Ok(self.pool.get(universal_id).await?)
  }

  #[napi]
  /// Initialize the database and run migrations.
  pub async fn connect(&self, universal_id: String, path: String) -> Result<()> {
    self.pool.connect(universal_id, path).await?;
    Ok(())
  }

  #[napi]
  pub async fn disconnect(&self, universal_id: String) -> Result<()> {
    self.pool.disconnect(universal_id).await?;
    Ok(())
  }

  #[napi]
  pub async fn checkpoint(&self, universal_id: String) -> Result<()> {
    self.pool.get(universal_id).await?.checkpoint().await?;
    Ok(())
  }

  /// Create and verify a consistent workspace backup, then atomically publish
  /// it.
  #[napi]
  pub async fn backup(&self, universal_id: String, destination: String) -> Result<()> {
    self.get(universal_id).await?.backup(destination).await?;
    Ok(())
  }

  #[napi]
  pub async fn set_space_id(&self, universal_id: String, space_id: String) -> Result<()> {
    self.get(universal_id).await?.set_space_id(space_id).await?;
    Ok(())
  }

  #[napi]
  pub async fn push_update(&self, universal_id: String, doc_id: String, update: Uint8Array) -> Result<NaiveDateTime> {
    Ok(self.get(universal_id).await?.push_update(doc_id, update).await?)
  }

  #[napi]
  pub async fn get_doc_snapshot(&self, universal_id: String, doc_id: String) -> Result<Option<DocRecord>> {
    Ok(self.get(universal_id).await?.get_doc_snapshot(doc_id).await?)
  }

  #[napi]
  pub async fn list_doc_histories(
    &self,
    universal_id: String,
    doc_id: String,
    before: Option<NaiveDateTime>,
    limit: u32,
  ) -> Result<Vec<DocClock>> {
    Ok(
      self
        .get(universal_id)
        .await?
        .list_doc_histories(doc_id, before, limit)
        .await?,
    )
  }

  #[napi]
  pub async fn get_doc_history(
    &self,
    universal_id: String,
    doc_id: String,
    timestamp: NaiveDateTime,
  ) -> Result<Option<DocHistory>> {
    Ok(self.get(universal_id).await?.get_doc_history(doc_id, timestamp).await?)
  }

  #[napi]
  pub async fn create_doc_history(&self, universal_id: String, snapshot: DocRecord) -> Result<()> {
    Ok(self.get(universal_id).await?.create_doc_history(snapshot).await?)
  }

  #[napi]
  pub async fn delete_doc_history(&self, universal_id: String, doc_id: String, timestamp: NaiveDateTime) -> Result<()> {
    Ok(
      self
        .get(universal_id)
        .await?
        .delete_doc_history(doc_id, timestamp)
        .await?,
    )
  }

  #[napi]
  pub async fn get_doc_history_storage_usage(&self, universal_id: String) -> Result<DocHistoryStorageUsage> {
    Ok(self.get(universal_id).await?.get_doc_history_storage_usage().await?)
  }

  #[napi]
  pub async fn clear_doc_histories(&self, universal_id: String, protection: DocHistoryCleanupProtection) -> Result<()> {
    Ok(self.get(universal_id).await?.clear_doc_histories(protection).await?)
  }

  #[napi]
  pub async fn push_update_for_rollback(
    &self,
    universal_id: String,
    doc_id: String,
    update: Uint8Array,
    expected_timestamp: NaiveDateTime,
  ) -> Result<NaiveDateTime> {
    Ok(
      self
        .get(universal_id)
        .await?
        .push_update_for_rollback(doc_id, update, expected_timestamp)
        .await?,
    )
  }

  #[napi]
  pub async fn set_doc_snapshot(&self, universal_id: String, snapshot: DocRecord) -> Result<bool> {
    Ok(self.get(universal_id).await?.set_doc_snapshot(snapshot).await?)
  }

  #[napi]
  pub async fn get_doc_updates(&self, universal_id: String, doc_id: String) -> Result<Vec<DocUpdate>> {
    Ok(self.get(universal_id).await?.get_doc_updates(doc_id).await?)
  }

  #[napi]
  pub async fn mark_updates_merged(
    &self,
    universal_id: String,
    doc_id: String,
    updates: Vec<NaiveDateTime>,
  ) -> Result<u32> {
    Ok(
      self
        .get(universal_id)
        .await?
        .mark_updates_merged(doc_id, updates)
        .await?,
    )
  }

  #[napi]
  pub async fn delete_doc(&self, universal_id: String, doc_id: String) -> Result<()> {
    self.get(universal_id).await?.delete_doc(doc_id).await?;
    Ok(())
  }

  #[napi]
  pub async fn get_doc_clocks(&self, universal_id: String, after: Option<NaiveDateTime>) -> Result<Vec<DocClock>> {
    Ok(self.get(universal_id).await?.get_doc_clocks(after).await?)
  }

  #[napi]
  pub async fn get_doc_clock(&self, universal_id: String, doc_id: String) -> Result<Option<DocClock>> {
    Ok(self.get(universal_id).await?.get_doc_clock(doc_id).await?)
  }

  #[napi]
  pub async fn get_doc_indexed_clock(&self, universal_id: String, doc_id: String) -> Result<Option<DocIndexedClock>> {
    Ok(self.get(universal_id).await?.get_doc_indexed_clock(doc_id).await?)
  }

  #[napi]
  pub async fn set_doc_indexed_clock(
    &self,
    universal_id: String,
    doc_id: String,
    indexed_clock: NaiveDateTime,
    indexer_version: i64,
  ) -> Result<()> {
    self
      .get(universal_id)
      .await?
      .set_doc_indexed_clock(doc_id, indexed_clock, indexer_version)
      .await?;
    Ok(())
  }

  #[napi]
  pub async fn clear_doc_indexed_clock(&self, universal_id: String, doc_id: String) -> Result<()> {
    self.get(universal_id).await?.clear_doc_indexed_clock(doc_id).await?;
    Ok(())
  }

  #[napi(async_runtime)]
  pub async fn get_blob(&self, universal_id: String, key: String) -> Result<Option<Blob>> {
    Ok(self.get(universal_id).await?.get_blob(key).await?)
  }

  #[napi]
  pub async fn set_blob(&self, universal_id: String, blob: SetBlob) -> Result<()> {
    self.get(universal_id).await?.set_blob(blob).await?;
    Ok(())
  }

  #[napi]
  pub async fn delete_blob(&self, universal_id: String, key: String, permanently: bool) -> Result<()> {
    self.get(universal_id).await?.delete_blob(key, permanently).await?;
    Ok(())
  }

  #[napi]
  pub async fn release_blobs(&self, universal_id: String) -> Result<()> {
    self.get(universal_id).await?.release_blobs().await?;
    Ok(())
  }

  #[napi]
  pub async fn list_blobs(&self, universal_id: String) -> Result<Vec<ListedBlob>> {
    Ok(self.get(universal_id).await?.list_blobs().await?)
  }

  #[napi]
  pub async fn get_peer_remote_clocks(&self, universal_id: String, peer: String) -> Result<Vec<DocClock>> {
    Ok(self.get(universal_id).await?.get_peer_remote_clocks(peer).await?)
  }

  #[napi]
  pub async fn get_peer_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
  ) -> Result<Option<DocClock>> {
    Ok(
      self
        .get(universal_id)
        .await?
        .get_peer_remote_clock(peer, doc_id)
        .await?,
    )
  }

  #[napi]
  pub async fn set_peer_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
    clock: NaiveDateTime,
  ) -> Result<()> {
    self
      .get(universal_id)
      .await?
      .set_peer_remote_clock(peer, doc_id, clock)
      .await?;
    Ok(())
  }

  #[napi]
  pub async fn get_peer_pulled_remote_clocks(&self, universal_id: String, peer: String) -> Result<Vec<DocClock>> {
    Ok(
      self
        .get(universal_id)
        .await?
        .get_peer_pulled_remote_clocks(peer)
        .await?,
    )
  }

  #[napi]
  pub async fn get_peer_pulled_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
  ) -> Result<Option<DocClock>> {
    Ok(
      self
        .get(universal_id)
        .await?
        .get_peer_pulled_remote_clock(peer, doc_id)
        .await?,
    )
  }

  #[napi]
  pub async fn set_peer_pulled_remote_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
    clock: NaiveDateTime,
  ) -> Result<()> {
    self
      .get(universal_id)
      .await?
      .set_peer_pulled_remote_clock(peer, doc_id, clock)
      .await?;
    Ok(())
  }

  #[napi]
  pub async fn get_peer_pushed_clocks(&self, universal_id: String, peer: String) -> Result<Vec<DocClock>> {
    Ok(self.get(universal_id).await?.get_peer_pushed_clocks(peer).await?)
  }

  #[napi]
  pub async fn get_peer_pushed_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
  ) -> Result<Option<DocClock>> {
    Ok(
      self
        .get(universal_id)
        .await?
        .get_peer_pushed_clock(peer, doc_id)
        .await?,
    )
  }

  #[napi]
  pub async fn set_peer_pushed_clock(
    &self,
    universal_id: String,
    peer: String,
    doc_id: String,
    clock: NaiveDateTime,
  ) -> Result<()> {
    self
      .get(universal_id)
      .await?
      .set_peer_pushed_clock(peer, doc_id, clock)
      .await?;
    Ok(())
  }

  #[napi]
  pub async fn clear_clocks(&self, universal_id: String) -> Result<()> {
    self.get(universal_id).await?.clear_clocks().await?;
    Ok(())
  }

  #[napi]
  pub async fn set_blob_uploaded_at(
    &self,
    universal_id: String,
    peer: String,
    blob_id: String,
    uploaded_at: Option<NaiveDateTime>,
  ) -> Result<()> {
    self
      .get(universal_id)
      .await?
      .set_blob_uploaded_at(peer, blob_id, uploaded_at)
      .await?;
    Ok(())
  }

  #[napi]
  pub async fn get_blob_uploaded_at(
    &self,
    universal_id: String,
    peer: String,
    blob_id: String,
  ) -> Result<Option<NaiveDateTime>> {
    let result = self
      .get(universal_id)
      .await?
      .get_blob_uploaded_at(peer, blob_id)
      .await?;

    Ok(result)
  }

  #[napi]
  pub async fn fts_add_document(
    &self,
    id: String,
    index_name: String,
    doc_id: String,
    text: String,
    index: bool,
  ) -> Result<()> {
    let storage = self.pool.get(id).await?;
    storage.fts_add(&index_name, &doc_id, &text, index).await?;
    Ok(())
  }

  #[napi]
  pub async fn fts_flush_index(&self, id: String) -> Result<()> {
    let storage = self.pool.get(id).await?;
    storage.flush_index().await?;
    Ok(())
  }

  #[napi]
  pub async fn fts_index_version(&self) -> Result<u32> {
    Ok(SqliteDocStorage::index_version())
  }

  #[napi]
  pub async fn fts_delete_document(&self, id: String, index_name: String, doc_id: String) -> Result<()> {
    let storage = self.pool.get(id).await?;
    storage.fts_delete(&index_name, &doc_id).await?;
    Ok(())
  }

  #[napi]
  pub async fn fts_get_document(&self, id: String, index_name: String, doc_id: String) -> Result<Option<String>> {
    let storage = self.pool.get(id).await?;
    Ok(storage.fts_get(&index_name, &doc_id).await?)
  }

  #[napi]
  pub async fn fts_search(
    &self,
    id: String,
    index_name: String,
    query: String,
  ) -> Result<Vec<indexer::NativeSearchHit>> {
    let storage = self.pool.get(id).await?;
    Ok(storage.fts_search(&index_name, &query).await?)
  }

  #[napi]
  pub async fn fts_get_matches(
    &self,
    id: String,
    index_name: String,
    doc_id: String,
    query: String,
  ) -> Result<Vec<indexer::NativeMatch>> {
    let storage = self.pool.get(id).await?;
    Ok(storage.fts_get_matches(&index_name, &doc_id, &query).await?)
  }
}

#[napi]
pub struct DocStorage {
  storage: SqliteDocStorage,
}

#[napi]
impl DocStorage {
  #[napi(constructor, async_runtime)]
  pub fn new(path: String) -> Self {
    Self {
      storage: SqliteDocStorage::new(path),
    }
  }

  #[napi]
  pub async fn validate(&self) -> Result<bool> {
    Ok(self.storage.validate().await?)
  }

  #[napi]
  pub async fn set_space_id(&self, space_id: String) -> Result<()> {
    let result: error::Result<()> = async {
      self.storage.connect().await?;
      self.storage.set_space_id(space_id).await?;
      // Restore publishes only the main database file. An idle reader can
      // leave committed identity changes in the WAL after the writer closes.
      // SQLite reports a busy checkpoint in its result, not as a SQL error.
      let (busy, log_frames, checkpointed_frames): (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE);")
        .fetch_one(&self.storage.pool)
        .await?;
      if busy != 0 || log_frames != checkpointed_frames {
        return Err(error::Error::Backup(
          "The restored workspace checkpoint is busy or incomplete".into(),
        ));
      }
      Ok(())
    }
    .await;
    self.storage.close().await;
    result?;
    Ok(())
  }
}

#[cfg(all(test, feature = "use-as-lib"))]
mod restore_tests {
  use std::{path::PathBuf, time::Duration};

  use chrono::Utc;
  use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

  use super::{DocRecord, DocStorage, SqliteDocStorage};

  async fn restore_fixture() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let source = SqliteDocStorage::new(directory.path().join("source.db").to_str().unwrap().into());
    source.connect().await.unwrap();
    source.set_space_id("original-workspace".into()).await.unwrap();
    source
      .set_doc_snapshot(DocRecord {
        doc_id: "original-workspace".into(),
        bin: vec![0, 0],
        timestamp: Utc::now().naive_utc(),
      })
      .await
      .unwrap();
    let staging = directory.path().join("storage.db.importing");
    source.backup(staging.to_str().unwrap().into()).await.unwrap();
    source.close().await;
    let staging_storage = SqliteDocStorage::new(staging.to_str().unwrap().into());
    staging_storage.connect().await.unwrap();
    staging_storage.close().await;
    (directory, staging)
  }

  #[tokio::test]
  async fn standalone_identity_migration_persists_without_the_wal() {
    let (directory, staging) = restore_fixture().await;
    // An idle reader prevents the writer from being the final connection.
    // Closing the writer alone therefore cannot ensure a checkpoint.
    let reader = SqlitePoolOptions::new()
      .max_connections(1)
      .connect_with(SqliteConnectOptions::new().filename(&staging).read_only(true))
      .await
      .unwrap();
    sqlx::query("SELECT doc_id FROM snapshots")
      .fetch_all(&reader)
      .await
      .unwrap();
    let storage = DocStorage::new(staging.to_str().unwrap().into());
    storage.set_space_id("restored-workspace".into()).await.unwrap();
    assert!(storage.storage.is_closed());

    // Publication moves only the main file. Recovery must not require its
    // old staging WAL to retain the migrated root document.
    let published = directory.path().join("published.db");
    std::fs::copy(&staging, &published).unwrap();
    let restored = SqliteDocStorage::new(published.to_str().unwrap().into());
    restored.connect().await.unwrap();
    assert!(
      restored
        .get_doc_snapshot("restored-workspace".into())
        .await
        .unwrap()
        .is_some()
    );
    assert!(
      restored
        .get_doc_snapshot("original-workspace".into())
        .await
        .unwrap()
        .is_none()
    );
    restored.close().await;
    reader.close().await;
  }

  #[tokio::test]
  async fn standalone_identity_migration_rejects_a_busy_checkpoint_and_closes() {
    let (_directory, staging) = restore_fixture().await;
    let reader = SqlitePoolOptions::new()
      .max_connections(1)
      .connect_with(SqliteConnectOptions::new().filename(&staging).read_only(true))
      .await
      .unwrap();
    let mut transaction = reader.begin().await.unwrap();
    sqlx::query("SELECT doc_id FROM snapshots")
      .fetch_all(&mut *transaction)
      .await
      .unwrap();
    let mut storage = DocStorage::new(staging.to_str().unwrap().into());
    storage.storage.pool = SqlitePoolOptions::new().max_connections(1).connect_lazy_with(
      SqliteConnectOptions::new()
        .filename(&staging)
        .foreign_keys(false)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_millis(20)),
    );

    let error = storage.set_space_id("restored-workspace".into()).await.unwrap_err();
    assert!(error.to_string().contains("checkpoint"));
    assert!(storage.storage.is_closed());
    transaction.rollback().await.unwrap();
    reader.close().await;
  }

  #[tokio::test]
  async fn standalone_identity_migration_closes_after_connect_failure() {
    let directory = tempfile::tempdir().unwrap();
    let invalid = directory.path().join("invalid.db");
    std::fs::write(&invalid, b"invalid database").unwrap();
    let storage = DocStorage::new(invalid.to_str().unwrap().into());
    assert!(storage.set_space_id("restored-workspace".into()).await.is_err());
    assert!(storage.storage.is_closed());
  }
}

#[cfg(all(test, not(feature = "use-as-lib")))]
mod tests {
  use super::error;

  #[test]
  fn napi_error_mapping_preserves_reason() {
    let err: napi::Error = error::Error::InvalidOperation.into();
    assert_eq!(err.status, napi::Status::GenericFailure);
    assert!(err.reason.contains("Invalid operation"));
  }

  #[test]
  fn napi_error_mapping_connection_in_progress() {
    let err: napi::Error = error::Error::ConnectionInProgress.into();
    assert_eq!(err.status, napi::Status::GenericFailure);
    assert!(err.reason.contains("Connection in progress"));
  }
}
