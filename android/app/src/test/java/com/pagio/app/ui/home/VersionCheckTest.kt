package com.pagio.app.ui.home

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionCheckTest {
    @Test fun plusRecente() { assertTrue(isNewerVersion("2.1.1", "2.1.0")); assertTrue(isNewerVersion("2.10.0", "2.9.0")); assertTrue(isNewerVersion("3.0", "2.9.9")) }
    @Test fun memeOuPlusAncienne() { assertFalse(isNewerVersion("2.0.0", "2.1.0")); assertFalse(isNewerVersion("2.1.0", "2.1.0")); assertFalse(isNewerVersion("", "2.1.0")) }
}
