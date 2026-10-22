package app.teslamirror

import java.net.Inet4Address
import java.net.NetworkInterface

object NetUtil {
    private val accessPointPrefixes = listOf("ap", "swlan", "softap")

    fun pickHotspotAddress(interfaces: List<Pair<String, List<String>>>): String? {
        val all = interfaces.flatMap { (name, ips) -> ips.map { name to it } }
        all.firstOrNull { (name, ip) -> accessPointPrefixes.any(name::startsWith) && isPrivateIpv4(ip) }
            ?.let { return it.second }
        return all.firstOrNull { (name, ip) -> name.startsWith("wlan") && isPrivateIpv4(ip) }?.second
    }

    private fun isPrivateIpv4(address: String): Boolean {
        val octets = address.split('.').map { it.toIntOrNull() ?: return false }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return false
        return octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    fun currentInterfaces(): List<Pair<String, List<String>>> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .map { nif -> nif.name to nif.inetAddresses.toList().filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress } }
    } catch (e: Exception) {
        emptyList()
    }
}
