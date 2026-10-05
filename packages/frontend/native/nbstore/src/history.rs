use chrono::NaiveDateTime;
use sqlx::{Row, SqliteConnection};
use std::collections::{HashMap, HashSet};

use super::{
  Data, DocClock, DocHistory, DocHistoryCleanupProtection, DocHistoryStorageUsage, DocRecord,
  error::{Error, Result},
  storage::SqliteDocStorage,
};

const HISTORY_INTERVAL_MS: i64 = 5 * 60 * 1000;
const HISTORY_LIMIT: usize = 50;
const HISTORY_MAX_BYTES: usize = 50 * 1024 * 1024;

// An immutable bundle carries every byte needed to reconstruct this version.
// Yjs merging remains in the existing JS adapter, so canonical writes do not
// depend on a second CRDT implementation understanding every editor type.
fn encode_bundle(bins: Vec<Vec<u8>>) -> Result<Vec<u8>> {
  bincode::encode_to_vec(bins, bincode::config::standard()).map_err(|error| Error::Serialization(error.to_string()))
}

fn decode_bundle(bytes: &[u8]) -> Result<Vec<Data>> {
  let (bins, _): (Vec<Vec<u8>>, usize) = bincode::decode_from_slice(bytes, bincode::config::standard())
    .map_err(|error| Error::Serialization(error.to_string()))?;
  Ok(bins.into_iter().map(Into::into).collect())
}

pub(super) async fn capture_history(
  tx: &mut SqliteConnection,
  doc_id: &str,
  timestamp: NaiveDateTime,
  force: bool,
) -> Result<()> {
  let latest = sqlx::query("SELECT timestamp FROM doc_history WHERE doc_id = ? ORDER BY timestamp DESC LIMIT 1")
    .bind(doc_id)
    .fetch_optional(&mut *tx)
    .await?;
  if !force
    && latest.is_some_and(|row| {
      let previous: NaiveDateTime = row.get("timestamp");
      (timestamp - previous).num_milliseconds() < HISTORY_INTERVAL_MS
    })
  {
    return Ok(());
  }
  let snapshot = sqlx::query("SELECT data FROM snapshots WHERE doc_id = ?")
    .bind(doc_id)
    .fetch_optional(&mut *tx)
    .await?;
  let mut bins: Vec<Vec<u8>> = snapshot.into_iter().map(|row| row.get("data")).collect();
  let updates = sqlx::query("SELECT data FROM updates WHERE doc_id = ? ORDER BY created_at")
    .bind(doc_id)
    .fetch_all(&mut *tx)
    .await?;
  bins.extend(updates.into_iter().map(|row| row.get::<Vec<u8>, _>("data")));
  if bins.is_empty() {
    return Ok(());
  }
  insert_history(tx, doc_id, timestamp, encode_bundle(bins)?).await
}

async fn insert_history(
  tx: &mut SqliteConnection,
  doc_id: &str,
  timestamp: NaiveDateTime,
  bytes: Vec<u8>,
) -> Result<()> {
  sqlx::query("INSERT OR IGNORE INTO doc_history (doc_id, timestamp, data) VALUES (?, ?, ?)")
    .bind(doc_id)
    .bind(timestamp)
    .bind(bytes)
    .execute(&mut *tx)
    .await?;
  let histories =
    sqlx::query("SELECT timestamp, length(data) AS size FROM doc_history WHERE doc_id = ? ORDER BY timestamp DESC")
      .bind(doc_id)
      .fetch_all(&mut *tx)
      .await?;
  let mut retained_bytes = 0usize;
  for (index, history) in histories.into_iter().enumerate() {
    retained_bytes += history.get::<i64, _>("size") as usize;
    // Keep two versions even if an oversized page exceeds the byte budget.
    if index >= 2 && (index >= HISTORY_LIMIT || retained_bytes > HISTORY_MAX_BYTES) {
      sqlx::query("DELETE FROM doc_history WHERE doc_id = ? AND timestamp = ?")
        .bind(doc_id)
        .bind(history.get::<NaiveDateTime, _>("timestamp"))
        .execute(&mut *tx)
        .await?;
    }
  }
  Ok(())
}

