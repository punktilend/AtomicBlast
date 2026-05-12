package com.atomicblast.android.data

import com.atomicblast.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class AccountRepository(
    private val baseUrl: String = BuildConfig.PROXY_URL,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val jsonType = "application/json".toMediaType()

    suspend fun emailPasswordLogin(email: String, password: String): Result<AtomicBlastAccount> = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("email", email.trim())
                put("password", password)
                put("name", email.substringBefore('@').ifBlank { "AtomicBlast" })
            }.toString()
            val req = Request.Builder()
                .url("$baseUrl/api/auth/email-login")
                .post(payload.toRequestBody(jsonType))
                .build()
            client.newCall(req).execute().use { res ->
                val body = res.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))
                val obj = JSONObject(body)
                if (!res.isSuccessful || !obj.optBoolean("ok")) {
                    return@withContext Result.failure(Exception(obj.optString("error", "Sign-in failed")))
                }
                Result.success(parseAccount(obj.getJSONObject("user")))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun parseAccount(obj: JSONObject) = AtomicBlastAccount(
        id = obj.optString("id"),
        email = obj.optString("email"),
        name = obj.optString("name"),
        provider = obj.optString("provider", "email"),
        picture = obj.optString("picture"),
    )
}
