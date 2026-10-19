package app.teslamirror.input

object InputBridge {
    @Volatile var service: InputService? = null
    val enabled: Boolean get() = service != null
}
