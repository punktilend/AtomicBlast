package com.atomicblast.android.data

import com.atomicblast.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

data class ArtistMeta(
    val image: String? = null,
    val bio: String? = null,
    val tags: List<String> = emptyList(),
    val similar: List<String> = emptyList(),
    val listeners: String? = null,
)

data class AlbumMeta(
    val coverArt: String? = null,
    val wiki: String? = null,
)

class MetadataRepository(private val client: OkHttpClient = OkHttpClient()) {

    companion object {
        private const val LASTFM_KEY = "d67dea9be32d3f2510ef5cde2db140fb"
        private const val PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"
    }

    private val artistCache = mutableMapOf<String, ArtistMeta>()
    private val albumCache  = mutableMapOf<String, AlbumMeta>()

    suspend fun fetchArtistMeta(name: String): ArtistMeta {
        artistCache[name]?.let { return it }
        return coroutineScope {
            val lfm    = async { lastfmArtist(name) }
            val wiki   = async { wikipedia(name) }
            val deezer = async { deezerArtist(name) }
            val l = lfm.await(); val w = wiki.await(); val d = deezer.await()
            ArtistMeta(
                image     = l?.image ?: w?.image ?: d?.image,
                bio       = l?.bio   ?: w?.bio,
                tags      = l?.tags  ?: emptyList(),
                similar   = l?.similar ?: emptyList(),
                listeners = l?.listeners,
            ).also { artistCache[name] = it }
        }
    }

    suspend fun fetchAlbumMeta(artist: String, album: String): AlbumMeta {
        val key = "$artist\u0000$album"
        albumCache[key]?.let { return it }
        return coroutineScope {
            val lfm    = async { lastfmAlbum(artist, album) }
            val deezer = async { deezerAlbum(artist, album) }
            val l = lfm.await(); val d = deezer.await()
            AlbumMeta(
                coverArt = l?.coverArt ?: d?.coverArt,
                wiki     = l?.wiki,
            ).also { albumCache[key] = it }
        }
    }

    suspend fun fetchCollectionPopularity(): List<CollectionArtistPopularity> = withContext(Dispatchers.IO) {
        try {
            val proxyUrl = BuildConfig.PROXY_URL.trim().trimEnd('/')
            if (proxyUrl.isBlank()) return@withContext emptyList()
            val j = getJson("$proxyUrl/api/collection-popularity") ?: return@withContext emptyList()
            val artists = j.optJSONArray("artists") ?: return@withContext emptyList()
            val out = mutableListOf<CollectionArtistPopularity>()
            for (i in 0 until artists.length()) {
                val item = artists.optJSONObject(i) ?: continue
                val name = item.optString("name").takeIf { it.isNotBlank() } ?: continue
                out.add(
                    CollectionArtistPopularity(
                        name = name,
                        albums = item.optInt("albums"),
                        tracks = item.optInt("tracks"),
                        localScore = item.optDouble("localScore", 0.0),
                        listenersRaw = item.optLong("listenersRaw", 0L),
                        playcountRaw = item.optLong("playcountRaw", 0L),
                        listeners = item.optString("listeners").takeIf { it.isNotBlank() },
                        image = item.optString("image").takeIf { it.isNotBlank() },
                        popularityScore = item.optDouble("popularityScore", 0.0),
                    )
                )
            }
            out
        } catch (_: Exception) {
            emptyList()
        }
    }

    // ── Last.fm ───────────────────────────────────────────────────────────────

    private suspend fun lastfmArtist(name: String): ArtistMeta? = withContext(Dispatchers.IO) {
        try {
            val j = getJson("https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${enc(name)}&api_key=$LASTFM_KEY&format=json&autocorrect=1") ?: return@withContext null
            val a = j.optJSONObject("artist") ?: return@withContext null
            val img = lfmImage(a.optJSONArray("image"), "extralarge")
            val bio = stripHtml(a.optJSONObject("bio")?.optString("summary") ?: "")
                .replace(Regex("Read more on Last\\.fm\\.?", RegexOption.IGNORE_CASE), "").trim()
            val tags    = jsonStrList(a.optJSONObject("tags")?.optJSONArray("tag"), "name", 8)
            val similar = jsonStrList(a.optJSONObject("similar")?.optJSONArray("artist"), "name", 5)
            ArtistMeta(
                image     = img,
                bio       = bio.takeIf { it.length > 20 },
                tags      = tags,
                similar   = similar,
                listeners = a.optJSONObject("stats")?.optString("listeners")?.takeIf { it.isNotBlank() },
            )
        } catch (e: Exception) { null }
    }

