use std::{
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use memory_indexer::InMemoryIndex;
use nota_schema::get_migrator;
use sqlx::{
  Pool, Row,
  migrate::{MigrateDatabase, Migration, Migrator},
  sqlite::{Sqlite, SqliteConnectOptions, SqlitePoolOptions},
};
use tokio::sync::RwLock;

use super::error::{Error, Result};

struct CancelBackupOnDrop(Arc<Mutex<bool>>);

impl Drop for CancelBackupOnDrop {
  fn drop(&mut self) {
    if let Ok(mut cancelled) = self.0.lock() {
      *cancelled = true;
    }
  }
}

pub struct SqliteDocStorage {
  pub pool: Pool<Sqlite>,
  path: String,
  pub index: Arc<RwLock<InMemoryIndex>>,
}

impl SqliteDocStorage {
  pub fn new(path: String) -> Self {
    let sqlite_options = SqliteConnectOptions::new().filename(&path).foreign_keys(false);

    let mut pool_options = SqlitePoolOptions::new();

    let index = Arc::new(RwLock::new(InMemoryIndex::default()));

    if path == ":memory:" {
      pool_options = pool_options
        .min_connections(1)
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None);

      Self {
        pool: pool_options.connect_lazy_with(sqlite_options),
        path,
        index,
      }
    } else {
      Self {
        pool: pool_options
          .max_connections(4)
          .connect_lazy_with(sqlite_options.journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)),
        path,
        index,
      }
    }
  }

  pub async fn validate(&self) -> Result<bool> {
    if self.path == ":memory:" {
      return Self::validate_pool(&self.pool).await;
    }
    // Inspect external recovery files without modifying them or keeping a
    // connection alive until the native object is garbage-collected.
    let pool = match SqlitePoolOptions::new()
      .max_connections(1)
      .connect_with(
        SqliteConnectOptions::new()
          .filename(&self.path)
          .read_only(true)
          .foreign_keys(false),
      )
      .await
    {
      Ok(pool) => pool,
      Err(_) => return Ok(false),
    };
    let result = Self::validate_pool(&pool).await;
    pool.close().await;
    result
  }

  async fn validate_pool(pool: &Pool<Sqlite>) -> Result<bool> {
    let check: Vec<(String,)> = match sqlx::query_as("PRAGMA integrity_check;").fetch_all(pool).await {
      Ok(check) => check,
      Err(_) => return Ok(false),
    };
    if check.len() != 1 || check[0].0 != "ok" {
      return Ok(false);
    }
    let records = match sqlx::query("SELECT version, description, success FROM _sqlx_migrations ORDER BY version;")
      .fetch_all(pool)
      .await
    {
      Ok(records) => records,
      Err(_) => return Ok(false),
    };
    if records.is_empty() {
      return Ok(false);
    }
    let migrator = get_migrator();
    for (record, expected) in records.iter().zip(migrator.iter()) {
      if record.try_get::<i64, _>("version")? != expected.version
        || record.try_get::<String, _>("description")? != expected.description
        || !record.try_get::<bool, _>("success")?
      {
        return Ok(false);
      }
    }
    if records.len() > migrator.iter().count() {
      return Ok(false);
    }
    // Check canonical content tables, not only a migration marker in an
    // arbitrary file.
    for query in [
      "SELECT space_id FROM meta LIMIT 0",
      "SELECT doc_id, data, updated_at FROM snapshots LIMIT 0",
      "SELECT doc_id, data, created_at FROM updates LIMIT 0",
      "SELECT doc_id, timestamp FROM clocks LIMIT 0",
      "SELECT key, data, mime, size, deleted_at FROM blobs LIMIT 0",
    ] {
      if sqlx::query(query).execute(pool).await.is_err() {
        return Ok(false);
      }
    }
    let invalid_blobs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blobs WHERE size != length(data)")
      .fetch_one(pool)
      .await?;
    Ok(invalid_blobs.0 == 0)
  }

  /// VACUUM INTO is SQLite's transactional live-backup alternative. It reads
  /// committed WAL content without requiring a checkpoint or stopping writers.
  pub async fn backup(&self, destination: String) -> Result<()> {
    let destination = self.backup_destination(Path::new(&destination))?;
    let pool = self.pool.clone();
    let cancelled = Arc::new(Mutex::new(false));
    let _cancel_on_drop = CancelBackupOnDrop(cancelled.clone());

    // Keep the private temporary directory alive until SQLite finishes even if
    // the caller drops its future. A cancelled attempt may never publish.
    tokio::spawn(async move {
      let temporary = tempfile::Builder::new()
        .prefix(".nota-backup-")
        .tempdir_in(destination.parent().ok_or(Error::InvalidOperation)?)?;
      let output = temporary.path().join("storage.db");
      let output_name = output.to_str().ok_or(Error::InvalidOperation)?;
      sqlx::query("VACUUM INTO ?").bind(output_name).execute(&pool).await?;

      let verification = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
          SqliteConnectOptions::new()
            .filename(&output)
            .read_only(true)
            .foreign_keys(false),
        )
        .await?;
      let valid = Self::validate_pool(&verification).await;
      verification.close().await;
      if !valid? {
        return Err(Error::Backup("The backup failed integrity or schema validation".into()));
      }
      // VACUUM INTO outputs are not assumed durable solely because SQL
      // finished.
      std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&output)?
        .sync_all()?;
      // Serialize cancellation with the final publish. Once commit starts the
      // verified snapshot is published as one filesystem operation.
      let cancelled = cancelled.lock().map_err(|err| Error::Backup(err.to_string()))?;
      if *cancelled {
        return Err(Error::Backup("Backup cancelled".into()));
      }
      // Same-directory rename is atomic and replaces only a fully verified
      // file. On systems which cannot replace an existing file this fails
      // safely.
      std::fs::rename(&output, &destination)?;
      #[cfg(unix)]
      std::fs::File::open(destination.parent().ok_or(Error::InvalidOperation)?)?.sync_all()?;
      Ok(())
    })
    .await
    .map_err(|err| Error::Backup(err.to_string()))?
  }

  fn backup_destination(&self, destination: &Path) -> Result<PathBuf> {
    let parent = destination
      .parent()
      .filter(|p| !p.as_os_str().is_empty())
      .unwrap_or(Path::new("."));
    let destination = parent
      .canonicalize()?
      .join(destination.file_name().ok_or(Error::InvalidOperation)?);
    if destination.is_dir() || std::fs::symlink_metadata(&destination).is_ok_and(|m| m.file_type().is_symlink()) {
      return Err(Error::Backup("Choose a regular backup file".into()));
    }
    if self.path != ":memory:" {
      let source = Path::new(&self.path).canonicalize()?;
      if destination == source
        || ["-wal", "-shm", "-journal"]
          .iter()
          .any(|suffix| destination.as_os_str() == format!("{}{suffix}", source.display()).as_str())
      {
        return Err(Error::Backup(
          "The backup must not replace the active workspace database".into(),
        ));
      }
    }
    Ok(destination)
  }

  pub async fn connect(&self) -> Result<()> {
    if !Sqlite::database_exists(&self.path).await? {
      Sqlite::create_database(&self.path).await?;
    };

    self.migrate().await?;
    self.init_index().await?;

    Ok(())
  }

  async fn migrate(&self) -> Result<()> {
    let migrator = get_migrator();
    if let Err(err) = migrator.run(&self.pool).await {
      // Compatibility: migration 3 (`add_idx_snapshots`) had a whitespace-only
      // SQL change (trailing space) between releases, which causes sqlx
      // to reject existing DBs with: `VersionMismatch(3)`. It's safe to
      // fix by updating the stored checksum.
      if matches!(err, sqlx::migrate::MigrateError::VersionMismatch(3))
        && self.try_repair_migration_3_checksum(&migrator).await?
      {
        migrator.run(&self.pool).await?;
      } else {
        return Err(err.into());
      }
    }

    Ok(())
  }

  async fn try_repair_migration_3_checksum(&self, migrator: &Migrator) -> Result<bool> {
    let Some(migration) = migrator.iter().find(|m| m.version == 3) else {
      return Ok(false);
    };

    // We're only prepared to repair the known `add_idx_snapshots`
    // whitespace-only mismatch.
    if migration.description.as_ref() != "add_idx_snapshots" {
      return Ok(false);
    }

    let row = sqlx::query("SELECT description, checksum FROM _sqlx_migrations WHERE version = 3")
      .fetch_optional(&self.pool)
      .await?;

    let Some(row) = row else {
      return Ok(false);
    };

    let applied_description: String = row.try_get("description")?;
    if applied_description != migration.description.as_ref() {
      return Ok(false);
    }

    let applied_checksum: Vec<u8> = row.try_get("checksum")?;
    let expected_checksum = migration.checksum.as_ref();

    // sqlx computes the checksum as SHA-384 of the raw SQL bytes. The legacy
    // variant had an extra trailing space at the end of the SQL string (after
    // the final newline).
    let legacy_sql = format!("{} ", migration.sql);
    let legacy_migration = Migration::new(
      migration.version,
      migration.description.clone(),
      migration.migration_type,
      std::borrow::Cow::Owned(legacy_sql),
      migration.no_tx,
    );

    if applied_checksum.as_slice() != legacy_migration.checksum.as_ref() {
      return Ok(false);
    }

    sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 3")
      .bind(expected_checksum)
      .execute(&self.pool)
      .await?;

    Ok(true)
  }

  pub async fn close(&self) {
    self.pool.close().await
  }

  pub fn is_closed(&self) -> bool {
    self.pool.is_closed()
  }

  ///
  /// Flush the WAL file to the database file.
  /// See https://www.sqlite.org/pragma.html#pragma_wal_checkpoint:~:text=PRAGMA%20schema.wal_checkpoint%3B
  pub async fn checkpoint(&self) -> Result<()> {
    sqlx::query("PRAGMA wal_checkpoint(FULL);").execute(&self.pool).await?;

    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use std::borrow::Cow;

  use chrono::Utc;
  use nota_schema::get_migrator;
  use sqlx::migrate::{Migration, Migrator};

  use super::*;
  use crate::{DocRecord, SetBlob};

  async fn get_storage() -> SqliteDocStorage {
    let storage = SqliteDocStorage::new(":memory:".to_string());
    storage.connect().await.unwrap();

    storage
  }

  #[tokio::test]
  async fn init_tables() {
    let storage = get_storage().await;

    sqlx::query("INSERT INTO meta (space_id) VALUES ($1);")
      .bind("test")
      .execute(&storage.pool)
      .await
      .unwrap();

    let record = sqlx::query!("SELECT space_id FROM meta;")
      .fetch_one(&storage.pool)
      .await
      .unwrap();

    assert_eq!(record.space_id, "test");
  }

  #[tokio::test]
  async fn validate_db() {
    let storage = get_storage().await;
    assert!(storage.validate().await.unwrap());

    let storage = SqliteDocStorage::new(":memory:".to_string());
    assert!(!storage.validate().await.unwrap());
  }

  #[tokio::test]
  async fn backup_restores_committed_wal_docs_and_attachments() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.db");
    let destination = dir.path().join("workspace.nota");
    let storage = SqliteDocStorage::new(source.to_str().unwrap().to_string());
    storage.connect().await.unwrap();
    storage.set_space_id("workspace".into()).await.unwrap();
    storage
      .set_doc_snapshot(DocRecord {
        doc_id: "note".into(),
        bin: vec![0, 0].into(),
        timestamp: Utc::now().naive_utc(),
      })
      .await
      .unwrap();
    storage.push_update("note".into(), vec![0, 0]).await.unwrap();
    storage
      .set_blob(SetBlob {
        key: "recording".into(),
        data: vec![7; 512 * 1024].into(),
        mime: "audio/wav".into(),
      })
      .await
      .unwrap();
    assert!(std::fs::metadata(format!("{}-wal", source.display())).unwrap().len() > 0);

    storage.backup(destination.to_str().unwrap().into()).await.unwrap();
    let restored = SqliteDocStorage::new(destination.to_str().unwrap().into());
    assert!(restored.validate().await.unwrap());
    restored.connect().await.unwrap();
    assert_eq!(
      restored
        .get_doc_snapshot("note".into())
        .await
        .unwrap()
        .unwrap()
        .bin
        .to_vec(),
      vec![0, 0]
    );
    assert_eq!(restored.get_doc_updates("note".into()).await.unwrap().len(), 1);
    assert_eq!(
      restored
        .get_blob("recording".into())
        .await
        .unwrap()
        .unwrap()
        .data
        .to_vec(),
      vec![7; 512 * 1024]
    );
    restored.close().await;
    storage.close().await;
    assert!(
      !std::fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".nota-backup-"))
    );
  }

  #[tokio::test]
  async fn backup_is_consistent_while_wal_writers_continue() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Arc::new(SqliteDocStorage::new(
      dir.path().join("source.db").to_str().unwrap().into(),
    ));
    storage.connect().await.unwrap();
    sqlx::query("CREATE TABLE backup_fixture (generation INTEGER NOT NULL)")
      .execute(&storage.pool)
      .await
      .unwrap();
    sqlx::query("INSERT INTO backup_fixture VALUES (0)")
      .execute(&storage.pool)
      .await
      .unwrap();
    storage
      .set_blob(SetBlob {
        key: "asset".into(),
        data: vec![0; 1024 * 1024].into(),
        mime: "application/octet-stream".into(),
      })
      .await
      .unwrap();
    let writer_pool = storage.pool.clone();
    let writer = tokio::spawn(async move {
      for generation in 1u8..=50 {
        let mut tx = writer_pool.begin().await.unwrap();
        sqlx::query("UPDATE backup_fixture SET generation = ?")
          .bind(generation as i64)
          .execute(&mut *tx)
          .await
          .unwrap();
        sqlx::query("UPDATE blobs SET data = ? WHERE key = 'asset'")
          .bind(vec![generation; 1024 * 1024])
          .execute(&mut *tx)
          .await
          .unwrap();
        tx.commit().await.unwrap();
        tokio::task::yield_now().await;
      }
    });
    for generation in 0..3 {
      let destination = dir.path().join(format!("backup-{generation}.nota"));
      storage.backup(destination.to_str().unwrap().into()).await.unwrap();
      let restored = SqliteDocStorage::new(destination.to_str().unwrap().into());
      assert!(restored.validate().await.unwrap());
      let generation: (i64,) = sqlx::query_as("SELECT generation FROM backup_fixture")
        .fetch_one(&restored.pool)
        .await
        .unwrap();
      let asset = restored.get_blob("asset".into()).await.unwrap().unwrap();
      assert!(asset.data.iter().all(|v| *v == generation.0 as u8));
      restored.close().await;
    }
    writer.await.unwrap();
    storage.close().await;
  }

  #[tokio::test]
  async fn failed_backup_preserves_existing_destination_and_cleans_temporary_output() {
    let dir = tempfile::tempdir().unwrap();
    let destination = dir.path().join("last-good.nota");
    let storage = get_storage().await;
    storage.backup(destination.to_str().unwrap().into()).await.unwrap();
    let original = std::fs::read(&destination).unwrap();
    sqlx::query("UPDATE _sqlx_migrations SET version = 900 WHERE version = 1")
      .execute(&storage.pool)
      .await
      .unwrap();
    assert!(storage.backup(destination.to_str().unwrap().into()).await.is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), original);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
  }

  #[tokio::test]
  async fn backup_refuses_active_source_and_invalid_destination() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.db");
    let storage = SqliteDocStorage::new(source.to_str().unwrap().into());
    storage.connect().await.unwrap();
    for destination in [
      source.clone(),
      dir.path().to_path_buf(),
      dir.path().join("missing/backup.nota"),
      PathBuf::from(format!("{}-wal", source.display())),
    ] {
      assert!(storage.backup(destination.to_str().unwrap().into()).await.is_err());
    }
    assert!(storage.validate().await.unwrap());
    #[cfg(unix)]
    {
      let alias = dir.path().join("alias.nota");
      std::os::unix::fs::symlink(&source, &alias).unwrap();
      assert!(storage.backup(alias.to_str().unwrap().into()).await.is_err());
    }
    storage.close().await;
  }

  #[tokio::test]
  async fn cancelled_backup_never_publishes_and_cleans_after_sqlite_finishes() {
    let dir = tempfile::tempdir().unwrap();
    let destination = dir.path().join("last-good.nota");
    std::fs::write(&destination, b"previous backup").unwrap();
    let storage = Arc::new(SqliteDocStorage::new(
      dir.path().join("source.db").to_str().unwrap().into(),
    ));
    storage.connect().await.unwrap();
    let mut held_connections = Vec::new();
    for _ in 0..4 {
      held_connections.push(storage.pool.acquire().await.unwrap());
    }
    let task_storage = storage.clone();
    let task_destination = destination.clone();
    let task = tokio::spawn(async move { task_storage.backup(task_destination.to_str().unwrap().into()).await });
    let has_temporary = || {
      std::fs::read_dir(dir.path())
        .unwrap()
        .any(|e| e.unwrap().file_name().to_string_lossy().starts_with(".nota-backup-"))
    };
    for _ in 0..200 {
      if has_temporary() {
        break;
      }
      tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(has_temporary());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    drop(held_connections);
    for _ in 0..200 {
      if !has_temporary() {
        break;
      }
      tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(!has_temporary());
    assert_eq!(std::fs::read(destination).unwrap(), b"previous backup");
    storage.close().await;
  }

  #[tokio::test]
  async fn connect_repairs_whitespace_only_migration_checksum_mismatch() {
    // Simulate a DB migrated with an older `add_idx_snapshots` SQL that had a
    // trailing space.
    let storage = SqliteDocStorage::new(":memory:".to_string());

    let new_migrator = get_migrator();
    let mut migrations = new_migrator.migrations.to_vec();
    assert!(migrations.len() >= 3);

    let mig3 = migrations[2].clone();
    assert_eq!(mig3.version, 3);
    assert_eq!(mig3.description.as_ref(), "add_idx_snapshots");

    let legacy_sql = format!("{} ", mig3.sql);
    migrations[2] = Migration::new(
      mig3.version,
      mig3.description.clone(),
      mig3.migration_type,
      Cow::Owned(legacy_sql),
      mig3.no_tx,
    );

    // The legacy DB didn't have newer migrations.
    migrations.truncate(3);
    let legacy_migrator = Migrator {
      migrations: Cow::Owned(migrations),
      ..Migrator::DEFAULT
    };

    legacy_migrator.run(&storage.pool).await.unwrap();

    // Now connecting with the current code should auto-repair the checksum and
    // succeed.
    storage.connect().await.unwrap();

    let expected_checksum = get_migrator()
      .iter()
      .find(|m| m.version == 3)
      .unwrap()
      .checksum
      .as_ref()
      .to_vec();

    let row = sqlx::query("SELECT checksum FROM _sqlx_migrations WHERE version = 3")
      .fetch_one(&storage.pool)
      .await
      .unwrap();
    let checksum: Vec<u8> = row.get("checksum");

    assert_eq!(checksum, expected_checksum);
  }
}
