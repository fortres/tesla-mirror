package com.fortres.teslamirror.input

import org.junit.Assert.*
import org.junit.Test

class CoordMapperTest {
    @Test fun scales() = assertEquals(500f to 250f, CoordMapper.toPixels(0.5f, 0.5f, 1000, 500))
    @Test fun clamps() = assertEquals(999f to 0f, CoordMapper.toPixels(1.2f, -1f, 1000, 500))
}