    private suspend fun lastfmAlbum(artist: String, album: String): AlbumMeta? = withContext(Dispatchers.IO) {
        try {
            val j = getJson("https://ws.audioscrobbler.com/2.0/?method=album.getinfo&artist=${enc(artist)}&album=${enc(album)}&api_key=$LASTFM_KEY&format=json&autocorrect=1") ?: return@withContext null
            val a = j.optJSONObject("album") ?: return@withContext null
            val img  = lfmImage(a.optJSONArray("image"), "extralarge")
            val wiki = stripHtml(a.optJSONObject("wiki")?.optString("summary") ?: "")
                .replace(Regex("Read more on Last\\.fm\\.?", RegexOption.IGNORE_CASE), "").trim()
            AlbumMeta(coverArt = img, wiki = wiki.takeIf { it.length > 20 })
        } catch (e: Exception) { null }
    }

    // ── Wikipedia ─────────────────────────────────────────────────────────────

    private suspend fun wikipedia(name: String): ArtistMeta? = withContext(Dispatchers.IO) {
        try {
            val j = getJson("https://en.wikipedia.org/api/rest_v1/page/summary/${enc(name)}") ?: return@withContext null
            if (j.optString("type") == "disambiguation") return@withContext null
            val extract = j.optString("extract").takeIf { it.length > 20 } ?: return@withContext null
            ArtistMeta(
                image = j.optJSONObject("thumbnail")?.optString("source")?.takeIf { it.isNotBlank() },
                bio   = extract.take(600),
            )
        } catch (e: Exception) { null }
    }

    // ── Deezer ────────────────────────────────────────────────────────────────

    private suspend fun deezerArtist(name: String): ArtistMeta? = withContext(Dispatchers.IO) {
        try {
            val j = getJson("https://api.deezer.com/search/artist?q=${enc(name)}&limit=3") ?: return@withContext null
            val data = j.optJSONArray("data")?.takeIf { it.length() > 0 } ?: return@withContext null
            var match = data.getJSONObject(0)
            for (i in 0 until data.length()) {
                val item = data.getJSONObject(i)
                if (item.optString("name").equals(name, ignoreCase = true)) { match = item; break }
            }
            val img = match.optString("picture_xl").ifBlank { match.optString("picture_big") }
            ArtistMeta(image = img.takeIf { it.isNotBlank() })
        } catch (e: Exception) { null }
    }

    private suspend fun deezerAlbum(artist: String, album: String): AlbumMeta? = withContext(Dispatchers.IO) {
        try {
            val j = getJson("https://api.deezer.com/search/album?q=${enc("$artist $album")}&limit=3") ?: return@withContext null
            val data = j.optJSONArray("data")?.takeIf { it.length() > 0 } ?: return@withContext null
            var match = data.getJSONObject(0)
            for (i in 0 until data.length()) {
                val item = data.getJSONObject(i)
                if (item.optString("title").contains(album, ignoreCase = true)) { match = item; break }
            }
            val img = match.optString("cover_xl").ifBlank { match.optString("cover_big") }
            AlbumMeta(coverArt = img.takeIf { it.isNotBlank() })
        } catch (e: Exception) { null }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun getJson(url: String): JSONObject? {
        val req  = Request.Builder().url(url)
            .header("User-Agent", "AtomicBlast/1.0 (Android; github.com/punktilend/AtomicBlast)")
            .header("Accept", "application/json")
            .build()
        val body = client.newCall(req).execute().body?.string() ?: return null
        return JSONObject(body)
    }

    private fun lfmImage(arr: JSONArray?, size: String): String? {
        arr ?: return null
        for (i in 0 until arr.length()) {
            val item = arr.getJSONObject(i)
            if (item.optString("size") == size) {
                val url = item.optString("#text")
                if (url.isNotBlank() && !url.contains(PLACEHOLDER)) return url
            }
        }
        return null
    }

    private fun jsonStrList(arr: JSONArray?, field: String, max: Int): List<String> {
        arr ?: return emptyList()
        val out = mutableListOf<String>()
        for (i in 0 until minOf(arr.length(), max)) out.add(arr.getJSONObject(i).optString(field))
        return out.filter { it.isNotBlank() }
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    private fun stripHtml(str: String) = str
        .replace(Regex("<a[^>]*>[\\s\\S]*?</a>", RegexOption.IGNORE_CASE), "")
        .replace(Regex("<[^>]+>"), " ")
        .replace(Regex("\\s+"), " ")
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ")
        .trim()
}

