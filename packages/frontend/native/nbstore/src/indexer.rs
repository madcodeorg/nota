use memory_indexer::{SearchHit, SnapshotData};
use napi_derive::napi;
use serde::Serialize;
use sqlx::Row;

use super::{
  error::{Error, Result},
  storage::SqliteDocStorage,
};

#[napi(object)]
#[derive(Debug, Serialize)]
pub struct NativeSearchHit {
  pub id: String,
  pub score: f64,
  pub terms: Vec<String>,
}

impl From<SearchHit> for NativeSearchHit {
  fn from(value: SearchHit) -> Self {
    Self {
      id: value.doc_id,
      score: value.score,
      terms: value.matched_terms.into_iter().map(|t| t.term).collect(),
    }
  }
}

#[napi(object)]
#[derive(Debug, Serialize)]
pub struct NativeMatch {
  pub start: u32,
  pub end: u32,
}

impl From<(u32, u32)> for NativeMatch {
  fn from(value: (u32, u32)) -> Self {
    Self {
      start: value.0,
      end: value.1,
    }
  }
}

impl SqliteDocStorage {
  pub async fn init_index(&self) -> Result<()> {
    let snapshots = sqlx::query("SELECT index_name, data FROM idx_snapshots")
      .fetch_all(&self.pool)
      .await?;

    {
      let mut index = self.index.write().await;
      let config = bincode::config::standard();
      for row in snapshots {
        let index_name: String = row.get("index_name");
        let data: Vec<u8> = row.get("data");
        if let Ok(decompressed) = zstd::stream::decode_all(std::io::Cursor::new(&data))
          && let Ok((snapshot, _)) = bincode::serde::decode_from_slice::<SnapshotData, _>(&decompressed, config)
        {
          index.load_snapshot(&index_name, snapshot);
        }
      }
    }

    Ok(())
  }

  async fn compact_index(&self, index_name: &str) -> Result<()> {
    let snapshot_data = {
      let index = self.index.read().await;
      index.get_snapshot_data(index_name)
    };

    if let Some(data) = snapshot_data {
      let blob = bincode::serde::encode_to_vec(&data, bincode::config::standard())
        .map_err(|e| Error::Serialization(e.to_string()))?;
      let compressed =
        zstd::stream::encode_all(std::io::Cursor::new(&blob), 4).map_err(|e| Error::Serialization(e.to_string()))?;

      let mut tx = self.pool.begin().await?;

      sqlx::query("INSERT OR REPLACE INTO idx_snapshots (index_name, data) VALUES (?, ?)")
        .bind(index_name)
        .bind(compressed)
        .execute(&mut *tx)
        .await?;

      tx.commit().await?;
    }
    Ok(())
  }

  pub async fn flush_index(&self) -> Result<()> {
    let (dirty_docs, deleted_docs) = {
      let mut index = self.index.write().await;
      index.take_dirty_and_deleted()
    };

    if dirty_docs.is_empty() && deleted_docs.is_empty() {
      return Ok(());
    }

    let mut modified_indices = std::collections::HashSet::new();
    for index_name in deleted_docs.keys() {
      modified_indices.insert(index_name.clone());
    }
    for (index_name, _, _, _) in &dirty_docs {
      modified_indices.insert(index_name.clone());
    }

    for index_name in modified_indices {
      self.compact_index(&index_name).await?;
    }

    Ok(())
  }

  pub fn index_version() -> u32 {
    memory_indexer::InMemoryIndex::snapshot_version()
  }

  pub async fn fts_add(&self, index_name: &str, doc_id: &str, text: &str, index: bool) -> Result<()> {
    let mut idx = self.index.write().await;
    idx.add_doc(index_name, doc_id, text, index);
    Ok(())
  }

  pub async fn fts_delete(&self, index_name: &str, doc_id: &str) -> Result<()> {
    let mut idx = self.index.write().await;
    idx.remove_doc(index_name, doc_id);
    Ok(())
  }

  pub async fn fts_get(&self, index_name: &str, doc_id: &str) -> Result<Option<String>> {
    let idx = self.index.read().await;
    Ok(idx.get_doc(index_name, doc_id))
  }

  pub async fn fts_search(&self, index_name: &str, query: &str) -> Result<Vec<NativeSearchHit>> {
    let idx = self.index.read().await;
    Ok(idx.search_hits(index_name, query).into_iter().map(Into::into).collect())
  }

  pub async fn fts_get_matches(&self, index_name: &str, doc_id: &str, query: &str) -> Result<Vec<NativeMatch>> {
    let idx = self.index.read().await;
    Ok(
      idx
        .get_matches(index_name, doc_id, query)
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }

  pub async fn fts_get_matches_for_terms(
    &self,
    index_name: &str,
    doc_id: &str,
    terms: Vec<String>,
  ) -> Result<Vec<NativeMatch>> {
    let idx = self.index.read().await;
    Ok(
      idx
        .get_matches_for_terms(index_name, doc_id, &terms)
        .into_iter()
        .map(Into::into)
        .collect(),
    )
  }
}
