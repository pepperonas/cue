package io.celox.cue.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.celox.cue.data.RevokedNotice
import io.celox.cue.data.auth.EncryptedTokenStore
import io.celox.cue.data.auth.TokenStore
import io.celox.cue.data.db.CueDatabase
import io.celox.cue.data.net.AppApi
import io.celox.cue.data.net.CueApi
import io.celox.cue.data.sync.SyncEngine
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import okhttp3.OkHttpClient

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    /** Long-Poll wartet bis 25 s; der Client muss länger warten als der Server. */
    const val LIVE_WAIT_S = 25

    @Provides @Singleton
    fun db(@ApplicationContext c: Context): CueDatabase =
        Room.databaseBuilder(c, CueDatabase::class.java, "cue.db").addMigrations(CueDatabase.MIGRATION_1_2).build()

    @Provides @Singleton
    fun store(@ApplicationContext c: Context): TokenStore = EncryptedTokenStore(c)

    @Provides @Singleton
    fun client(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout((LIVE_WAIT_S + 15).toLong(), TimeUnit.SECONDS)
        .build()

    @Provides @Singleton
    fun api(client: OkHttpClient, store: TokenStore): AppApi = CueApi(client, store)

    @Provides @Singleton
    fun engine(db: CueDatabase, api: AppApi, store: TokenStore, revokedNotice: RevokedNotice) =
        SyncEngine(db, api, store, revokedNotice)
}