impl SqliteDocStorage {
  pub async fn get_doc_history_storage_usage(&self) -> Result<DocHistoryStorageUsage> {
    let mut tx = self.pool.begin().await?;
    let history = sqlx::query("SELECT count(*) AS versions, coalesce(sum(length(data)), 0) AS bytes FROM doc_history")
      .fetch_one(&mut *tx)
      .await?;
    let blobs = sqlx::query("SELECT coalesce(sum(length(data)), 0) AS bytes FROM blobs WHERE deleted_at IS NOT NULL")
      .fetch_one(&mut *tx)
      .await?;
    tx.commit().await?;
    Ok(DocHistoryStorageUsage {
      versions: history.get("versions"),
      history_bytes: history.get("bytes"),
      retained_removed_blob_bytes: blobs.get("bytes"),
    })
  }

  pub async fn clear_doc_histories(&self, protection: DocHistoryCleanupProtection) -> Result<()> {
    let mut tx = self.pool.begin().await?;
    // Acquiring the writer lock serializes this operation with history captures
    // and blob writes in every renderer process.
    sqlx::query("UPDATE clocks SET timestamp = timestamp")
      .execute(&mut *tx)
      .await?;
    let clocks = sqlx::query("SELECT doc_id, timestamp FROM clocks")
      .fetch_all(&mut *tx)
      .await?;
    let expected: HashMap<_, _> = protection
      .expected_doc_clocks
      .iter()
      .map(|clock| (clock.doc_id.as_str(), clock.timestamp.and_utc().timestamp_millis()))
      .collect();
    if clocks.len() != expected.len()
      || clocks.iter().any(|clock| {
        expected.get(clock.get::<String, _>("doc_id").as_str())
          != Some(&clock.get::<NaiveDateTime, _>("timestamp").and_utc().timestamp_millis())
      })
    {
      return Err(Error::Serialization(
        "The workspace changed. Retry clearing local history.".into(),
      ));
    }
    let orphaned: (bool,) = sqlx::query_as("SELECT EXISTS (SELECT 1 FROM snapshots WHERE doc_id NOT IN (SELECT doc_id FROM clocks) UNION ALL SELECT 1 FROM updates WHERE doc_id NOT IN (SELECT doc_id FROM clocks))")
      .fetch_one(&mut *tx).await?;
    if protection.preserve_all_removed_blobs || orphaned.0 {
      return Err(Error::Serialization(
        "Local history was kept because some workspace content cannot be safely checked for file references.".into(),
      ));
    }
    let referenced: HashSet<_> = protection.protected_blob_keys.into_iter().collect();
    sqlx::query("DELETE FROM doc_history").execute(&mut *tx).await?;
    let removed = sqlx::query("SELECT key FROM blobs WHERE deleted_at IS NOT NULL")
      .fetch_all(&mut *tx)
      .await?;
    for blob in removed {
      let key: String = blob.get("key");
      if referenced.contains(&key) {
        sqlx::query("UPDATE blobs SET deleted_at = NULL WHERE key = ?")
          .bind(key)
          .execute(&mut *tx)
          .await?;
      } else {
        sqlx::query("DELETE FROM blobs WHERE key = ?")
          .bind(key)
          .execute(&mut *tx)
          .await?;
      }
    }
    tx.commit().await?;
    Ok(())
  }

  pub async fn list_doc_histories(
    &self,
    doc_id: String,
    before: Option<NaiveDateTime>,
    limit: u32,
  ) -> Result<Vec<DocClock>> {
    let rows = sqlx::query("SELECT doc_id, timestamp FROM doc_history WHERE doc_id = ? AND (? IS NULL OR timestamp < ?) ORDER BY timestamp DESC LIMIT ?")
      .bind(doc_id).bind(before).bind(before).bind(limit.min(HISTORY_LIMIT as u32))
      .fetch_all(&self.pool).await?;
    Ok(
      rows
        .into_iter()
        .map(|row| DocClock {
          doc_id: row.get("doc_id"),
          timestamp: row.get("timestamp"),
        })
        .collect(),
    )
  }

  pub async fn get_doc_history(&self, doc_id: String, timestamp: NaiveDateTime) -> Result<Option<DocHistory>> {
    let row = sqlx::query("SELECT data FROM doc_history WHERE doc_id = ? AND timestamp = ?")
      .bind(&doc_id)
      .bind(timestamp)
      .fetch_optional(&self.pool)
      .await?;
    row
      .map(|row| {
        Ok(DocHistory {
          doc_id,
          timestamp,
          bins: decode_bundle(&row.get::<Vec<u8>, _>("data"))?,
        })
      })
      .transpose()
  }

