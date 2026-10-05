package app.nota.pro.ai.chat

import com.nota.pro.graphql.GetCopilotHistoriesQuery
import com.nota.pro.graphql.fragment.CopilotChatHistory
import com.nota.pro.graphql.fragment.CopilotChatMessage
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant

data class MessageUiState(val messages: List<ChatMessage>) {

    fun addMessage(message: ChatMessage) = MessageUiState(messages = listOf(message) + messages)

    fun updateMessageAt(index: Int, transformer: (ChatMessage) -> ChatMessage) = MessageUiState(
        messages = messages.toMutableList().apply {
            add(index, transformer(removeAt(index)))
        }
    )
}

data class ChatMessage(
    val id: String?,
    val role: Role,
    val content: String,
    val createAt: Instant,
) {
    enum class Role(val value: String) {
        User("user"),
        AI("assistant");

        companion object {
            fun fromValue(role: String): Role {
                return entries.first { it.value == role }
            }
        }
    }

    companion object {

        const val AI_LOCAL_ID = "ai_local_id"
        const val USER_LOCAL_ID = "user_local_id"

        fun newUserMessage(id: String, content: String) = ChatMessage(
            id = id,
            role = Role.User,
            content = content,
            createAt = Clock.System.now(),
        )

        fun newAIMessage() = ChatMessage(
            id = AI_LOCAL_ID,
            role = Role.AI,
            content = "",
            createAt = Clock.System.now(),
        )

        fun from(message: CopilotChatMessage) = ChatMessage(
            id = message.id,
            role = Role.fromValue(message.role),
            content = message.content,
            createAt = message.createdAt,
        )
    }
}
