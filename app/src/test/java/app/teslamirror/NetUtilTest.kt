package app.teslamirror

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NetUtilTest {
    @Test fun prefersHotspotInterface() = assertEquals("192.168.43.1", NetUtil.pickHotspotAddress(listOf("wlan0" to listOf("10.0.0.5"), "swlan0" to listOf("192.168.43.1"))))
    @Test fun ignoresNonPrivateAddresses() {
        assertEquals("192.168.1.7", NetUtil.pickHotspotAddress(listOf("eth0" to listOf("192.168.1.7"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("lo" to listOf("127.0.0.1"), "eth0" to listOf("10.0.2.15"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("lo" to listOf("127.0.0.1"))))
    }
}
