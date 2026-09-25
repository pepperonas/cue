package io.celox.cue.ui

/** Die vier Routen der App. `edit/{id}` nimmt `NEW_ID` für „neu anlegen". */
object Routes {
    const val LIST = "list"
    const val DETAIL_PATTERN = "detail/{id}"
    const val EDIT_PATTERN = "edit/{id}"
    const val SETTINGS = "settings"

    /** Steht im Nav-Argument, wenn `EditScreen` einen NEUEN Prompt anlegt statt einen zu bearbeiten. */
    const val NEW_ID = "new"

    fun detail(id: Long) = "detail/$id"
    fun edit(id: Long) = "edit/$id"
    fun editNew() = "edit/$NEW_ID"
}
