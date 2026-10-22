package app.teslamirror

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NetUtilTest {
    @Test fun prefersHotspotInterface() = assertEquals(
        "192.168.43.1",
        NetUtil.pickHotspotAddress(listOf("wlan0" to listOf("192.168.3.42"), "swlan0" to listOf("192.168.43.1"))),
    )

    @Test fun supportsOtherPrivateHotspotSubnets() {
        assertEquals("172.20.10.1", NetUtil.pickHotspotAddress(listOf("swlan0" to listOf("172.20.10.1"))))
        assertEquals("10.42.0.1", NetUtil.pickHotspotAddress(listOf("ap0" to listOf("10.42.0.1"))))
    }

    @Test fun findsGatewayOnWlanInterface() {
        assertEquals(
            "192.168.3.3",
            NetUtil.pickHotspotAddress(listOf("wlan0" to listOf("192.168.3.3"))),
        )
    }

    @Test fun ignoresNonHotspotAddresses() {
        assertNull(NetUtil.pickHotspotAddress(listOf("wlan0" to listOf("8.8.8.8"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("eth0" to listOf("192.168.1.7"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("rmnet0" to listOf("10.0.2.15"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("lo" to listOf("127.0.0.1"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("ap0" to listOf("8.8.8.8"))))
        assertNull(NetUtil.pickHotspotAddress(listOf("ap0" to listOf("192.168.x.1"))))
    }
}
