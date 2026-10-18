package com.fortres.teslamirror.video

import org.junit.Assert.*
import org.junit.Test

class ScreenSourceTest {
    @Test fun halvesAndRoundsToEven() {
        assertEquals(1440 to 720, captureSize(2880, 1440))
        assertEquals(540 to 1200, captureSize(1080, 2400))
        assertEquals(538 to 1198, captureSize(1077, 2397))
    }
}