  pub async fn create_doc_history(&self, snapshot: DocRecord) -> Result<()> {
    let mut tx = self.pool.begin().await?;
    insert_history(
      &mut tx,
      &snapshot.doc_id,
      snapshot.timestamp,
      encode_bundle(vec![snapshot.bin.to_vec()])?,
    )
    .await?;
    tx.commit().await?;
    Ok(())
  }

  pub async fn delete_doc_history(&self, doc_id: String, timestamp: NaiveDateTime) -> Result<()> {
    sqlx::query("DELETE FROM doc_history WHERE doc_id = ? AND timestamp = ?")
      .bind(doc_id)
      .bind(timestamp)
      .execute(&self.pool)
      .await?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::SetBlob;
  use sqlx::migrate::Migrator;
  use std::borrow::Cow;

  async fn storage() -> SqliteDocStorage {
    let storage = SqliteDocStorage::new(":memory:".to_string());
    storage.connect().await.unwrap();
    storage
  }

  async fn cleanup_protection(store: &SqliteDocStorage) -> DocHistoryCleanupProtection {
    DocHistoryCleanupProtection {
      expected_doc_clocks: store.get_doc_clocks(None).await.unwrap(),
      protected_blob_keys: vec![],
      preserve_all_removed_blobs: false,
    }
  }

  #[tokio::test]
  async fn upgrades_existing_schema_without_changing_snapshots_or_updates() {
    let store = SqliteDocStorage::new(":memory:".into());
    let migrator = nota_schema::get_migrator();
    let previous = Migrator {
      migrations: Cow::Owned(migrator.migrations.iter().take(4).cloned().collect()),
      ..Migrator::DEFAULT
    };
    previous.run(&store.pool).await.unwrap();
    let timestamp = chrono::Utc::now().naive_utc();
    store
      .set_doc_snapshot(DocRecord {
        doc_id: "page".into(),
        timestamp,
        bin: vec![1, 2].into(),
      })
      .await
      .unwrap();
    store.connect().await.unwrap();
    assert_eq!(
      store.get_doc_snapshot("page".into()).await.unwrap().unwrap().bin,
      vec![1, 2]
    );
    assert!(
      store
        .list_doc_histories("page".into(), None, 50)
        .await
        .unwrap()
        .is_empty()
    );
    let captured = store.push_update("page".into(), vec![3, 4]).await.unwrap();
    assert_eq!(
      store
        .get_doc_history("page".into(), captured)
        .await
        .unwrap()
        .unwrap()
        .bins,
      vec![vec![1, 2], vec![3, 4]]
    );
  }

  #[tokio::test]
  async fn captures_immutable_complete_bundle_on_write_without_read_compaction() {
    let store = storage().await;
    let first = store.push_update("page".into(), vec![1, 2, 3]).await.unwrap();
    let original = store.get_doc_history("page".into(), first).await.unwrap().unwrap();
    assert_eq!(original.bins, vec![vec![1, 2, 3]]);
    store.push_update("page".into(), vec![4, 5]).await.unwrap();
    assert_eq!(
      store.list_doc_histories("page".into(), None, 50).await.unwrap().len(),
      1
    );
    // Make the capture interval elapse without slowing the test.
    sqlx::query("UPDATE doc_history SET timestamp = ? WHERE doc_id = ?")
      .bind(first - chrono::Duration::minutes(6))
      .bind("page")
      .execute(&store.pool)
      .await
      .unwrap();
    let captured = store.push_update("page".into(), vec![6, 7]).await.unwrap();
    let history = store.get_doc_history("page".into(), captured).await.unwrap().unwrap();
    assert_eq!(history.bins, vec![vec![1, 2, 3], vec![4, 5], vec![6, 7]]);
    // Compaction cannot change the bytes already kept for history.
    store
      .set_doc_snapshot(DocRecord {
        doc_id: "page".into(),
        timestamp: captured,
        bin: vec![8, 9].into(),
      })
      .await
      .unwrap();
    let updates = store.get_doc_updates("page".into()).await.unwrap();
    store
      .mark_updates_merged("page".into(), updates.into_iter().map(|u| u.timestamp).collect())
      .await
      .unwrap();
    assert_eq!(
      store
        .get_doc_history("page".into(), captured)
        .await
        .unwrap()
        .unwrap()
        .bins,
      history.bins
    );
  }

  #[tokio::test]
  async fn checked_restore_is_atomic_and_forces_a_recovery_version() {
    let store = storage().await;
    let first = store.push_update("page".into(), vec![1, 2]).await.unwrap();
    let current = store.push_update("page".into(), vec![3, 4]).await.unwrap();
    assert!(
      store
        .push_update_for_rollback("page".into(), vec![5, 6], first)
        .await
        .is_err()
    );
    assert_eq!(store.get_doc_updates("page".into()).await.unwrap().len(), 2);
    let restored = store
      .push_update_for_rollback("page".into(), vec![7, 8], current)
      .await
      .unwrap();
    assert!(restored > current);
    assert_eq!(
      store
        .get_doc_history("page".into(), restored)
        .await
        .unwrap()
        .unwrap()
        .bins,
      vec![vec![1, 2], vec![3, 4], vec![7, 8]]
    );
  }

  #[tokio::test]
  async fn retention_pagination_and_document_deletion() {
    let store = storage().await;
    let start = chrono::Utc::now().naive_utc();
    for i in 0..55 {
      store
        .create_doc_history(DocRecord {
          doc_id: "page".into(),
          timestamp: start + chrono::Duration::seconds(i),
          bin: vec![i as u8].into(),
        })
        .await
        .unwrap();
    }
    let histories = store.list_doc_histories("page".into(), None, 100).await.unwrap();
    assert_eq!(histories.len(), 50);
    let next = store
      .list_doc_histories("page".into(), Some(histories[1].timestamp), 2)
      .await
      .unwrap();
    assert_eq!(next[0].timestamp, histories[2].timestamp);
    store
      .delete_doc_history("page".into(), histories[0].timestamp)
      .await
      .unwrap();
    assert!(
      store
        .get_doc_history("page".into(), histories[0].timestamp)
        .await
        .unwrap()
        .is_none()
    );
    store.delete_doc("page".into()).await.unwrap();
    assert!(
      store
        .list_doc_histories("page".into(), None, 50)
        .await
        .unwrap()
        .is_empty()
    );
  }

  #[tokio::test]
  async fn histories_survive_database_restart_and_pin_deleted_media() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("history.db").to_string_lossy().into_owned();
    let store = SqliteDocStorage::new(path.clone());
    store.connect().await.unwrap();
    let timestamp = store.push_update("page".into(), vec![1, 2]).await.unwrap();
    store
      .set_blob(SetBlob {
        key: "media".into(),
        data: vec![3, 4].into(),
        mime: "audio/wav".into(),
      })
      .await
      .unwrap();
    store.delete_blob("media".into(), true).await.unwrap();
    store.release_blobs().await.unwrap();
    store.close().await;
    let restarted = SqliteDocStorage::new(path);
    restarted.connect().await.unwrap();
    assert_eq!(
      restarted
        .get_doc_history("page".into(), timestamp)
        .await
        .unwrap()
        .unwrap()
        .bins,
      vec![vec![1, 2]]
    );
    assert!(restarted.get_blob("media".into()).await.unwrap().is_some());
    restarted.delete_doc_history("page".into(), timestamp).await.unwrap();
    restarted.release_blobs().await.unwrap();
    assert!(restarted.get_blob("media".into()).await.unwrap().is_none());
    restarted.close().await;
  }

