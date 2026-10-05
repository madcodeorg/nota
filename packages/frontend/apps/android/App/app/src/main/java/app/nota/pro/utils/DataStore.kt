package app.nota.pro.utils

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "nota")

suspend fun DataStore<Preferences>.set(key: String, value: String) {
    edit {
        it[stringPreferencesKey(key)] = value
    }
}

suspend fun DataStore<Preferences>.get(key: String) = data.map {
    it[stringPreferencesKey(key)] ?: ""
}.first()