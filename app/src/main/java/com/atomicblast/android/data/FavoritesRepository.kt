package com.atomicblast.android.data

import com.atomicblast.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class FavoritesRepository(private val baseUrl: String = BuildConfig.PROXY_URL, private val client: OkHttpClient = OkHttpClient()) {

    private val jsonType = "application/json".toMediaType()

    suspend fun getFavorites(): Result<List<Favorite>> = withContext(Dispatchers.IO) {
        try {
            val req  = Request.Builder().url("$baseUrl/favorites").build()
            val body = client.newCall(req).execute().body?.string()
                ?: return@withContext Result.failure(Exception("Empty response"))
            Result.success(parseArray(JSONArray(body)))
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun addFavorite(track: Track): Result<List<Favorite>> = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("filePath", track.filePath)
                put("title",    track.title)
                put("artist",   track.artist)
                put("album",    track.album)
                put("format",   track.format)
            }.toString()
            val req = Request.Builder()
                .url("$baseUrl/favorites")
                .post(payload.toRequestBody(jsonType))
                .build()
            val body = client.newCall(req).execute().body?.string()
                ?: return@withContext Result.failure(Exception("Empty response"))
            val obj = JSONObject(body)
            if (!obj.optBoolean("ok")) return@withContext Result.failure(Exception("Server error"))
            Result.success(parseArray(obj.getJSONArray("favorites")))
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun removeFavorite(filePath: String): Result<List<Favorite>> = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply { put("filePath", filePath) }.toString()
            val req = Request.Builder()
                .url("$baseUrl/favorites")
                .delete(payload.toRequestBody(jsonType))
                .build()
            val body = client.newCall(req).execute().body?.string()
                ?: return@withContext Result.failure(Exception("Empty response"))
            val obj = JSONObject(body)
            if (!obj.optBoolean("ok")) return@withContext Result.failure(Exception("Server error"))
            Result.success(parseArray(obj.getJSONArray("favorites")))
        } catch (e: Exception) { Result.failure(e) }
    }

    private fun parseArray(arr: JSONArray): List<Favorite> =
        (0 until arr.length()).map { i ->
            arr.getJSONObject(i).let { f ->
                Favorite(
                    filePath = f.getString("filePath"),
                    title    = f.optString("title"),
                    artist   = f.optString("artist"),
                    album    = f.optString("album"),
                    format   = f.optString("format"),
                    addedAt  = f.optString("addedAt"),
                )
            }
        }
}

