package io.celox.cue.data.net

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Http(val code: Int, val message: String) : ApiResult<Nothing>
    data class Network(val cause: Throwable) : ApiResult<Nothing>
}

fun ApiResult<*>.code(): Int? = when (this) {
    is ApiResult.Ok -> 200
    is ApiResult.Http -> code
    is ApiResult.Network -> null
}
