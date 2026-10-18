package com.fortres.teslamirror.input

object InputBridge {
    @Volatile var service: InputService? = null
    val enabled: Boolean get() = service != null
}
