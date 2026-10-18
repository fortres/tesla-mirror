package app.teslamirror.input

data class PlannedStroke(
    val fromX: Float,
    val fromY: Float,
    val toX: Float,
    val toY: Float,
    val isNew: Boolean,
)

// The framework cancels a continued stroke that does not move, so a still continuing segment is nudged by half a pixel.
fun planStroke(seg: Segment, prevEnd: Pair<Float, Float>?): PlannedStroke {
    val end = prevEnd.takeUnless { seg.isNew }
    val fromX = end?.first ?: seg.fromX
    val fromY = end?.second ?: seg.fromY
    val still = seg.willContinue && fromX == seg.toX && fromY == seg.toY
    return PlannedStroke(fromX, fromY, if (still) seg.toX + 0.5f else seg.toX, seg.toY, end == null)
}
