package app.nota.pro.service

import app.nota.pro.utils.getCurrentDocContentInMarkdown
import app.nota.pro.utils.getCurrentDocId
import app.nota.pro.utils.getCurrentWorkspaceId
import com.getcapacitor.Bridge
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WebService @Inject constructor() {

    suspend fun update(bridge: Bridge) {
        _workspaceId = bridge.getCurrentWorkspaceId()
        _docId = bridge.getCurrentDocId()
        _docContentInMD = bridge.getCurrentDocContentInMarkdown()
    }

    private lateinit var _workspaceId: String
    private lateinit var _docId: String
    private lateinit var _docContentInMD: String

    fun workspaceId() = _workspaceId

    fun docId() = _docId

    fun docContentInMD() = _docContentInMD
}