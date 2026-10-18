package com.fortres.teslamirror

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fortres.teslamirror.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { serve() }

    private val capturePermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            startForegroundService(
                serviceIntent(MirrorService.ACTION_START)
                    .putExtra(MirrorService.EXTRA_RESULT_CODE, result.resultCode)
                    .putExtra(MirrorService.EXTRA_DATA, data),
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.start.setOnClickListener {
            capturePermission.launch(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
        }
        binding.stop.setOnClickListener { startService(serviceIntent(MirrorService.ACTION_STOP)) }
        binding.openAccessibility.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { MirrorState.flow.collect { render(it) } }
        }

        if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) else serve()
    }

    private fun serve() = startForegroundService(serviceIntent(MirrorService.ACTION_SERVE))

    private fun serviceIntent(action: String) = Intent(this, MirrorService::class.java).setAction(action)

    private fun render(s: State) {
        binding.url.text = s.url ?: "hotspot off"
        binding.capture.text = "capture: ${if (s.capturing) "on" else "off"}"
        binding.accessibility.text = "accessibility: ${if (s.accessibility) "on" else "off"}"
        binding.hint.text = if (s.capturing && s.url != null) "Open ${s.url} in the Tesla browser" else "Tap Start to share the screen"
    }
}
