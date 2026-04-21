package com.pulse.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.pulse.android.ui.components.NowPlayingBar
import com.pulse.android.ui.screens.CloudScreen
import com.pulse.android.ui.screens.DashboardScreen
import com.pulse.android.ui.screens.LibraryScreen
import com.pulse.android.ui.screens.NowPlayingScreen
import com.pulse.android.ui.screens.SettingsScreen
import com.pulse.android.ui.theme.PulseBg
import com.pulse.android.ui.theme.PulseBorder
import com.pulse.android.ui.theme.PulseGreen
import com.pulse.android.ui.theme.PulseTextMuted
import com.pulse.android.viewmodel.PlayerViewModel

sealed class Screen(val route: String, val label: String, val icon: ImageVector) {
    object Dashboard : Screen("dashboard", "Dashboard", Icons.Default.Home)
    object Library   : Screen("library",   "Library",   Icons.Default.LibraryMusic)
    object Cloud     : Screen("cloud",     "Cloud",     Icons.Default.Cloud)
    object Settings  : Screen("settings",  "Settings",  Icons.Default.Settings)
}

val bottomNavItems = listOf(
    Screen.Dashboard,
    Screen.Library,
    Screen.Cloud,
    Screen.Settings,
)

@Composable
fun PulseApp() {
    val navController = rememberNavController()
    val vm: PlayerViewModel = viewModel()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDest = navBackStackEntry?.destination
    val isNowPlayingRoute = currentDest?.route == "nowplaying"

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        containerColor = PulseBg,
        bottomBar = {
            if (!isNowPlayingRoute) {
                Column {
                    NowPlayingBar(vm = vm, onClick = { navController.navigate("nowplaying") })
                    NavigationBar(
                        containerColor = PulseBg,
                        tonalElevation = 0.dp,
                    ) {
                        bottomNavItems.forEach { screen ->
                            val selected = currentDest?.hierarchy?.any { it.route == screen.route } == true
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    navController.navigate(screen.route) {
                                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(screen.icon, contentDescription = screen.label) },
                                label = { Text(screen.label) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = PulseGreen,
                                    selectedTextColor = PulseGreen,
                                    unselectedIconColor = PulseTextMuted,
                                    unselectedTextColor = PulseTextMuted,
                                    indicatorColor = Color(0xFF1A2E1A),
                                )
                            )
                        }
                    }
                }
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Dashboard.route,
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            composable(Screen.Dashboard.route) { DashboardScreen(vm = vm, navController = navController) }
            composable(Screen.Library.route)   { LibraryScreen(vm = vm, navController = navController) }
            composable(Screen.Cloud.route)     { CloudScreen(vm = vm, navController = navController) }
            composable(Screen.Settings.route)  { SettingsScreen(vm = vm) }
            composable("nowplaying")           { NowPlayingScreen(vm = vm, onBack = { navController.popBackStack() }) }
        }
    }
}

