package io.celox.cue.core

import kotlinx.serialization.Serializable

@Serializable
@Suppress("EnumEntryName")
enum class Status { queued, running, done, failed, archived }

@Serializable
@Suppress("EnumEntryName")
enum class Priority { low, normal, high }

/** Das, was Suche und Reihenfolge von einem Prompt wissen müssen. */
data class PromptView(
    val id: Long,
    val title: String,
    val body: String,
    val tags: String,
    val projectId: Long?,
    val status: Status,
    val sortOrder: Int,
    val priority: Priority,
    val blocked: Boolean,
    val tested: Boolean,
    val testClosely: Boolean,
)