  #[tokio::test]
  async fn clearing_histories_reclaims_only_removed_blobs_and_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("history.db").to_string_lossy().into_owned();
    let store = SqliteDocStorage::new(path.clone());
    store.connect().await.unwrap();
    let timestamp = store.push_update("page".into(), vec![1, 2]).await.unwrap();
    store.push_update("another-page".into(), vec![3, 4]).await.unwrap();
    store
      .set_doc_snapshot(DocRecord {
        doc_id: "page".into(),
        timestamp,
        bin: vec![1, 2].into(),
      })
      .await
      .unwrap();
    for (key, bytes) in [("active", vec![5, 6]), ("removed", vec![7, 8, 9])] {
      store
        .set_blob(SetBlob {
          key: key.into(),
          data: bytes.into(),
          mime: "audio/wav".into(),
        })
        .await
        .unwrap();
    }
    store.delete_blob("removed".into(), true).await.unwrap();
    let usage = store.get_doc_history_storage_usage().await.unwrap();
    assert_eq!(usage.versions, 2);
    assert!(usage.history_bytes >= 4);
    assert_eq!(usage.retained_removed_blob_bytes, 3);

    store
      .clear_doc_histories(cleanup_protection(&store).await)
      .await
      .unwrap();
    let usage = store.get_doc_history_storage_usage().await.unwrap();
    assert_eq!(
      (usage.versions, usage.history_bytes, usage.retained_removed_blob_bytes),
      (0, 0, 0)
    );
    assert_eq!(store.get_blob("active".into()).await.unwrap().unwrap().data, vec![5, 6]);
    assert!(store.get_blob("removed".into()).await.unwrap().is_none());
    let removed: (i64,) = sqlx::query_as("SELECT count(*) FROM blobs WHERE key = 'removed'")
      .fetch_one(&store.pool)
      .await
      .unwrap();
    assert_eq!(removed.0, 0);
    assert_eq!(
      store.get_doc_snapshot("page".into()).await.unwrap().unwrap().bin,
      vec![1, 2]
    );
    assert_eq!(store.get_doc_updates("page".into()).await.unwrap().len(), 1);
    assert_eq!(store.get_doc_updates("another-page".into()).await.unwrap().len(), 1);
    assert_eq!(
      store.get_doc_clock("page".into()).await.unwrap().unwrap().timestamp,
      timestamp
    );
    store.close().await;

