package io.celox.cue.data.net

import io.celox.cue.core.Priority
import io.celox.cue.core.Status
import io.celox.cue.data.db.ProjectEntity
import io.celox.cue.data.db.PromptEntity
import io.celox.cue.data.db.TagEntity
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PromptDto(
    val id: Long,
    val title: String,
    val body: String,
    @SerialName("project_id") val projectId: Long? = null,
    val status: Status,
    @SerialName("sort_order") val sortOrder: Int,
    val tags: String = "",
    val bookmarked: Boolean = false,
    val priority: Priority = Priority.normal,
    val blocked: Boolean = false,
    val tested: Boolean = false,
    @SerialName("test_closely") val testClosely: Boolean = false,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class ProjectDto(val id: Long, val name: String, val color: String = "", @SerialName("sort_order") val sortOrder: Int = 0)

@Serializable
data class TagDto(val id: Long, val name: String, @SerialName("usage_count") val usageCount: Int = 0)

@Serializable
data class TagListDto(val items: List<TagDto>)

@Serializable
data class ChangeFeedDto(val cursor: String, val changed: List<String> = emptyList())

fun PromptDto.toEntity() = PromptEntity(
    id, title, body, projectId, status, sortOrder, tags, bookmarked, priority, blocked, tested, testClosely, updatedAt,
)

fun ProjectDto.toEntity() = ProjectEntity(id, name, color, sortOrder)
fun TagDto.toEntity() = TagEntity(id, name, usageCount)
