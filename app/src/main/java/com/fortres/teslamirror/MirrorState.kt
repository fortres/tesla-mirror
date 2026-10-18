package com.fortres.teslamirror

import kotlinx.coroutines.flow.MutableStateFlow

data class State(
    val serverRunning: Boolean,
    val capturing: Boolean,
    val accessibility: Boolean,
    val url: String?,
    val captureW: Int,
    val captureH: Int,
)

object MirrorState {
    val flow = MutableStateFlow(State(false, false, false, null, 0, 0))
}
