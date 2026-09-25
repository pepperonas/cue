package io.celox.cue.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.android.lifecycle.HiltViewModel
import io.celox.cue.data.PromptRepository
import io.celox.cue.ui.detail.DetailScreen
import io.celox.cue.ui.edit.EditScreen
import io.celox.cue.ui.list.ListScreen
import io.celox.cue.ui.settings.SettingsScreen
import javax.inject.Inject

/**
 * Nur zur Entscheidung der Startroute (einmal beim Kaltstart gelesen) und als
 * DI-Brücke zum `AppNavigator`-Singleton — `CueApp` selbst braucht dafür kein
 * Entry-Point-Boilerplate, ein `@HiltViewModel` genügt.
 */
@HiltViewModel
class StartupViewModel @Inject constructor(
    repo: PromptRepository,
    val navigator: AppNavigator,
) : ViewModel() {
    val startDestination: String = if (repo.isConfigured) Routes.LIST else Routes.SETTINGS
}

@Composable
fun CueApp(startupViewModel: StartupViewModel = hiltViewModel()) {
    val navController = rememberNavController()

    // Ein Hintergrund-Vorgang (Live-Poll, Pull-to-Refresh) meldet eine erkannte
    // Sperre HIER, unabhängig davon, welcher Bildschirm gerade offen ist — sonst
    // landete das erst beim nächsten Kaltstart in der Oberfläche, aber
    // Verifikationspunkt 7 verlangt es SOFORT, während die App läuft.
    LaunchedEffect(Unit) {
        startupViewModel.navigator.events.collect { target ->
            when (target) {
                AppNavTarget.DEVICE_REVOKED ->
                    navController.navigate(Routes.SETTINGS) {
                        popUpTo(0) { inclusive = true }
                        launchSingleTop = true
                    }
            }
        }
    }

    NavHost(navController = navController, startDestination = startupViewModel.startDestination) {
        composable(Routes.LIST) {
            ListScreen(
                onOpenPrompt = { id -> navController.navigate(Routes.detail(id)) },
                onNewPrompt = { navController.navigate(Routes.editNew()) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(
            Routes.DETAIL_PATTERN,
            arguments = listOf(navArgument("id") { type = NavType.LongType }),
        ) {
            DetailScreen(
                onBack = { navController.popBackStack() },
                onEdit = { id -> navController.navigate(Routes.edit(id)) },
            )
        }
        composable(
            Routes.EDIT_PATTERN,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) {
            EditScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onConnected = {
                    navController.navigate(Routes.LIST) {
                        popUpTo(Routes.SETTINGS) { inclusive = true }
                        launchSingleTop = true
                    }
                },
                // Nur ein Pfeil, wenn diese Route wirklich einen Vorgänger hat (von der Liste
                // aus über das Zahnrad geöffnet) — als Startroute (Ersteinrichtung/Sperre) gibt
                // es nichts, zu dem er zurückführen könnte.
                onBack = if (navController.previousBackStackEntry != null) {
                    { navController.popBackStack() }
                } else {
                    null
                },
            )
        }
    }
}
