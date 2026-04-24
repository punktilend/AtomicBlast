package com.atomicblast.android.data

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Talks to the Backblaze B2 API to list and stream music files
 * from the SpAtomify bucket (Music/ prefix).
 */
class B2Repository(private val config: B2Config = B2Config(), private val client: OkHttpClient = OkHttpClient()) {

    private var authToken: String? = null
    private var accountId: String? = null
    private var apiUrl: String? = null
    private var downloadUrl: String? = null
    private var bucketId: String? = null
    private var downloadAuthToken: String? = null

    // -------------------------------------------------------
    // Auth
    // -------------------------------------------------------
    suspend fun authorize(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val credentials = "${config.keyId}:${config.appKey}"
            val encoded = Base64.encodeToString(credentials.toByteArray(), Base64.NO_WRAP)
            val req = Request.Builder()
                .url("https://api.backblazeb2.com/b2api/v2/b2_authorize_account")
                .header("Authorization", "Basic $encoded")
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))
            val json = JSONObject(body)
            if (json.has("status")) {
                return@withContext Result.failure(Exception("Auth failed: ${json.optString("message")}"))
            }
            authToken   = json.getString("authorizationToken")
            accountId   = json.getString("accountId")
            apiUrl      = json.getString("apiUrl")
            downloadUrl = json.getString("downloadUrl")

            // Resolve bucket ID now while we have auth
            val bucketResult = resolveBucketId()
            if (bucketResult.isFailure) return@withContext Result.failure(bucketResult.exceptionOrNull()!!)

            // Get a long-lived download auth token for private bucket access
            val dlAuthResult = resolveDownloadAuth()
            if (dlAuthResult.isFailure) return@withContext Result.failure(dlAuthResult.exceptionOrNull()!!)

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
            val token  = authToken ?: return@withContext Result.failure(Exception("Not authorized"))
            val api    = apiUrl    ?: return@withContext Result.failure(Exception("Not authorized"))
            val bid    = bucketId  ?: return@withContext Result.failure(Exception("Bucket ID not resolved"))
            try {
                val result = mutableListOf<B2File>()
                var startFileName: String? = null
                do {
                    val payloadMap = mutableMapOf(
                        "bucketId" to bid,
                        "prefix" to folderPrefix,
                        "delimiter" to "/",
                        "maxFileCount" to 1000
                    )
                    if (startFileName != null) payloadMap["startFileName"] = startFileName!!
                    val payload = JSONObject(payloadMap as Map<*, *>).toString()
                    val req = Request.Builder()
                        .url("$api/b2api/v2/b2_list_file_names")
                        .header("Authorization", token)
                        .post(payload.toRequestBody("application/json".toMediaType()))
                        .build()
                    val resp = client.newCall(req).execute()
                    val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty"))
                    val json = JSONObject(body)
                    if (json.has("status")) {
                        return@withContext Result.failure(Exception("List error: ${json.optString("message")}"))
                    }
                    val files = json.getJSONArray("files")
                    for (i in 0 until files.length()) {
                        val f = files.getJSONObject(i)
                        val name = f.getString("fileName")
                        val size = f.optLong("contentLength", 0)
                        val isFolder = name.endsWith("/")
                        result.add(B2File(name, size, isFolder))
                    }
                    startFileName = if (json.isNull("nextFileName")) null else json.optString("nextFileName")
                } while (startFileName != null)
                Result.success(result)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    // -------------------------------------------------------
    // List ALL files recursively (no delimiter), audio only
    // -------------------------------------------------------
    suspend fun listAllFiles(prefix: String = config.prefix): Result<List<B2File>> =
        withContext(Dispatchers.IO) {
            val token  = authToken ?: return@withContext Result.failure(Exception("Not authorized"))
            val api    = apiUrl    ?: return@withContext Result.failure(Exception("Not authorized"))
            val bid    = bucketId  ?: return@withContext Result.failure(Exception("Bucket ID not resolved"))
            val audioExtensions = setOf("mp3", "flac", "aac", "ogg", "wav", "m4a", "opus", "wma")
            try {
                val result = mutableListOf<B2File>()
                var startFileName: String? = null
                do {
                    val payloadMap = mutableMapOf(
                        "bucketId" to bid,
                        "prefix" to prefix,
                        "maxFileCount" to 1000
                    )
                    if (startFileName != null) payloadMap["startFileName"] = startFileName!!
                    val payload = JSONObject(payloadMap as Map<*, *>).toString()
                    val req = Request.Builder()
                        .url("$api/b2api/v2/b2_list_file_names")
                        .header("Authorization", token)
                        .post(payload.toRequestBody("application/json".toMediaType()))
                        .build()
                    val resp = client.newCall(req).execute()
                    val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty"))
                    val json = JSONObject(body)
                    if (json.has("status")) {
                        return@withContext Result.failure(Exception("List error: ${json.optString("message")}"))
                    }
                    val files = json.getJSONArray("files")
                    for (i in 0 until files.length()) {
                        val f = files.getJSONObject(i)
                        val name = f.getString("fileName")
                        val ext = name.substringAfterLast(".").lowercase()
                        if (ext in audioExtensions) {
                            val size = f.optLong("contentLength", 0)
                            result.add(B2File(name, size, isFolder = false))
                        }
                    }
                    startFileName = if (json.isNull("nextFileName")) null else json.optString("nextFileName")
                } while (startFileName != null)
                Result.success(result)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    fun getStreamUrl(fileName: String): String {
        val dl = downloadUrl ?: "https://f005.backblazeb2.com"
        val encoded = fileName.split("/").joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        val base = "$dl/file/${config.bucket}/$encoded"
        val token = downloadAuthToken ?: authToken ?: return base
        return "$base?Authorization=${URLEncoder.encode(token, "UTF-8")}"
    }

    /** Download a text file from B2 (e.g. a CUE sheet). */
    suspend fun fetchFileText(path: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val url = getStreamUrl(path)
            val req = Request.Builder().url(url).build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))
            Result.success(body)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun getProxyStreamUrl(filePath: String, quality: String): String {
        val encoded = filePath.split("/").joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        return "${com.atomicblast.android.BuildConfig.PROXY_URL}/stream?file=$encoded&quality=$quality"
    }

    fun getAuthToken() = authToken

    // -------------------------------------------------------
    // Helpers
    // -------------------------------------------------------
    private suspend fun resolveDownloadAuth(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val token = authToken ?: return@withContext Result.failure(Exception("Not authorized"))
            val api   = apiUrl   ?: return@withContext Result.failure(Exception("Not authorized"))
            val bid   = bucketId ?: return@withContext Result.failure(Exception("No bucketId"))
            val payload = """{"bucketId":"$bid","fileNamePrefix":"","validDurationInSeconds":86400}"""
            val req = Request.Builder()
                .url("$api/b2api/v2/b2_get_download_authorization")
                .header("Authorization", token)
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty"))
            val json = JSONObject(body)
            if (json.has("status")) {
                // Non-fatal: fall back to using the auth token directly for downloads
                return@withContext Result.success(Unit)
            }
            downloadAuthToken = json.getString("authorizationToken")
            Result.success(Unit)
        } catch (e: Exception) {
            Result.success(Unit) // Non-fatal, fall back to authToken in getStreamUrl
        }
    }

    private suspend fun resolveBucketId(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val token = authToken ?: return@withContext Result.failure(Exception("Not authorized"))
            val api   = apiUrl   ?: return@withContext Result.failure(Exception("Not authorized"))
            val acct  = accountId ?: return@withContext Result.failure(Exception("No accountId"))
            val payload = """{"accountId":"$acct","bucketName":"${config.bucket}"}"""
            val req = Request.Builder()
                .url("$api/b2api/v2/b2_list_buckets")
                .header("Authorization", token)
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: return@withContext Result.failure(Exception("Empty"))
            val json = JSONObject(body)
            if (json.has("status")) {
                return@withContext Result.failure(Exception("Bucket lookup failed: ${json.optString("message")}"))
            }
            val buckets = json.getJSONArray("buckets")
            if (buckets.length() == 0) {
                return@withContext Result.failure(Exception("Bucket '${config.bucket}' not found"))
            }
            bucketId = buckets.getJSONObject(0).getString("bucketId")
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

data class B2File(
    val name: String,
    val size: Long,
    val isFolder: Boolean,
)