    let restarted = SqliteDocStorage::new(path);
    restarted.connect().await.unwrap();
    assert_eq!(restarted.get_doc_history_storage_usage().await.unwrap().versions, 0);
    assert_eq!(
      restarted.get_blob("active".into()).await.unwrap().unwrap().data,
      vec![5, 6]
    );
    assert_eq!(
      restarted.get_doc_snapshot("page".into()).await.unwrap().unwrap().bin,
      vec![1, 2]
    );
    restarted.close().await;
  }

  #[tokio::test]
  async fn failed_blob_cleanup_rolls_back_history_and_blob_deletion() {
    let store = storage().await;
    let timestamp = store.push_update("page".into(), vec![1, 2]).await.unwrap();
    store
      .set_blob(SetBlob {
        key: "removed".into(),
        data: vec![3, 4].into(),
        mime: "audio/wav".into(),
      })
      .await
      .unwrap();
    store.delete_blob("removed".into(), true).await.unwrap();
    let usage = store.get_doc_history_storage_usage().await.unwrap();
    sqlx::query("CREATE TRIGGER fail_blob_delete BEFORE DELETE ON blobs BEGIN SELECT RAISE(ABORT, 'Injected blob deletion failure'); END")
      .execute(&store.pool)
      .await
      .unwrap();
    assert!(
      store
        .clear_doc_histories(cleanup_protection(&store).await)
        .await
        .is_err()
    );
    let after = store.get_doc_history_storage_usage().await.unwrap();
    assert_eq!(
      (after.versions, after.history_bytes, after.retained_removed_blob_bytes),
      (usage.versions, usage.history_bytes, usage.retained_removed_blob_bytes)
    );
    assert!(store.get_doc_history("page".into(), timestamp).await.unwrap().is_some());
    assert_eq!(
      store.get_blob("removed".into()).await.unwrap().unwrap().data,
      vec![3, 4]
    );
  }

  #[tokio::test]
  async fn concurrent_history_clear_and_writes_preserve_updates_and_active_blobs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("history.db").to_string_lossy().into_owned();
    let store = SqliteDocStorage::new(path.clone());
    store.connect().await.unwrap();
    let writer = SqliteDocStorage::new(path);
    writer.connect().await.unwrap();
    store.push_update("page".into(), vec![1, 2]).await.unwrap();
    store
      .set_blob(SetBlob {
        key: "media".into(),
        data: vec![3, 4].into(),
        mime: "audio/wav".into(),
      })
      .await
      .unwrap();
    store.delete_blob("media".into(), true).await.unwrap();
    let protection = cleanup_protection(&store).await;
    let (clear, update, blob) = tokio::join!(
      store.clear_doc_histories(protection),
      writer.push_update("page".into(), vec![5, 6]),
      writer.set_blob(SetBlob {
        key: "media".into(),
        data: vec![7, 8].into(),
        mime: "audio/wav".into()
      })
    );
    if let Err(error) = clear {
      assert!(error.to_string().contains("workspace changed"));
    }
    update.unwrap();
    blob.unwrap();
    let updates = store.get_doc_updates("page".into()).await.unwrap();
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0].bin, vec![1, 2]);
    assert_eq!(updates[1].bin, vec![5, 6]);
    assert_eq!(store.get_blob("media".into()).await.unwrap().unwrap().data, vec![7, 8]);
    assert_eq!(
      store
        .get_doc_history_storage_usage()
        .await
        .unwrap()
        .retained_removed_blob_bytes,
      0
    );
    writer.close().await;
    store.close().await;
  }

  #[tokio::test]
  async fn cleanup_reactivates_only_protected_removed_media() {
    let store = storage().await;
    store.push_update("page".into(), vec![1, 2]).await.unwrap();
    for key in ["restored", "unrelated"] {
      store
        .set_blob(SetBlob {
          key: key.into(),
          data: vec![3, 4].into(),
          mime: "image/png".into(),
        })
        .await
        .unwrap();
      store.delete_blob(key.into(), true).await.unwrap();
    }
    let mut protection = cleanup_protection(&store).await;
    protection.protected_blob_keys.push("restored".into());
    store.clear_doc_histories(protection).await.unwrap();
    store.release_blobs().await.unwrap();
    assert_eq!(
      store.get_blob("restored".into()).await.unwrap().unwrap().data,
      vec![3, 4]
    );
    assert!(store.get_blob("unrelated".into()).await.unwrap().is_none());
    let active = store.list_blobs().await.unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].key, "restored");
    assert_eq!(store.get_doc_history_storage_usage().await.unwrap().versions, 0);
  }

  #[tokio::test]
  async fn cleanup_refuses_changed_added_or_deleted_document_clocks() {
    for change in ["changed", "added", "deleted"] {
      let store = storage().await;
      store.push_update("page".into(), vec![1, 2]).await.unwrap();
      store.push_update("other-page".into(), vec![3, 4]).await.unwrap();
      store
        .set_blob(SetBlob {
          key: "removed".into(),
          data: vec![5, 6].into(),
          mime: "image/png".into(),
        })
        .await
        .unwrap();
      store.delete_blob("removed".into(), true).await.unwrap();
      let protection = cleanup_protection(&store).await;
      match change {
        "changed" => {
          store.push_update("page".into(), vec![7, 8]).await.unwrap();
        }
        "added" => {
          store.push_update("new-page".into(), vec![7, 8]).await.unwrap();
        }
        _ => {
          store.delete_doc("other-page".into()).await.unwrap();
        }
      }
      let usage = store.get_doc_history_storage_usage().await.unwrap();
      assert!(
        store
          .clear_doc_histories(protection)
          .await
          .unwrap_err()
          .to_string()
          .contains("workspace changed")
      );
      let after = store.get_doc_history_storage_usage().await.unwrap();
      assert_eq!(
        (after.versions, after.history_bytes, after.retained_removed_blob_bytes),
        (usage.versions, usage.history_bytes, usage.retained_removed_blob_bytes)
      );
      assert!(store.get_blob("removed".into()).await.unwrap().is_some());
    }
  }

  #[tokio::test]
  async fn cleanup_refuses_unknown_content_and_legacy_clockless_snapshots() {
    let store = storage().await;
    store.push_update("page".into(), vec![1, 2]).await.unwrap();
    store
      .set_blob(SetBlob {
        key: "removed".into(),
        data: vec![3, 4].into(),
        mime: "image/png".into(),
      })
      .await
      .unwrap();
    store.delete_blob("removed".into(), true).await.unwrap();
    let mut protection = cleanup_protection(&store).await;
    protection.preserve_all_removed_blobs = true;
    assert!(
      store
        .clear_doc_histories(protection)
        .await
        .unwrap_err()
        .to_string()
        .contains("cannot be safely checked")
    );
    store
      .set_doc_snapshot(DocRecord {
        doc_id: "legacy-page".into(),
        timestamp: chrono::Utc::now().naive_utc(),
        bin: vec![5, 6].into(),
      })
      .await
      .unwrap();
    assert!(
      store
        .clear_doc_histories(cleanup_protection(&store).await)
        .await
        .unwrap_err()
        .to_string()
        .contains("cannot be safely checked")
    );
    assert_eq!(store.get_doc_history_storage_usage().await.unwrap().versions, 1);
    assert_eq!(
      store.get_blob("removed".into()).await.unwrap().unwrap().data,
      vec![3, 4]
    );
  }
}
