package io.celox.cue.data.db

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 1 → 2 legt `id_alias` an und fasst die vorhandenen Zeilen nicht an. Room prüft
 * beim `runMigrationsAndValidate` zusätzlich, dass das Ergebnis exakt dem
 * exportierten Schema 2 entspricht — eine abweichende CREATE-Zeile würde hier rot.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = android.app.Application::class)
class MigrationTest {
    @get:Rule val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), CueDatabase::class.java)

    @Test fun `migrating 1 to 2 keeps prompts and adds the alias table`() {
        helper.createDatabase("mig.db", 1).use { db ->
            db.execSQL(
                "INSERT INTO prompt (id, title, body, projectId, status, sortOrder, tags, bookmarked, priority, " +
                    "blocked, tested, testClosely, updatedAt) VALUES (7, 'T', 'B', NULL, 'queued', 0, '', 0, " +
                    "'normal', 0, 0, 0, '')",
            )
        }
        helper.runMigrationsAndValidate("mig.db", 2, true, CueDatabase.MIGRATION_1_2).use { db ->
            db.query("SELECT title FROM prompt WHERE id = 7").use { c -> c.moveToFirst(); assertThat(c.getString(0)).isEqualTo("T") }
            db.execSQL("INSERT INTO id_alias (oldId, newId) VALUES (-1, 7)")
        }
    }
}
