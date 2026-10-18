package com.fortres.teslamirror

import java.net.Inet4Address
import java.net.NetworkInterface

object NetUtil {
    private val hotspotPrefixes = listOf("ap", "swlan", "wlan")

    fun pickHotspotAddress(interfaces: List<Pair<String, List<String>>>): String? {
        val all = interfaces.flatMap { (name, ips) -> ips.map { name to it } }.filterNot { it.second.startsWith("127.") }
        return all.firstOrNull { (name, ip) -> hotspotPrefixes.any(name::startsWith) && ip.startsWith("192.168.") }?.second
            ?: all.firstOrNull { it.second.startsWith("192.168.") }?.second
            ?: all.firstOrNull()?.second
    }

    fun currentInterfaces(): List<Pair<String, List<String>>> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .map { nif -> nif.name to nif.inetAddresses.toList().filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress } }
    } catch (e: Exception) {
        emptyList()
    }
}
