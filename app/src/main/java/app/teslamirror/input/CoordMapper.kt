package app.teslamirror.input

object CoordMapper {
    fun toPixels(nx: Float, ny: Float, width: Int, height: Int): Pair<Float, Float> =
        (nx.coerceIn(0f, 1f) * width).coerceAtMost(width - 1f) to
            (ny.coerceIn(0f, 1f) * height).coerceAtMost(height - 1f)
}
