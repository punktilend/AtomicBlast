package com.pulse.android.data

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Talks to the Backblaze B2 API to list and stream music files
 * from the aharveyGoogleDriveBackup bucket (Music/ prefix).
 */
class B2Repository(private val config: B2Config = B2Config()) {

    private val client = OkHttpClient()

    private var authToken: String? = null
    private var apiUrl: String? = null
    private var downloadUrl: String? = null

    // -------------------------------------------------------
    // Auth
    // -------------------------------------------------------
    suspend fun authorize(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val credentials = "${config.keyId}:${config.appKey}"
            val encoded = Base64.encodeToString(credentials.toByteArray(), Base64.NO_WRAP)
            val req = Request.Builder()
                .url("https://api.backblazeb2.com/b2api/v3/b2_authorize_account")
                .header("Authorization", "Basic $encoded")
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))
            val json = JSONObject(body)
            authToken   = json.getString("authorizationToken")
            apiUrl      = json.getString("apiUrl")
            downloadUrl = json.getString("downloadUrl")
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // -------------------------------------------------------
    // List files
    // -------------------------------------------------------
    suspend fun listFiles(folderPrefix: String = config.prefix): Result<List<B2File>> =
        withContext(Dispatchers.IO) {
            val token = authToken ?: return@withContext Result.failure(Exception("Not authorized"))
            val api   = apiUrl   ?: return@withContext Result.failure(Exception("Not authorized"))
            try {
                val payload = """{"bucketId":"${getBucketId()}","prefix":"$folderPrefix","delimiter":"/","maxFileCount":1000}"""
                val req = Request.Builder()
                    .url("$api/b2api/v3/b2_list_file_names")
                    .header("Authorization", token)
                    .post(okhttp3.RequestBody.create(okhttp3.MediaType.parse("application/json"), payload))
                    .build()
                val resp = client.newCall(req).execute()
                val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty"))
                val json = JSONObject(body)
                val files = json.getJSONArray("files")
                val result = mutableListOf<B2File>()
                for (i in 0 until files.length()) {
                    val f = files.getJSONObject(i)
                    val name = f.getString("fileName")
                    val size = f.optLong("contentLength", 0)
                    val isFolder = name.endsWith("/")
                    result.add(B2File(name, size, isFolder))
                }
                Result.success(result)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    fun getStreamUrl(fileName: String): String {
        val dl = downloadUrl ?: "https://f005.backblazeb2.com"
        val encoded = URLEncoder.encode(fileName, "UTF-8").replace("+", "%20")
        return "$dl/file/${config.bucket}/$encoded"
    }

    fun getAuthToken() = authToken

    // -------------------------------------------------------
    // Helpers
    // -------------------------------------------------------
    private suspend fun getBucketId(): String {
        // For B2, bucket name can be used directly in list_file_names via bucketId lookup,
        // but to keep it simple we cache it after first auth call if the server returns it.
        // In practice the key is scoped to this bucket so we can list by name.
        return config.bucket
    }
}

data class B2File(
    val name: String,
    val size: Long,
    val isFolder: Boolean,
)
