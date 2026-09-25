package io.celox.cue.data.net

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Http(val code: Int, val message: String) : ApiResult<Nothing>
    data class Network(val cause: Throwable) : ApiResult<Nothing>

    /**
     * Der Server hat mit 2xx geantwortet, aber der Körper passt nicht zur DTO-Form.
     * Bei einem LESENDEN Aufruf heißt das „später nochmal" (s. [code]: 502 → offline).
     * Bei einem SCHREIBENDEN heißt es etwas anderes: der Server HAT die Änderung
     * angenommen — sie erneut zu schicken legte einen Prompt doppelt an. `SyncEngine`
     * unterscheidet deshalb diesen Fall ausdrücklich, statt ihn als Fehler zu wiederholen.
     */
    data class Unreadable(val httpCode: Int) : ApiResult<Nothing>
}

fun ApiResult<*>.code(): Int? = when (this) {
    is ApiResult.Ok -> 200
    is ApiResult.Http -> code
    is ApiResult.Network -> null
    is ApiResult.Unreadable -> 502
}
