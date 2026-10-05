package app.nota.pro

import android.webkit.WebView
import app.nota.pro.service.CookieStore
import app.nota.pro.utils.dataStore
import app.nota.pro.utils.get
import app.nota.pro.utils.getCurrentServerBaseUrl
import app.nota.pro.utils.logger.FileTree
import com.getcapacitor.Bridge
import com.getcapacitor.WebViewListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import timber.log.Timber

object AuthInitializer {

    fun initialize(bridge: Bridge) {
        bridge.addWebViewListener(object : WebViewListener() {
            override fun onPageLoaded(webView: WebView?) {
                bridge.removeWebViewListener(this)
                MainScope().launch(Dispatchers.IO) {
                    try {
                        val server = bridge.getCurrentServerBaseUrl().toHttpUrl()
                        val sessionCookieStr = NotaApp.context().dataStore
                            .get(server.host + CookieStore.AFFINE_SESSION)
                        val userIdCookieStr = NotaApp.context().dataStore
                            .get(server.host + CookieStore.AFFINE_USER_ID)
                        val csrfCookieStr = NotaApp.context().dataStore
                            .get(server.host + CookieStore.AFFINE_CSRF_TOKEN)
                        if (sessionCookieStr.isEmpty() || userIdCookieStr.isEmpty() || csrfCookieStr.isEmpty()) {
                            Timber.i("[init] user has not signed in yet.")
                            return@launch
                        }
                        Timber.i("[init] user already signed in.")
                        val cookies = listOf(
                            Cookie.parse(server, sessionCookieStr)
                                ?: error("Parse session cookie fail:[ cookie = $sessionCookieStr ]"),
                            Cookie.parse(server, userIdCookieStr)
                                ?: error("Parse user id cookie fail:[ cookie = $userIdCookieStr ]"),
                            Cookie.parse(server, csrfCookieStr)
                                ?: error("Parse csrf token cookie fail:[ cookie = $csrfCookieStr ]"),
                        )
                        CookieStore.saveCookies(server.host, cookies)
                        FileTree.get()?.checkAndUploadOldLogs(server)
                    } catch (e: Exception) {
                        Timber.w(e, "[init] load persistent cookies fail.")
                    }
                }
            }
        })
    }

}
