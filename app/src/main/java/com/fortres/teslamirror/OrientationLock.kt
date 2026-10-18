package com.fortres.teslamirror

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.view.Surface

object OrientationLock {
    fun canWrite(context: Context): Boolean = Settings.System.canWrite(context)

    fun isForced(resolver: ContentResolver): Boolean =
        Settings.System.getInt(resolver, Settings.System.ACCELEROMETER_ROTATION, 1) == 0 &&
            Settings.System.getInt(resolver, Settings.System.USER_ROTATION, Surface.ROTATION_0) == Surface.ROTATION_90

    fun set(resolver: ContentResolver, forced: Boolean) {
        if (forced) {
            Settings.System.putInt(resolver, Settings.System.ACCELEROMETER_ROTATION, 0)
            Settings.System.putInt(resolver, Settings.System.USER_ROTATION, Surface.ROTATION_90)
        } else {
            Settings.System.putInt(resolver, Settings.System.ACCELEROMETER_ROTATION, 1)
        }
    }

    fun requestPermissionIntent(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + context.packageName))
}
